#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <UIKit/UIKit.h>

extern void RCTRegisterModule(Class);

// ─────────────────────────────────────────────────────────────────────────────
// KobitonCaptureModule
//
// iOS equivalent of the Android KobitonCameraModule / KobitonCameraActivity.
// Creates its own AVCaptureSession + AVCaptureVideoDataOutput, which the
// Kobiton SDK swizzles (same as it swizzles the CameraView's output), then
// captures a single sample buffer and returns it as JPEG base64.
//
// JS usage:
//   const b64 = await NativeModules.KobitonCaptureModule.captureFrame(1500);
//   // b64 is a raw base64 JPEG string (no data-URI prefix)
//
// Flow:
//   1. JS unmounts CameraView so expo-camera releases the AVCaptureSession.
//   2. JS calls captureFrame(delayMs) — this opens a new session.
//   3. After delayMs ms, the module arms itself to capture the next frame.
//   4. The captured buffer (Kobiton-injected) is returned as JPEG base64.
//   5. JS re-mounts CameraView.
// ─────────────────────────────────────────────────────────────────────────────
@interface KobitonCaptureModule : NSObject <RCTBridgeModule, AVCaptureVideoDataOutputSampleBufferDelegate>
@end

@implementation KobitonCaptureModule {
    AVCaptureSession             *_session;
    AVCaptureVideoDataOutput     *_output;
    RCTPromiseResolveBlock        _resolve;
    RCTPromiseRejectBlock         _reject;
    BOOL                          _armed;    // YES = capture the next arriving frame
    BOOL                          _settled;  // YES = promise already resolved/rejected
    dispatch_queue_t              _captureQueue;
}

+ (NSString *)moduleName { return @"KobitonCaptureModule"; }

+ (void)load {
    RCTRegisterModule(self);
    NSLog(@"[KOBITON] KobitonCaptureModule loaded");
}

// captureFrame:resolve:reject
//
//   delayMs — milliseconds to wait after session start before arming the
//             capture. The Kobiton SDK needs a moment to start injecting
//             frames into the AVCaptureVideoDataOutput delegate. A minimum
//             of 2500ms is enforced (see below).
//
//   An additional 4-second timeout fires if no frame arrives after arming.
RCT_EXPORT_METHOD(captureFrame:(double)delayMs
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    // ── Minimum arm delay ─────────────────────────────────────────────────────
    // Root cause confirmed from device log (Apr 10 09:08:22, session 8548140-ios):
    // When a prior AVCaptureSession (receipt camera) did not tear down cleanly
    // (logged: "CoreAnimation: deleted thread with uncommitted CATransaction" at
    // 09:08:05), the subsequent AVCaptureSession needs extra time to negotiate
    // its output format and deliver valid (non-zero-dimension) sample buffers.
    // At 1500ms the arm fired before valid buffers arrived; the zero-size buffer
    // caused the NSInternalInconsistencyException crash in UIGraphics.m:410.
    // The zero-size guard in captureOutput:didOutputSampleBuffer: also covers
    // this, but a longer arm delay is defence-in-depth — on most devices the
    // injected frame is actually available earlier, so the extra 1s is harmless.
    double effectiveDelay = MAX(delayMs, 2500.0);

    // Guard: don't start a second capture while one is already in progress.
    if (_session && _session.isRunning) {
        reject(@"E_BUSY", @"A capture is already in progress — wait for it to finish", nil);
        return;
    }

    _resolve  = resolve;
    _reject   = reject;
    _armed    = NO;
    _settled  = NO;

    _captureQueue = dispatch_queue_create("com.kobiton.capture", DISPATCH_QUEUE_SERIAL);

    // Open the back camera
    AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
    if (!device) {
        reject(@"E_NO_CAMERA", @"No back camera device found", nil);
        return;
    }

    NSError *err = nil;
    AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&err];
    if (!input) {
        reject(@"E_CAMERA_INPUT", err.localizedDescription ?: @"Cannot create AVCaptureDeviceInput", nil);
        return;
    }

    _session = [[AVCaptureSession alloc] init];
    _session.sessionPreset = AVCaptureSessionPresetMedium;
    [_session addInput:input];

    // AVCaptureVideoDataOutput — this is what Kobiton swizzles to inject frames
    _output = [[AVCaptureVideoDataOutput alloc] init];
    _output.videoSettings = @{
        (NSString *)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)
    };
    _output.alwaysDiscardsLateVideoFrames = YES;
    [_output setSampleBufferDelegate:self queue:_captureQueue];
    [_session addOutput:_output];

    [_session startRunning];
    NSLog(@"[KOBITON] KobitonCaptureModule: session started — arming in %.0f ms (requested %.0f ms)", effectiveDelay, delayMs);

    // Arm after effectiveDelay: by this point Kobiton should be injecting into _output.
    // Must capture weakSelf into a strong local before accessing ivars —
    // clang forbids dereferencing a __weak pointer directly (race condition).
    __weak KobitonCaptureModule *weakSelf = self;
    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(effectiveDelay * NSEC_PER_MSEC)),
        dispatch_get_main_queue(),
        ^{
            KobitonCaptureModule *s = weakSelf;
            if (!s || s->_settled) return;
            s->_armed = YES;
            NSLog(@"[KOBITON] KobitonCaptureModule: armed — waiting for injected frame");
        }
    );

    // Timeout: reject if no frame arrives within effectiveDelay + 4000 ms
    double timeoutSec = (effectiveDelay + 4000.0) / 1000.0;
    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeoutSec * NSEC_PER_SEC)),
        dispatch_get_main_queue(),
        ^{
            KobitonCaptureModule *s = weakSelf;
            if (!s || s->_settled) return;
            NSLog(@"[KOBITON] KobitonCaptureModule: timeout — no injected frame received");
            [s finishWithError:@"E_TIMEOUT"
                       message:@"No injected frame received within timeout. Ensure the Kobiton image injection is active and try again."];
        }
    );
}

