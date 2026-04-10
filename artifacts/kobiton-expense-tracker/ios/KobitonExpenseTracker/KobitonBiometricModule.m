#import <React/RCTBridgeModule.h>
// Direct import — same pattern as Android's "import com.kobiton.biometric.BiometricPrompt"
// KobitonLAContext is a LAContext subclass; using it directly (not via NSClassFromString)
// ensures the Kobiton framework intercepts ALL evaluatePolicy: calls.
#import <KobitonLAContext/KobitonLAContext.h>

// Explicit forward declaration: Xcode 26 / iOS SDK 26's stricter clang modules
// system does not expose RCTRegisterModule at the C level even after importing
// RCTBridgeModule.h via @import. Adding extern void satisfies the declaration
// requirement without changing any runtime behaviour.
extern void RCTRegisterModule(Class);

@interface KobitonBiometricModule : NSObject <RCTBridgeModule>
@end

@implementation KobitonBiometricModule

+ (NSString *)moduleName { return @"KobitonBiometricModule"; }

+ (void)load {
    RCTRegisterModule(self);
    // Start KobitonLAContext's embedded web server (GCDWebServer).
    // The server listens on a local port so the Kobiton dC-Runner can deliver
    // biometric inject signals — same role as ImageInjectionClient on Android.
    // Use performSelector: because configure() is not declared in the public header.
    SEL configureSel = NSSelectorFromString(@"configure");
    if ([KobitonLAContext respondsToSelector:configureSel]) {
        NSLog(@"[KOBITON] +load — calling KobitonLAContext configure (embedded web server start)");
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
        [KobitonLAContext performSelector:configureSel];
#pragma clang diagnostic pop
        NSLog(@"[KOBITON] +load — KobitonLAContext configure completed");
    } else {
        NSLog(@"[KOBITON] +load — KobitonLAContext does not respond to configure — SDK self-initializes via +initialize");
    }
}

- (NSDictionary *)constantsToExport {
    NSLog(@"[KOBITON-NATIVE] KobitonBiometricModule constantsToExport called — direct KobitonLAContext import active");
    return @{@"registered": @YES};
}

RCT_EXPORT_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    // Direct use: [[KobitonLAContext alloc] init] — same as Android's new BiometricPrompt(...)
    KobitonLAContext *ctx = [[KobitonLAContext alloc] init];
    NSLog(@"[KOBITON] isAvailable — KobitonLAContext instance: %@", ctx);
    NSError *error = nil;
    BOOL ok = [ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error];
    NSLog(@"[KOBITON] isAvailable result: %@ error: %@", ok ? @"YES" : @"NO", error.localizedDescription ?: @"nil");
    resolve(@(ok));
}

RCT_EXPORT_METHOD(authenticate:(NSString *)reason
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    // Direct use: [[KobitonLAContext alloc] init] — same as Android's new BiometricPrompt(...)
    KobitonLAContext *ctx = [[KobitonLAContext alloc] init];
    NSLog(@"[KOBITON] authenticate — KobitonLAContext instance: %@", ctx);
    [ctx evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
        localizedReason:reason
                  reply:^(BOOL success, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            NSLog(@"[KOBITON] authenticate result: %@ error: %@", success ? @"YES" : @"NO", error.localizedDescription ?: @"nil");
            resolve(@{@"success": @(success), @"error": error.localizedDescription ?: [NSNull null]});
        });
    }];
}

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
