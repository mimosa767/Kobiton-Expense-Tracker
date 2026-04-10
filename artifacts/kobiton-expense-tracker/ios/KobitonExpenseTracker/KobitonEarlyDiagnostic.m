#import <Foundation/Foundation.h>
#import <os/log.h>

// KobitonEarlyDiagnostic: +load fires at dylib-load time, before AppDelegate.
// If this log line appears, the binary is executing and NSLog is captured.
@interface KobitonEarlyDiagnostic : NSObject
@end

@implementation KobitonEarlyDiagnostic

+ (void)load {
    // Plain NSLog — goes to syslog / ASL
    NSLog(@"[DIAG-PRELOAD] KobitonEarlyDiagnostic +load — binary executing at dylib load time");
    // os_log — goes to Unified Logging System (more reliable on iOS 10+)
    os_log(OS_LOG_DEFAULT, "[DIAG-PRELOAD] KobitonEarlyDiagnostic +load — ULS channel");
}

@end