// AVCaptureVideoDataOutputSampleBufferDelegate
- (void)captureOutput:(AVCaptureOutput *)output
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
       fromConnection:(AVCaptureConnection *)connection
{
    if (!_armed || _settled) return;

    CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!imageBuffer) return;

    size_t width  = CVPixelBufferGetWidth(imageBuffer);
    size_t height = CVPixelBufferGetHeight(imageBuffer);

    // ── Zero-size guard ───────────────────────────────────────────────────────
    // Root cause confirmed from device log (Apr 10 09:08:22, session 8548140-ios):
    //   *** Assertion failure in UIGraphics.m:410
    //   *** NSInternalInconsistencyException: UIGraphicsBeginImageContext() failed
    //       to allocate CGBitmapContext: size={0, 0}, scale=3.000000
    //
    // Pattern: it is always the SECOND camera feature that crashes, regardless
    // of order. The first session's unclean teardown (evidenced by the
    // CoreAnimation: deleted thread with uncommitted CATransaction warning)
    // leaves AVFoundation in a state where the next AVCaptureSession immediately
    // delivers a zero-size frame during output format negotiation.
    //
    // Disarming (_settled=YES) on that first zero-size buffer causes the crash
    // inside CGBitmapContextCreate(width=0,height=0) → NULL context →
    // CGBitmapContextCreateImage → UIImage → UIImageJPEGRepresentation →
    // internal UIGraphicsBeginImageContext({0,0}) → fatal assertion.
    //
    // Fix: skip zero-size buffers WITHOUT disarming. _armed stays YES so the
    // next arriving buffer (which will have valid dimensions) is processed
    // instead. The crash path is unreachable once this guard is in place.
    if (width == 0 || height == 0) {
        NSLog(@"[KOBITON] KobitonCaptureModule: skipping zero-size buffer (session still negotiating format)");
        return;
    }

    // Disarm immediately so we capture exactly one valid frame
    _armed   = NO;
    _settled = YES;
    NSLog(@"[KOBITON] KobitonCaptureModule: frame captured (%zux%zu) — converting to JPEG", width, height);

    // kCVPixelBufferLock_ReadOnly is the correct constant (not kCVPixelBufferLockFlags_ReadOnly)
    CVPixelBufferLockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);

    size_t bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer);
    void  *baseAddress = CVPixelBufferGetBaseAddress(imageBuffer);

    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(
        baseAddress, width, height, 8, bytesPerRow,
        colorSpace,
        kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst
    );
    CGImageRef cgImage = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
    CGColorSpaceRelease(colorSpace);
    CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);

    // Camera frames arrive in landscape; rotate to portrait so jsQR finds the QR code.
    UIImage *raw    = [UIImage imageWithCGImage:cgImage scale:1.0
                                    orientation:UIImageOrientationRight];
    CGImageRelease(cgImage);
    NSData   *jpeg   = UIImageJPEGRepresentation(raw, 0.9);
    NSString *base64 = [jpeg base64EncodedStringWithOptions:0];

    [_session stopRunning];
    _session = nil;
    _output  = nil;

    if (base64.length == 0) {
        [self finishWithError:@"E_ENCODE" message:@"JPEG encoding returned empty data"];
        return;
    }

    NSLog(@"[KOBITON] KobitonCaptureModule: JPEG length=%lu — resolving promise",
          (unsigned long)base64.length);
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self->_resolve) {
            self->_resolve(base64);
            self->_resolve = nil;
            self->_reject  = nil;
        }
    });
}

- (void)finishWithError:(NSString *)code message:(NSString *)msg
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [self->_session stopRunning];
        self->_session  = nil;
        self->_output   = nil;
        self->_settled  = YES;
        if (self->_reject) {
            self->_reject(code, msg, nil);
            self->_resolve = nil;
            self->_reject  = nil;
        }
    });
}

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
