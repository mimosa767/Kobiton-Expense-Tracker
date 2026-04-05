/**
 * withOldArchFixes — Expo Config Plugin
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
 * Pinning to 5.0.1 was never going to work.
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
 *   EAS caches the Pods directory (keyed by Podfile.lock). Our post_install
 *   change does not alter any pod dependency so Podfile.lock is unchanged.
 *   EAS restores Pods from cache → pod install skipped → hook never runs.
 *
 * Fix 4 — withDangerousMod stubs the file in node_modules (previous attempt):
 *   The find command searched inside artifacts/kobiton-expense-tracker/ but
 *   the pnpm workspace stores node_modules at the WORKSPACE ROOT (two levels
 *   up, alongside pnpm-workspace.yaml). No files were found → no stub applied.
 *
 * --------------------------------------------------------------------------
 * CORRECT FIX (this version)
 * --------------------------------------------------------------------------
 *
 * PRIMARY: Walk up from projectRoot to find the pnpm workspace root
 * (detected by pnpm-workspace.yaml or package.json + pnpm-lock.yaml).
 * Search ALL node_modules trees from that root for RNCSliderComponentView.mm.
 * Wrap the file content with #if RCT_NEW_ARCH_ENABLED / #endif so it
 * compiles to nothing in Old Architecture builds.
 *
 * This runs during expo prebuild — before pod install, before Xcode, and
 * regardless of EAS Pods cache state. The modified file is on disk before
 * Xcode ever sees it.
 *
 * BACKUP: Also patch the Podfile post_install to remove the file from the
 * Compile Sources build phase for builds where pod install runs fresh.
 *
 * STUB STRATEGY: We do NOT delete the file (CocoaPods has it in the Xcode
 * build phase; a missing file causes its own error). We wrap the content in
 * an #if guard — empty in Old Arch, full class in New Arch.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PODFILE_MARKER = '# [OldArchFix] Remove RNCSliderComponentView.mm from Compile Sources';
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

// ─── Primary fix: stub RNCSliderComponentView.mm in node_modules ─────────────

function stubSliderFabricFile(projectRoot) {
  const wsRoot = findWorkspaceRoot(projectRoot);
  console.log('[OldArchFix] Workspace root detected: ' + wsRoot);

  // Collect candidate search roots — cover both the workspace root and the
  // project root itself in case of a non-monorepo layout.
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

// ─── Backup fix: Podfile post_install removal ─────────────────────────────────

function patchPodfilePostInstall(podfilePath) {
  if (!fs.existsSync(podfilePath)) {
    console.warn('[OldArchFix] ⚠ Podfile not found at ' + podfilePath);
    return;
  }

  let podfile = fs.readFileSync(podfilePath, 'utf8');

  if (podfile.includes(PODFILE_MARKER)) {
    console.log('[OldArchFix] ✓ Podfile already patched');
    return;
  }

  const rubyInjection = [
    `    ${PODFILE_MARKER}`,
    `    # Backup fix: removes RNCSliderComponentView.mm from Compile Sources when`,
    `    # pod install runs fresh (no EAS Pods cache hit).`,
    `    # Primary fix: the file is already guarded via #if RCT_NEW_ARCH_ENABLED`,
    `    # in node_modules by withOldArchFixes.js (runs during expo prebuild).`,
    `    installer.pods_project.targets.each do |t|`,
    `      next unless t.name == 'react-native-slider'`,
    `      fabric_files = t.source_build_phase.files.select do |bf|`,
    `        bf.file_ref&.path&.end_with?('RNCSliderComponentView.mm')`,
    `      end`,
    `      fabric_files.each { |bf| t.source_build_phase.files.delete(bf) }`,
    `      unless fabric_files.empty?`,
    `        puts '[OldArchFix] ✓ Removed RNCSliderComponentView.mm from react-native-slider Compile Sources'`,
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
    console.log('[OldArchFix] ✓ Patched Podfile post_install (backup)');
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
      patchPodfilePostInstall(podfilePath);

      return mod;
    },
  ]);
}

module.exports = withOldArchFixes;
