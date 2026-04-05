/**
 * withOldArchFixes — Expo Config Plugin
 *
 * Patches the generated Podfile to exclude Fabric (New Architecture) component
 * views when building with newArchEnabled: false (Old Architecture).
 *
 * Problem:
 *   @react-native-community/slider ≥ 5.0.0 ships RNCSliderComponentView.mm,
 *   a Fabric component view that imports New Architecture codegen headers:
 *     #import <react/renderer/components/RNCSlider/RNCSliderComponentDescriptor.h>
 *   These headers are only generated when newArchEnabled: true. Without them the
 *   file fails to compile with "file not found".
 *
 * Fix:
 *   Set EXCLUDED_SOURCE_FILE_NAMES = 'RNCSliderComponentView.mm' on the
 *   react-native-slider Pods target inside the post_install hook.
 *   This is version-independent — it works regardless of which 5.x version of
 *   the slider package the EAS build machine resolves from its pnpm cache.
 *
 * Why a Podfile patch (not a package.json pin):
 *   EAS build machines cache the pnpm content-addressable store between builds.
 *   Even when pnpm-lock.yaml is updated to require 5.0.1, the build machine may
 *   serve 5.1.2 from its cache if the store entry is stale. The Podfile patch
 *   bypasses this by excluding the problematic file at the Xcode level.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const MARKER = '# [OldArchFix] Exclude Fabric-only files from Old Architecture build';

function withOldArchFixes(config) {
  return withDangerousMod(config, [
    'ios',
    (mod) => {
      const podfilePath = path.join(mod.modRequest.platformProjectRoot, 'Podfile');

      if (!fs.existsSync(podfilePath)) {
        console.warn('[OldArchFix] ⚠ Podfile not found — run expo prebuild first');
        return mod;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes(MARKER)) {
        console.log('[OldArchFix] ✓ Podfile already patched — skipping');
        return mod;
      }

      // Inject immediately before react_native_post_install() inside post_install.
      // That call is guaranteed to be present in Expo SDK 52+ generated Podfiles.
      const injection = [
        `    ${MARKER}`,
        `    # RNCSliderComponentView.mm imports New Architecture codegen headers that`,
        `    # only exist when newArchEnabled: true. Exclude it for Old Architecture builds.`,
        `    installer.pods_project.targets.each do |target|`,
        `      next unless target.name == 'react-native-slider'`,
        `      target.build_configurations.each do |config|`,
        `        config.build_settings['EXCLUDED_SOURCE_FILE_NAMES'] = 'RNCSliderComponentView.mm'`,
        `      end`,
        `    end`,
        ``,
      ].join('\n');

      const before = podfile;
      podfile = podfile.replace(
        /^(\s+react_native_post_install\()/m,
        `${injection}$1`
      );

      if (podfile === before) {
        console.warn('[OldArchFix] ⚠ Could not find react_native_post_install() in Podfile — patch NOT applied');
        console.warn('[OldArchFix]   Podfile post_install block:');
        const match = before.match(/post_install[\s\S]{0,400}/);
        if (match) console.warn(match[0]);
      } else {
        fs.writeFileSync(podfilePath, podfile, 'utf8');
        console.log('[OldArchFix] ✓ Patched Podfile — excluded RNCSliderComponentView.mm from react-native-slider target');
      }

      return mod;
    },
  ]);
}

module.exports = withOldArchFixes;
