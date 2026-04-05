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
 * Why the old approach failed:
 *   - Hardcoded .pnpm dir name "@react-native-community+slider@5.1.2" misses
 *     the peer-dep hash suffix pnpm appends (e.g. @5.1.2_react@19.1.0+...).
 *   - process.cwd() was not used, which on EAS is the monorepo root — the
 *     most reliable anchor for finding the pnpm virtual store.
 *
 * Strategy:
 *   1. Collect candidate monorepo roots: process.cwd() + walk up from __dirname
 *   2. For each root, scan node_modules/.pnpm/ for any slider-named directory
 *   3. Patch package.json in every match; also check direct node_modules symlink
 */

const fs = require('fs');
const path = require('path');

function log(msg) {
  process.stdout.write('[patch-slider-codegen] ' + msg + '\n');
}

// ── 1. Collect candidate monorepo roots ─────────────────────────────────────

const candidateRoots = new Set();

// process.cwd() is most reliable on EAS (pnpm runs lifecycle from monorepo root)
candidateRoots.add(process.cwd());

// Walk up from __dirname until we've checked 6 levels
let dir = __dirname;
for (let i = 0; i < 6; i++) {
  candidateRoots.add(dir);
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

// ── 2. Find all slider package.json files ───────────────────────────────────

const toSearch = new Set(); // resolved real paths to patch

for (const root of candidateRoots) {
  // 2a. Direct symlink path (works when slider is hoisted or directly linked)
  const directPkg = path.join(root, 'node_modules/@react-native-community/slider/package.json');
  try {
    toSearch.add(fs.realpathSync(directPkg));
  } catch { /* not present */ }

  // 2b. Scan .pnpm/ for any directory that starts with the slider package name
  //     pnpm appends peer-dep hashes: e.g. @react-native-community+slider@5.1.2_react@19.1.0+...
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
        // Use the real path so we don't double-patch through symlinks
        toSearch.add(fs.realpathSync(pkgJson));
      } catch { /* path doesn't resolve */ }
    }
  } catch { /* .pnpm dir doesn't exist at this root */ }
}

// ── 3. Patch every discovered package.json ───────────────────────────────────

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
    } else {
      log('Already clean (no codegenConfig): ' + pkgPath);
    }
  } catch (e) {
    log('ERROR reading/writing ' + pkgPath + ': ' + e.message);
  }
}

log('Done. ' + patched + ' file(s) patched. Codegen will skip RNCSlider.');
