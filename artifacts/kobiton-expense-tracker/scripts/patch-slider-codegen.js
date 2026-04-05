#!/usr/bin/env node
/**
 * postinstall: patch-slider-codegen.js
 *
 * React Native Xcode Codegen scans node_modules directly for package.json
 * files with a "codegenConfig" field — independently of Expo Autolinking.
 * @react-native-community/slider@5.1.2 has codegenConfig.ios.componentProvider
 * pointing to RNCSliderComponentView, which breaks Old Arch iOS builds.
 *
 * This script removes that field after every pnpm install.
 *
 * Triggered from two independent points:
 *   1. Root package.json postinstall (after pnpm install)
 *   2. eas.json prebuildCommand (unconditionally before expo prebuild)
 */

const fs = require('fs');
const path = require('path');

function log(msg) {
  process.stdout.write('[patch-slider-codegen] ' + msg + '\n');
}

// ── 1. Collect candidate monorepo roots ─────────────────────────────────────
// process.cwd() is the monorepo root when pnpm runs lifecycle scripts on EAS.
// Walk up from __dirname as additional fallback for any other context.

const candidateRoots = new Set();
candidateRoots.add(process.cwd());

// Confirmed EAS build path — explicit fallback in case process.cwd() differs
candidateRoots.add('/Users/expo/workingdir/build');

let dir = __dirname;
for (let i = 0; i < 6; i++) {
  candidateRoots.add(dir);
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

// ── 2. Find all slider package.json files ────────────────────────────────────

const toSearch = new Set();

for (const root of candidateRoots) {
  // 2a. Direct symlink path (when slider is hoisted or directly linked)
  const directPkg = path.join(root, 'node_modules/@react-native-community/slider/package.json');
  try {
    toSearch.add(fs.realpathSync(directPkg));
  } catch { /* not present */ }

  // 2b. Scan .pnpm/ for any directory matching the slider package.
  //     pnpm appends peer-dep hashes: e.g. @react-native-community+slider@5.1.2_react@19.1.0+...
  //     The exact dir name is confirmed as @react-native-community+slider@5.1.2 (no hash)
  //     on EAS, but we scan dynamically to handle any variant.
  const pnpmDir = path.join(root, 'node_modules/.pnpm');
  try {
    const entries = fs.readdirSync(pnpmDir);
    for (const entry of entries) {
      if (!entry.startsWith('@react-native-community+slider@')) continue;
      const pkgJson = path.join(
        pnpmDir, entry,
        'node_modules/@react-native-community/slider/package.json'
      );
      try {
        toSearch.add(fs.realpathSync(pkgJson));
      } catch { /* path doesn't resolve */ }
    }
  } catch { /* .pnpm dir doesn't exist at this root */ }
}

// ── 3. Patch every discovered package.json ────────────────────────────────────

if (toSearch.size === 0) {
  log('@react-native-community/slider not found in any node_modules — nothing to patch.');
  process.exit(0);
}

let patched = 0;
for (const pkgPath of toSearch) {
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);

    if (pkg.codegenConfig) {
      delete pkg.codegenConfig;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      log('PATCHED — removed codegenConfig from: ' + pkgPath);
      patched++;

      // ── Hard verification: re-read and assert codegenConfig is gone ────────
      const verify = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (verify.codegenConfig) {
        process.stderr.write(
          '[patch-slider-codegen] FATAL — codegenConfig still present after write in: ' +
          pkgPath + '\n' +
          'This likely means the file is read-only or owned by another process.\n'
        );
        process.exit(1);
      }
      log('VERIFIED — codegenConfig absent after write: ' + pkgPath);
    } else {
      log('Already clean (no codegenConfig): ' + pkgPath);
    }
  } catch (e) {
    process.stderr.write('[patch-slider-codegen] ERROR reading/writing ' + pkgPath + ': ' + e.message + '\n');
    process.exit(1);
  }
}

log('Done. ' + patched + ' file(s) patched. Codegen will skip RNCSlider.');
