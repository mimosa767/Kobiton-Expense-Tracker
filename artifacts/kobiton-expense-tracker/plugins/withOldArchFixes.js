/**
 * withOldArchFixes — Expo Config Plugin v4.4.0
 *
 * Fixes @react-native-community/slider ≥ 5.0.0 compilation failure when
 * building with newArchEnabled: false (Old Architecture).
 *
 * --------------------------------------------------------------------------
 * ROOT CAUSE
 * --------------------------------------------------------------------------
 * slider ≥ 5.0.0 ships RNCSliderComponentView.mm, a Fabric component view
 * that hard-imports New Architecture codegen headers:
 *
 *   #import <react/renderer/components/RNCSlider/RNCSliderComponentDescriptor.h>
 *
 * These headers are only generated when newArchEnabled: true. In an Old
 * Architecture build they don't exist → fatal compile error.
 *
 * NOTE: BOTH slider@5.0.1 and slider@5.1.2 have this problematic import.
 * Pinning to 5.0.1 was never going to work without also patching the file.
 *
 * --------------------------------------------------------------------------
 * WHY PREVIOUS FIXES FAILED
 * --------------------------------------------------------------------------
 *
 * Fix 1 — pin to 5.0.1: 5.0.1 has the SAME import. Pinning never helped.
 *
 * Fix 2 — EXCLUDED_SOURCE_FILE_NAMES = 'RNCSliderComponentView.mm':
 *   Xcode matches against the full relative path (../../../node_modules/...),
 *   not just the filename. Bare filename silently matches nothing.
 *
 * Fix 3 — remove from Compile Sources via Podfile post_install:
 *   EAS caches the Pods directory (keyed by Podfile.lock). If the Pods
 *   directory was cached from a build without this fix, pod install (and
 *   therefore post_install) is skipped → hook never runs → broken cache
 *   served to Xcode.
 *
 * Fix 4 — withDangerousMod stubs the file in node_modules (previous attempt):
 *   The find command searched inside artifacts/kobiton-expense-tracker/ but
 *   the pnpm workspace stores node_modules at the WORKSPACE ROOT (two levels
 *   up, alongside pnpm-workspace.yaml). No files were found → no stub applied.
 *
 * --------------------------------------------------------------------------
 * CORRECT FIX (this version — v4.4.0)
 * --------------------------------------------------------------------------
 *
 * LAYER 1 — pnpm patch (EAS-cache-immune):
 *   Root package.json pnpm.overrides forces slider@5.0.1 and
 *   pnpm.patchedDependencies registers patches/@react-native-community__slider@5.0.1.patch.
 *   The patch wraps RNCSliderComponentView.mm in #if RCT_NEW_ARCH_ENABLED.
 *   Applied during pnpm install itself — cannot be bypassed by any EAS cache.
 *
 * LAYER 2 — withDangerousMod node_modules guard (corrected workspace root):
 *   Walk up from projectRoot to find the pnpm workspace root (via
 *   pnpm-workspace.yaml detection). Guard ALL RNCSliderComponentView.mm
 *   copies with #if RCT_NEW_ARCH_ENABLED / #endif so the file compiles to
 *   nothing in Old Architecture builds. Runs during expo prebuild.
 *
 * LAYER 3 — Podfile pre_install hook (cache-busting + correct Xcode project):
 *   Injects a pre_install block into the Podfile that removes
 *   RNCSliderComponentView.mm from the slider pod's file_accessors BEFORE
 *   the Xcode project is generated. This means the file is never in the
 *   Compile Sources build phase in the generated .xcodeproj.
 *
 *   CRITICAL: Adding any code to the Podfile changes its SHA1, which changes
 *   the PODFILE CHECKSUM entry in Podfile.lock. EAS keys Pods cache by
 *   Podfile.lock content, so a checksum change forces a fresh pod install,
 *   which runs our pre_install hook — busting any stale cached Pods.
 *
 * LAYER 4 — Podfile post_install hook (belt-and-suspenders):
 *   Also removes the file from the Compile Sources build phase in post_install
 *   for any edge case where pre_install did not catch it.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PRE_INSTALL_MARKER = '# [OldArchFix v4.4.0] pre_install: remove RNCSliderComponentView.mm';
const POST_INSTALL_MARKER = '# [OldArchFix] Remove RNCSliderComponentView.mm from Compile Sources';
const STUB_GUARD_MARKER = '// [OldArchFix] guarded for Old Architecture compatibility';

// ─── Workspace root detection ────────────────────────────────────────────────

/**
 * Walk up from startDir until we find a directory that looks like the pnpm
 * workspace root (has pnpm-workspace.yaml, or package.json + pnpm-lock.yaml).
 * Falls back to startDir if nothing found within 6 levels.
 */
function findWorkspaceRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    if (
      fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
      (fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) &&
        fs.existsSync(path.join(dir, 'package.json')))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return startDir;
}

// ─── Layer 2: node_modules #if guard (expo prebuild, runs before pod install) ─

function stubSliderFabricFile(projectRoot) {
  const wsRoot = findWorkspaceRoot(projectRoot);
  console.log('[OldArchFix] Workspace root detected: ' + wsRoot);

  const searchRoots = [...new Set([wsRoot, projectRoot])];

  let found = 0;
  for (const searchRoot of searchRoots) {
    const nmDir = path.join(searchRoot, 'node_modules');
    if (!fs.existsSync(nmDir)) continue;

    let files = [];
    try {
      const result = execSync(
        'find "' + nmDir + '" -name "RNCSliderComponentView.mm" ' +
          '-path "*/@react-native-community/slider/*" 2>/dev/null',
        { encoding: 'utf8', timeout: 20000 }
      );
      files = result.trim().split('\n').filter(Boolean);
    } catch (_) {
      // find returned non-zero (no matches) or timed out
    }

    for (const absPath of files) {
      try {
        const original = fs.readFileSync(absPath, 'utf8');

        if (original.includes(STUB_GUARD_MARKER)) {
          console.log('[OldArchFix] ✓ Already guarded: ' + absPath);
          found++;
          continue;
        }

        const guarded =
          STUB_GUARD_MARKER + '\n' +
          '// RNCSliderComponentView.mm uses Fabric (New Architecture) APIs.\n' +
          '// Guarded by withOldArchFixes.js for Old Architecture builds.\n' +
          '#if RCT_NEW_ARCH_ENABLED\n' +
          original +
          '\n#endif // RCT_NEW_ARCH_ENABLED\n';

        fs.writeFileSync(absPath, guarded, 'utf8');
        console.log('[OldArchFix] ✓ Guarded with #if RCT_NEW_ARCH_ENABLED: ' + absPath);
        found++;
      } catch (err) {
        console.warn('[OldArchFix] ⚠ Could not guard ' + absPath + ': ' + err.message);
      }
    }
  }

  if (found === 0) {
    console.log(
      '[OldArchFix] ℹ  RNCSliderComponentView.mm not found under any node_modules root. ' +
        'Searched: ' + searchRoots.join(', ')
    );
  }
}

// ─── Layer 3: Podfile pre_install hook ───────────────────────────────────────
//
// Injected before the post_install block. Removes RNCSliderComponentView.mm
// from the slider pod's file_accessors BEFORE the Xcode project is generated.
// Adding any new code to the Podfile changes its SHA1, which changes the
// PODFILE CHECKSUM in Podfile.lock, busting the EAS Pods cache.

