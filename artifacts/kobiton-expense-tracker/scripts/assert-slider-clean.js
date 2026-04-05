#!/usr/bin/env node
/**
 * assert-slider-clean.js
 *
 * Runs AFTER patch-slider-codegen.js and BEFORE expo prebuild --clean.
 * Asserts that no slider package.json in node_modules still contains
 * a codegenConfig field. Fails the build loudly (exit 1) if it does,
 * giving a precise diagnosis before Xcode ever starts.
 *
 * Uses the same candidate-root discovery as patch-slider-codegen.js,
 * plus the confirmed EAS hardcoded path as an explicit check.
 */

const fs = require('fs');
const path = require('path');

function log(msg)  { process.stdout.write('[assert-slider-clean] ' + msg + '\n'); }
function fail(msg) { process.stderr.write('[assert-slider-clean] ASSERT FAILED — ' + msg + '\n'); process.exit(1); }

// ── 1. Collect candidate roots (same strategy as patch script) ───────────────

const candidateRoots = new Set();
candidateRoots.add(process.cwd());

// Confirmed EAS path — check explicitly as first-class candidate
candidateRoots.add('/Users/expo/workingdir/build');

let dir = __dirname;
for (let i = 0; i < 6; i++) {
  candidateRoots.add(dir);
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

// ── 2. Find all slider package.json files (same strategy as patch script) ────

const toCheck = new Set();

for (const root of candidateRoots) {
  // Direct symlink path
  const directPkg = path.join(root, 'node_modules/@react-native-community/slider/package.json');
  try { toCheck.add(fs.realpathSync(directPkg)); } catch { /* not present */ }

  // Scan .pnpm/ for any slider variant (handles peer-dep hash suffixes)
  const pnpmDir = path.join(root, 'node_modules/.pnpm');
  try {
    const entries = fs.readdirSync(pnpmDir);
    for (const entry of entries) {
      if (!entry.startsWith('@react-native-community+slider@')) continue;
      const pkgJson = path.join(
        pnpmDir, entry,
        'node_modules/@react-native-community/slider/package.json'
      );
      try { toCheck.add(fs.realpathSync(pkgJson)); } catch { /* path doesn't resolve */ }
    }
  } catch { /* .pnpm dir doesn't exist here */ }
}

// ── 3. Assert every discovered file is clean ─────────────────────────────────

if (toCheck.size === 0) {
  log('slider not found in any node_modules — safe to proceed with expo prebuild.');
  process.exit(0);
}

let violations = 0;
for (const pkgPath of toCheck) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.codegenConfig) {
      violations++;
      fail(
        'codegenConfig still present in: ' + pkgPath + '\n' +
        '  patch-slider-codegen.js did not remove it (file may be read-only or owned by another process).\n' +
        '  codegenConfig value: ' + JSON.stringify(pkg.codegenConfig)
      );
    } else {
      log('CLEAN — no codegenConfig in: ' + pkgPath);
    }
  } catch (e) {
    // If we can't read it, it's not going to cause a Codegen failure either.
    log('Could not read ' + pkgPath + ' (' + e.message + ') — skipping.');
  }
}

if (violations === 0) {
  log('All ' + toCheck.size + ' slider package.json file(s) are clean — safe to proceed with expo prebuild.');
}
