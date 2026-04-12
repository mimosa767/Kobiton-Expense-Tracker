#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>

extern void RCTRegisterModule(Class);

// ─────────────────────────────────────────────────────────────────────────────
// KobitonCaptureModule — singleton AVCaptureSession design
//
// CRASH HISTORY AND ROOT CAUSE (crash log 8550509, Apr 11 2026):
//
//   Exception: EXC_CRASH / SIGABRT on thread "captureSessionQueue"
//   Faulting backtrace:
//     hook_AVCaptureConnection_setVideoOrientation   ← KobitonSdk.framework
//     -[AVCaptureVideoPreviewLayer setSimulatedImage:]
//     -[AVCaptureVideoPreviewLayer createSimulatedImage]
//     -[UIImage(Extensions) modifyToSize:withOrientationCorrection:withScale:]
//     _UIGraphicsBeginImageContextWithOptions
//     -[NSMutableDictionary initWithContentsOfFile:]   ← throws ObjC exception
//     objc_exception_throw → abort()
//
//   What happens: every time a NEW AVCaptureSession calls addInput:, Kobiton's
//   hook_AVCaptureConnection_setVideoOrientation swizzle fires.  After the first
//   image injection, Kobiton caches the injected frame internally.  On the
//   SECOND addInput: call (second camera feature = QR scanner), Kobiton tries
//   to re-paint that cached image onto the new preview layer via
//   setSimulatedImage:/createSimulatedImage.  Inside that path it reads a plist
//   via NSDictionary initWithContentsOfFile: against a file that no longer
//   exists (cleaned up after the first session), which throws an uncaught
//   ObjC exception on captureSessionQueue → SIGABRT.
//
//   This is a bug inside KobitonSdk.framework (Kobiton support ticket needed).
//   The workaround implemented here: keep ONE shared AVCaptureSession alive for
//   the entire app lifetime.  addInput: (and therefore the swizzle) fires
//   exactly ONCE.  The second and subsequent captureFrame: calls add/remove
//   only an AVCaptureVideoDataOutput — no new session, no new addInput: call,
//   no second swizzle invocation, no crash.
//
// JS usage (unchanged from caller's perspective):
//   const b64 = await NativeModules.KobitonCaptureModule.captureFrame(2500);
//   // b64 is a raw base64 JPEG string (no data-URI prefix)
//
// Flow (updated):
//   1. JS does NOT mount a CameraView on iOS (removed from media-gallery.tsx).
//      No CameraView = no competing AVCaptureSession = no trigger for the crash.
//   2. JS calls captureFrame(delayMs).
//   3. Module attaches an AVCaptureVideoDataOutput to the shared session.
//   4. After delayMs ms, arms the output to capture the next Kobiton-injected frame.
//   5. On capture: JPEG base64 returned, output removed from session.
//      Session stays running for the next captureFrame: call.
// ─────────────────────────────────────────────────────────────────────────────

// ── Singleton shared session — addInput: fires exactly once per app lifetime ──
static AVCaptureSession *_sharedAVSession = nil;
static dispatch_once_t   _sharedAVOnce;

@interface KobitonCaptureModule : NSObject <RCTBridgeModule, AVCaptureVideoDataOutputSampleBufferDelegate>
+ (AVCaptureSession *)sharedSession;
@end

@implementation KobitonCaptureModule {
    // Per-capture transient state (reset on every captureFrame: call)
    AVCaptureVideoDataOutput *_output;        // attached for the duration of one capture
    RCTPromiseResolveBlock    _resolve;
    RCTPromiseRejectBlock     _reject;
    BOOL                      _armed;         // YES = capture the next arriving frame
    BOOL                      _settled;       // YES = promise already resolved/rejected
    dispatch_queue_t          _captureQueue;
    // ── Native memory stress ivars ────────────────────────────────────────────
    void                     *_memBuffer;
    size_t                    _memBytes;
    NSTimer                  *_memThrashTimer;
}

// ─── Singleton session setup ──────────────────────────────────────────────────
//
// Called once — on first captureFrame: or on explicit warmUp from JS.
// All subsequent captureFrame: calls re-use the same AVCaptureSession so
// addInput: never fires a second time and Kobiton's swizzle path is safe.
+ (AVCaptureSession *)sharedSession {
    dispatch_once(&_sharedAVOnce, ^{
        AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
        if (!device) {
            NSLog(@"[KOBITON] KobitonCaptureModule: sharedSession — no back camera device");
            return;
        }
        NSError *err = nil;
        AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&err];
        if (!input) {
            NSLog(@"[KOBITON] KobitonCaptureModule: sharedSession — cannot create input: %@",
                  err.localizedDescription);
            return;
        }
        _sharedAVSession = [[AVCaptureSession alloc] init];
        _sharedAVSession.sessionPreset = AVCaptureSessionPresetMedium;
        // addInput: triggers KobitonSdk's hook_AVCaptureConnection_setVideoOrientation swizzle.
        // This is the ONLY time that swizzle fires for the life of the app.
        [_sharedAVSession addInput:input];
        [_sharedAVSession startRunning];
        NSLog(@"[KOBITON] KobitonCaptureModule: shared AVCaptureSession created and running "
              @"— addInput: fired once, Kobiton swizzle installed");
    });
    return _sharedAVSession;
}

