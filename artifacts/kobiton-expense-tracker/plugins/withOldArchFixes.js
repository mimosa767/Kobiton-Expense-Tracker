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
 * Root cause of previous fix failure:
 *   EXCLUDED_SOURCE_FILE_NAMES was set to just 'RNCSliderComponentView.mm' but
 *   Xcode matches this setting against the file's FULL RELATIVE PATH inside the
 *   Pods project, which is a deeply nested ../../../node_modules/... path. A bare
 *   filename without a leading wildcard never matches. The file was silently
 *   included in the build despite the setting being present.
 *
 * Correct fix:
 *   Use the CocoaPods Ruby API to DIRECTLY REMOVE RNCSliderComponentView.mm from
 *   the react-native-slider target's "Compile Sources" build phase in the Xcode
 *   project. This is unconditional and version-independent — the file is simply
 *   not in the build phase and Xcode will never attempt to compile it, regardless
 *   of the package version the EAS build machine resolves from its pnpm cache.
 *
 * Why a Podfile patch (not a package.json pin):
 *   EAS build machines cache the pnpm content-addressable store between builds.
 *   Even when pnpm-lock.yaml is updated to require 5.0.1, the build machine may
 *   serve 5.1.2 from its cache if the store entry is stale. The Podfile patch
 *   bypasses this by removing the problematic file from the Xcode build phase.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const MARKER = '# [OldArchFix] Remove RNCSliderComponentView.mm from Compile Sources';

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

      // Inject into post_install, immediately before react_native_post_install().
      //
      // APPROACH: Use the CocoaPods Ruby API to directly remove RNCSliderComponentView.mm
      // from the react-native-slider target's Compile Sources build phase. This is
      // more reliable than EXCLUDED_SOURCE_FILE_NAMES because:
      //   - EXCLUDED_SOURCE_FILE_NAMES matches against the full relative path, so a
      //     bare filename without a leading wildcard silently does nothing.
      //   - Removing from the build phase is unconditional and version-independent.
      //
      // After pod install, installer.pods_project is the live Xcodeproj object.
      // source_build_phase.files contains PBXBuildFile entries; we select the one
      // whose file_ref.path ends with our target filename and delete it.
      const injection = [
        `    ${MARKER}`,
        `    # RNCSliderComponentView.mm (slider ≥ 5.0.0) imports New Architecture codegen`,
        `    # headers absent in Old Architecture builds. Remove it from Compile Sources.`,
        `    installer.pods_project.targets.each do |t|`,
        `      next unless t.name == 'react-native-slider'`,
        `      fabric_files = t.source_build_phase.files.select do |bf|`,
        `        bf.file_ref&.path&.end_with?('RNCSliderComponentView.mm')`,
        `      end`,
        `      fabric_files.each { |bf| t.source_build_phase.files.delete(bf) }`,
        `      if fabric_files.empty?`,
        `        puts '[OldArchFix] ℹ  RNCSliderComponentView.mm not found in react-native-slider — nothing to remove'`,
        `      else`,
        `        puts '[OldArchFix] ✓ Removed RNCSliderComponentView.mm from react-native-slider Compile Sources'`,
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
        const match = before.match(/post_install[\s\S]{0,400}/);
        if (match) console.warn('[OldArchFix] post_install block:\n' + match[0]);
      } else {
        fs.writeFileSync(podfilePath, podfile, 'utf8');
        console.log('[OldArchFix] ✓ Patched Podfile — will remove RNCSliderComponentView.mm from Compile Sources at pod install time');
      }

      return mod;
    },
  ]);
}

module.exports = withOldArchFixes;
