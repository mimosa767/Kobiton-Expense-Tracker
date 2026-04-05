/**
 * withOldArchFixes — Expo Config Plugin v4.5.0
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
 * Fix 3 — post_install: removes file from Compile Sources build phase.
 *   EAS caches the Pods directory keyed by Podfile.lock. The cached Pods were
 *   built before this hook existed. EAS restores the cache and skips pod install
 *   entirely — hook never fires.
 *
 * Fix 4 — pre_install: removes file from pod file_accessors before Xcode
 *   project generation. Same problem — EAS Pods cache is separate from
 *   Podfile.lock; even a checksum change did not bust the cache in practice.
 *
 * --------------------------------------------------------------------------
 * DEFINITIVE FIX (v4.5.0)
 * --------------------------------------------------------------------------
 *
 * KEY INSIGHT: Even when EAS restores the Pods directory from cache and skips
 * pod install entirely, Xcode still reads source files directly from
 * node_modules — NOT from inside the Pods directory. The Pods directory only
 * contains the Xcode project (references). The actual .mm files live in
 * node_modules.
 *
 * Therefore: zero out RNCSliderComponentView.mm in node_modules during
 * expo prebuild (which ALWAYS runs, before pod install, before Xcode).
 * Xcode compiles an empty stub → no error.
 *
 * LAYER 0 — Zero out the file in node_modules (PRIMARY, cache-immune):
 *   Search EAS build machine path (/Users/expo/workingdir/build/node_modules)
 *   AND the workspace root node_modules. Overwrite every found copy with a
 *   1-line stub comment. Runs during expo prebuild, before everything else.
 *
 * LAYER 1 — pnpm patch (belt-and-suspenders):
 *   Root package.json pnpm.overrides + pnpm.patchedDependencies wraps the
 *   file in #if RCT_NEW_ARCH_ENABLED during pnpm install.
 *
 * LAYER 2 — Podfile pre_install hook:
 *   Removes the file from the slider pod's file_accessors before the Xcode
 *   project is generated (runs when pod install is not cached).
 *
 * LAYER 3 — Podfile post_install hook:
 *   Removes the file from the Compile Sources build phase in post_install
 *   (runs when pod install is not cached).
 */

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PRE_INSTALL_MARKER = '# [OldArchFix v4.4.0] pre_install: remove RNCSliderComponentView.mm';
const POST_INSTALL_MARKER = '# [OldArchFix] Remove RNCSliderComponentView.mm from Compile Sources';

const EMPTY_STUB =
  '// [OldArchFix v4.5.0] RNCSliderComponentView.mm zeroed out for Old Architecture compatibility.\n' +
  '// This file uses Fabric (New Architecture) APIs that are not available in Old Architecture builds.\n' +
  '// Zeroed by withOldArchFixes.js during expo prebuild.\n';

// ─── Workspace root detection ────────────────────────────────────────────────

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
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

// ─── Layer 0: Zero out the file in all node_modules locations ────────────────
//
// This is the PRIMARY, cache-immune fix. Xcode reads source files from
// node_modules directly — even when Pods are cached. Overwriting the file
// here guarantees Xcode compiles an empty stub, regardless of cache state.

function zeroOutSliderFabricFile(projectRoot) {
  const wsRoot = findWorkspaceRoot(projectRoot);

  // All paths to search — include the hardcoded EAS build machine path first.
  const searchRoots = [
    '/Users/expo/workingdir/build/node_modules',  // EAS Mac build machine
    path.join(wsRoot, 'node_modules'),             // pnpm workspace root
    path.join(projectRoot, 'node_modules'),        // project root fallback
  ].filter((p, i, arr) => arr.indexOf(p) === i);  // deduplicate

  console.log('[OldArchFix v4.5.0] Zeroing out RNCSliderComponentView.mm');
  console.log('[OldArchFix] Search roots: ' + searchRoots.join(', '));

  let found = 0;

  for (const searchRoot of searchRoots) {
    if (!fs.existsSync(searchRoot)) {
      console.log('[OldArchFix] ✗ Not found: ' + searchRoot);
      continue;
    }

    let files = [];
    try {
      const result = execSync(
        'find "' + searchRoot + '" -name "RNCSliderComponentView.mm" 2>/dev/null',
        { encoding: 'utf8', timeout: 30000 }
      );
      files = result.trim().split('\n').filter(Boolean);
    } catch (_) {
      // find returned non-zero or timed out — no files found
    }

    for (const filePath of files) {
      try {
        const existing = fs.readFileSync(filePath, 'utf8');
        if (existing === EMPTY_STUB) {
          console.log('[OldArchFix] ✓ Already zeroed: ' + filePath);
          found++;
          continue;
        }
        fs.writeFileSync(filePath, EMPTY_STUB, 'utf8');
        console.log('[OldArchFix] ✓ Zeroed out: ' + filePath);
        found++;
      } catch (err) {
        console.warn('[OldArchFix] ⚠ Could not zero out ' + filePath + ': ' + err.message);
      }
    }
  }

  if (found === 0) {
    console.log('[OldArchFix] ℹ  RNCSliderComponentView.mm not found in any search root.');
    console.log('[OldArchFix] ℹ  This is OK if pnpm overrides + patch removed slider@5.x entirely.');
  }
}

// ─── Layer 2: Podfile pre_install hook ───────────────────────────────────────

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
    `# Removes RNCSliderComponentView.mm from slider pod file_accessors BEFORE`,
    `# the Xcode project is generated — file never enters Compile Sources.`,
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

  const before = podfile;
  podfile = podfile.replace(/([ \t]*post_install do)/, `${preInstallBlock}$1`);

  if (podfile === before) {
    console.warn('[OldArchFix] ⚠ Could not inject pre_install block into Podfile');
  } else {
    fs.writeFileSync(podfilePath, podfile, 'utf8');
    console.log('[OldArchFix] ✓ Injected pre_install block into Podfile');
  }
}

// ─── Layer 3: Podfile post_install hook ──────────────────────────────────────

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

      // Layer 0: zero out the file in node_modules (PRIMARY — runs first)
      zeroOutSliderFabricFile(projectRoot);

      // Layer 2: pre_install hook (runs when pod install is not cached)
      patchPodfilePreInstall(podfilePath);

      // Layer 3: post_install hook (belt-and-suspenders)
      patchPodfilePostInstall(podfilePath);

      return mod;
    },
  ]);
}

module.exports = withOldArchFixes;
