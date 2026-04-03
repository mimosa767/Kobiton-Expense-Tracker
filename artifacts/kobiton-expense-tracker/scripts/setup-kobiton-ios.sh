#!/usr/bin/env bash
# Kobiton iOS Image Injection SDK – Setup Validation Script
# Usage: bash scripts/setup-kobiton-ios.sh
#
# Validates that KobitonSdk.framework is in the correct location and
# prints the manual Xcode steps still needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
FRAMEWORKS_DIR="$PROJECT_ROOT/ios/KobitonFrameworks"
FRAMEWORK="$FRAMEWORKS_DIR/KobitonSdk.framework"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Kobiton iOS Image Injection SDK – Setup Checker"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Check expo prebuild has been run
if [ ! -d "$PROJECT_ROOT/ios" ]; then
  echo "✗  ios/ directory not found."
  echo "   Run first: npx expo prebuild --platform ios"
  echo ""
  exit 1
fi
echo "✓  ios/ directory found."

# 2. Check KobitonFrameworks directory
if [ ! -d "$FRAMEWORKS_DIR" ]; then
  echo "✗  ios/KobitonFrameworks/ directory not found."
  echo "   Expected: $FRAMEWORKS_DIR"
  echo "   Re-run expo prebuild to regenerate it."
  echo ""
  exit 1
fi
echo "✓  ios/KobitonFrameworks/ directory found."

# 3. Check framework file
if [ ! -d "$FRAMEWORK" ]; then
  echo ""
  echo "✗  KobitonSdk.framework not found at:"
  echo "   $FRAMEWORK"
  echo ""
  echo "   To fix:"
  echo "   1. Download: https://kobiton.s3.amazonaws.com/downloads/KobitonSDK-ios.zip"
  echo "   2. Extract the zip — you will get KobitonSdk.framework"
  echo "   3. Move it to: $FRAMEWORKS_DIR"
  echo ""
  exit 1
fi
echo "✓  KobitonSdk.framework found."

echo ""
echo "Framework file is in place. Complete the following in Xcode:"
echo ""
echo "  1. Open ios/*.xcworkspace in Xcode"
echo "  2. Drag ios/KobitonFrameworks/KobitonSdk.framework into the project tree"
echo "       • Check: Copy items if needed"
echo "       • Target: your app target"
echo "       • Click Finish"
echo "  3. Project Navigator → General → Frameworks, Libraries, Embedded Content"
echo "       • Confirm KobitonSdk.framework is listed"
echo "       • Set Embed dropdown to: Embed & Sign"
echo "  4. Build: eas build --platform ios --profile preview"
echo ""
echo "Reference: https://docs.kobiton.com/apps/image-injection-sdk/add-the-sdk-to-your-ios-app"
echo ""