function patchPodfilePreInstall(podfilePath) {
  if (!fs.existsSync(podfilePath)) {
    console.warn('[OldArchFix] ⚠ Podfile not found at ' + podfilePath);
    return;
  }

  let podfile = fs.readFileSync(podfilePath, 'utf8');

  if (podfile.includes(PRE_INSTALL_MARKER)) {
    console.log('[OldArchFix] ✓ Podfile pre_install already patched');
    return;
  }

  const preInstallBlock = [
    ``,
    `${PRE_INSTALL_MARKER}`,
    `# Removes the Fabric-only component view from the slider pod's source file list`,
    `# BEFORE the Xcode project is generated — so it is never in Compile Sources.`,
    `# Adding this block changes the Podfile SHA1, which changes the PODFILE CHECKSUM`,
    `# in Podfile.lock, forcing EAS to bust its Pods cache and run pod install fresh.`,
    `pre_install do |installer|`,
    `  slider_pod = installer.pod_targets.find { |t| t.name == 'react-native-slider' }`,
    `  if slider_pod`,
    `    slider_pod.file_accessors.each do |fa|`,
    `      fa.source_files.reject! { |f| f.basename.to_s == 'RNCSliderComponentView.mm' }`,
    `    end`,
    `    puts '[OldArchFix] ✓ pre_install: removed RNCSliderComponentView.mm from react-native-slider'`,
    `  end`,
    `end`,
    ``,
  ].join('\n');

  // Inject immediately before post_install — handles any indentation level
  const before = podfile;
  podfile = podfile.replace(/([ \t]*post_install do)/, `${preInstallBlock}$1`);

  if (podfile === before) {
    console.warn('[OldArchFix] ⚠ Could not inject pre_install block into Podfile');
  } else {
    fs.writeFileSync(podfilePath, podfile, 'utf8');
    console.log('[OldArchFix] ✓ Injected pre_install block into Podfile (cache-busting)');
  }
}

// ─── Layer 4: Podfile post_install hook (belt-and-suspenders) ────────────────

function patchPodfilePostInstall(podfilePath) {
  if (!fs.existsSync(podfilePath)) {
    console.warn('[OldArchFix] ⚠ Podfile not found at ' + podfilePath);
    return;
  }

  let podfile = fs.readFileSync(podfilePath, 'utf8');

  if (podfile.includes(POST_INSTALL_MARKER)) {
    console.log('[OldArchFix] ✓ Podfile post_install already patched');
    return;
  }

  const rubyInjection = [
    `    ${POST_INSTALL_MARKER}`,
    `    # Belt-and-suspenders: also remove from Compile Sources in post_install.`,
    `    installer.pods_project.targets.each do |t|`,
    `      next unless t.name == 'react-native-slider'`,
    `      fabric_files = t.source_build_phase.files.select do |bf|`,
    `        bf.file_ref&.path&.end_with?('RNCSliderComponentView.mm')`,
    `      end`,
    `      fabric_files.each { |bf| t.source_build_phase.files.delete(bf) }`,
    `      unless fabric_files.empty?`,
    `        puts '[OldArchFix] ✓ post_install: removed RNCSliderComponentView.mm from react-native-slider Compile Sources'`,
    `      end`,
    `    end`,
    ``,
  ].join('\n');

  const before = podfile;
  podfile = podfile.replace(
    /^(\s+react_native_post_install\()/m,
    `${rubyInjection}$1`
  );

  if (podfile === before) {
    console.warn('[OldArchFix] ⚠ Could not inject into Podfile post_install');
  } else {
    fs.writeFileSync(podfilePath, podfile, 'utf8');
    console.log('[OldArchFix] ✓ Patched Podfile post_install (belt-and-suspenders)');
  }
}

// ─── Plugin entry point ───────────────────────────────────────────────────────

function withOldArchFixes(config) {
  return withDangerousMod(config, [
    'ios',
    (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const podfilePath = path.join(mod.modRequest.platformProjectRoot, 'Podfile');

      stubSliderFabricFile(projectRoot);
      patchPodfilePreInstall(podfilePath);
      patchPodfilePostInstall(podfilePath);

      return mod;
    },
  ]);
}

module.exports = withOldArchFixes;