+ (NSString *)moduleName { return @"KobitonCaptureModule"; }

+ (void)load {
    RCTRegisterModule(self);
    NSLog(@"[KOBITON] KobitonCaptureModule loaded");
}

// ─── warmUpSession:resolve:reject ─────────────────────────────────────────────
//
// Optional: JS can call this on screen mount to pre-create the shared session
// so the first captureFrame: doesn't pay session-startup latency.
// Safe to call multiple times — dispatch_once guarantees single execution.
RCT_EXPORT_METHOD(warmUpSession:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    AVCaptureSession *session = [[self class] sharedSession];
    resolve(@(session != nil));
}

// ─── captureFrame:resolve:reject ──────────────────────────────────────────────
//
//   delayMs — milliseconds to wait after attaching the output before arming.
//             Gives Kobiton time to start injecting into the new output.
//             A minimum of 2500ms is enforced (see note below).
//
//   No new AVCaptureSession is created. The shared singleton session is reused.
//   Only an AVCaptureVideoDataOutput is added and later removed per capture.
RCT_EXPORT_METHOD(captureFrame:(double)delayMs
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    // ── Minimum arm delay ─────────────────────────────────────────────────────
    // Root cause confirmed (Apr 10 09:08:22, session 8548140-ios):
    // Even with the shared session, Kobiton needs time after the output is added
    // to start routing injected frames to the new delegate.  2500 ms is the
    // empirically confirmed minimum; below this the arm fires before injected
    // frames arrive and the timeout is hit.
    double effectiveDelay = MAX(delayMs, 2500.0);

    // ── Guard: busy check ─────────────────────────────────────────────────────
    // _output != nil means a captureFrame: is already in progress.
    if (_output) {
        reject(@"E_BUSY", @"A capture is already in progress — wait for it to finish", nil);
        return;
    }

    // ── Get the shared session ────────────────────────────────────────────────
    AVCaptureSession *session = [[self class] sharedSession];
    if (!session) {
        reject(@"E_NO_CAMERA", @"Shared camera session could not be created (no back camera?)", nil);
        return;
    }

    _resolve  = resolve;
    _reject   = reject;
    _armed    = NO;
    _settled  = NO;

    _captureQueue = dispatch_queue_create("com.kobiton.capture", DISPATCH_QUEUE_SERIAL);

    // Attach a new AVCaptureVideoDataOutput to the shared session.
    // Kobiton already swizzled the session's connection when addInput: fired
    // (during sharedSession creation).  Adding a new output does NOT re-invoke
    // hook_AVCaptureConnection_setVideoOrientation → setSimulatedImage: crash
    // path because the swizzle is on the session-level connection, not per-output.
    _output = [[AVCaptureVideoDataOutput alloc] init];
    _output.videoSettings = @{
        (NSString *)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)
    };
    _output.alwaysDiscardsLateVideoFrames = YES;
    [_output setSampleBufferDelegate:self queue:_captureQueue];

    [session addOutput:_output];

    if (!session.isRunning) {
        [session startRunning];
    }

    NSLog(@"[KOBITON] KobitonCaptureModule: output added to shared session — "
          @"arming in %.0f ms (requested %.0f ms)", effectiveDelay, delayMs);

    __weak KobitonCaptureModule *weakSelf = self;

    // Arm after effectiveDelay
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
                       message:@"No injected frame received within timeout. "
                               @"Ensure the Kobiton image injection is active and try again."];
        }
    );
}

// ─── AVCaptureVideoDataOutputSampleBufferDelegate ────────────────────────────
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
    // Root cause confirmed (Apr 10 09:08:22, session 8548140-ios):
    // After an unclean session teardown (CATransaction warning), the next
    // AVCaptureSession immediately delivers zero-size frames during output format
    // negotiation.  Disarming on that zero-size buffer causes a downstream crash
    // in UIGraphicsBeginImageContext({0,0}).
    //
    // Fix: skip zero-size buffers WITHOUT disarming.  _armed stays YES so the
    // next valid-dimension frame is processed instead.
    if (width == 0 || height == 0) {
        NSLog(@"[KOBITON] KobitonCaptureModule: skipping zero-size buffer (format negotiation)");
        return;
    }

    // Disarm immediately — capture exactly one valid frame
    _armed   = NO;
    _settled = YES;
    NSLog(@"[KOBITON] KobitonCaptureModule: frame captured (%zux%zu) — converting to JPEG",
          width, height);

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

    // Detach the output — session stays running for the next captureFrame: call.
    // This does NOT trigger hook_AVCaptureConnection_setVideoOrientation because
    // removeOutput: does not create a new session or new connection.
    if (_sharedAVSession && _output) {
        [_sharedAVSession removeOutput:_output];
    }
    _output = nil;

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

// ─── finishWithError:message: ─────────────────────────────────────────────────
//
// Detaches the output from the shared session and rejects the JS promise.
// Does NOT stop the shared session (it stays running for the next capture).
- (void)finishWithError:(NSString *)code message:(NSString *)msg
{
    dispatch_async(dispatch_get_main_queue(), ^{
        if (_sharedAVSession && self->_output) {
            [_sharedAVSession removeOutput:self->_output];
        }
        self->_output  = nil;
        self->_settled = YES;
        if (self->_reject) {
            self->_reject(code, msg, nil);
            self->_resolve = nil;
            self->_reject  = nil;
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Native memory stress — malloc() path
//
// WHY malloc() instead of JS Uint8Array:
//   JS Uint8Array lives in the JavaScriptCore/Hermes heap.  iOS tracks app
//   memory via phys_footprint (task_info), which does NOT consistently account
//   for JSC heap pages — the OS may defer committing them physically.
//   Kobiton's System Metrics panel reads phys_footprint, so JS-allocated memory
//   is invisible to it.  malloc() allocates from the native heap and IS counted
//   in phys_footprint immediately, so it shows up in Kobiton's panel.
//
// WHY page-write loop after malloc:
//   malloc() on iOS reserves virtual address space but doesn't commit physical
//   pages until they are first touched (demand paging).  Writing one byte per
//   4 KB page forces the OS to commit every page physically, so the full
//   allocation appears in phys_footprint immediately.
//
// WHY NSTimer thrash loop:
//   iOS jetsam can compress or evict clean pages under memory pressure.
//   Touching every page every 100 ms keeps them "dirty" in the compressed memory
//   subsystem, preventing jetsam from reclaiming them and ensuring the allocation
//   stays visible in Kobiton's panel for the duration of the stress test.
// ─────────────────────────────────────────────────────────────────────────────

RCT_EXPORT_METHOD(allocateNativeMemory:(double)megabytes
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    [self releaseNativeMemoryInternal];

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        size_t bytes = (size_t)(megabytes * 1024 * 1024);
        void *buffer = malloc(bytes);
        if (!buffer) {
            resolve(@(0));
            return;
        }
        uint8_t *p = (uint8_t *)buffer;
        for (size_t i = 0; i < bytes; i += 4096) {
            p[i] = (uint8_t)(i ^ 0xA5);
        }
        self->_memBuffer = buffer;
        self->_memBytes  = bytes;

        dispatch_async(dispatch_get_main_queue(), ^{
            [self startMemoryThrash];
            NSLog(@"[KOBITON] KobitonCaptureModule: allocated %.0f MB native (malloc) — thrash timer started", megabytes);
            resolve(@(megabytes));
        });
    });
}

RCT_EXPORT_METHOD(releaseNativeMemory:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    [self releaseNativeMemoryInternal];
    NSLog(@"[KOBITON] KobitonCaptureModule: native memory released");
    resolve(nil);
}

- (void)releaseNativeMemoryInternal {
    [_memThrashTimer invalidate];
    _memThrashTimer = nil;
    if (_memBuffer) {
        free(_memBuffer);
        _memBuffer = NULL;
    }
    _memBytes = 0;
}

- (void)startMemoryThrash {
    [_memThrashTimer invalidate];
    __weak KobitonCaptureModule *weakSelf = self;
    _memThrashTimer = [NSTimer scheduledTimerWithTimeInterval:0.1
                                                      repeats:YES
                                                        block:^(NSTimer *t) {
        KobitonCaptureModule *s = weakSelf;
        if (!s || !s->_memBuffer) { [t invalidate]; return; }
        uint8_t *p     = (uint8_t *)s->_memBuffer;
        uint8_t  cycle = (uint8_t)(CACurrentMediaTime() * 10);
        size_t   total = s->_memBytes;
        for (size_t i = 0; i < total; i += 4096) {
            p[i] ^= cycle;
        }
    }];
}

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
