#!/usr/bin/env node
/**
 * assert-slider-clean.js
 *
 * Runs AFTER patch-slider-codegen.js and BEFORE expo prebuild --clean.
 * Asserts that no slider package.json anywhere in node_modules still
 * contains a codegenConfig field. Fails loudly (exit 1) if it does.
 *
 * Two completely independent search strategies are used:
 *
 *   Strategy A — readdirSync traversal (same logic as patch script):
 *     Walks candidate roots, scans node_modules/.pnpm/ directory listing,
 *     and checks the direct node_modules symlink path.
 *
 *   Strategy B — `find` via execSync (independent code path):
 *     Runs the shell `find` command from each candidate root, matching
 *     any file named package.json under a @react-native-community/slider path.
 *     Completely independent from Strategy A — different OS subsystem,
 *     different traversal algorithm, catches any paths A might miss.
 *
 * The UNION of all files found by either strategy is asserted to be clean.
 * If either strategy finds a file with codegenConfig, the build fails here
 * with a precise error rather than a cryptic Xcode compile failure later.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(msg)  { process.stdout.write('[assert-slider-clean] ' + msg + '\n'); }
function fail(msg) {
  process.stderr.write('[assert-slider-clean] ASSERT FAILED — ' + msg + '\n');
  process.exit(1);
}

// ── Candidate roots used by both strategies ──────────────────────────────────

const candidateRoots = new Set();
candidateRoots.add(process.cwd());
candidateRoots.add('/Users/expo/workingdir/build'); // confirmed EAS path

let dir = __dirname;
for (let i = 0; i < 6; i++) {
  candidateRoots.add(dir);
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

// ── Strategy A: readdirSync traversal ───────────────────────────────────────

const foundA = new Set();

for (const root of candidateRoots) {
  // A1. Direct symlink / hoisted path
  const directPkg = path.join(root, 'node_modules/@react-native-community/slider/package.json');
  try { foundA.add(fs.realpathSync(directPkg)); } catch { /* not present */ }

  // A2. pnpm virtual store — scan .pnpm/ dir listing for any slider variant
  const pnpmDir = path.join(root, 'node_modules/.pnpm');
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('@react-native-community+slider@')) continue;
      const pkgJson = path.join(
        pnpmDir, entry,
        'node_modules/@react-native-community/slider/package.json'
      );
      try { foundA.add(fs.realpathSync(pkgJson)); } catch { /* doesn't resolve */ }
    }
  } catch { /* .pnpm absent at this root */ }
}

log('Strategy A (readdirSync) found ' + foundA.size + ' slider package.json file(s).');

// ── Strategy B: find via execSync ────────────────────────────────────────────
// Completely independent — different traversal, different OS subsystem.
// Limited to maxdepth 8 so it doesn't scan the whole filesystem.

const foundB = new Set();

for (const root of candidateRoots) {
  if (!fs.existsSync(path.join(root, 'node_modules'))) continue;
  try {
    const result = execSync(
      `find "${root}/node_modules" -maxdepth 8 -name "package.json" -path "*/@react-native-community/slider/package.json" 2>/dev/null || true`,
      { encoding: 'utf8', timeout: 20000 }
    ).trim();
    if (result) {
      for (const line of result.split('\n').filter(Boolean)) {
        try { foundB.add(fs.realpathSync(line)); } catch { foundB.add(line); }
      }
    }
  } catch (e) {
    log('Strategy B find error at ' + root + ': ' + e.message + ' — skipping this root.');
  }
}

log('Strategy B (find execSync) found ' + foundB.size + ' slider package.json file(s).');

// ── Union: every file found by either strategy must be clean ─────────────────

const allFound = new Set([...foundA, ...foundB]);

if (allFound.size === 0) {
  log('No slider package.json found by either strategy — safe to proceed with expo prebuild.');
  process.exit(0);
}

log('Union of both strategies: ' + allFound.size + ' file(s) to assert.');

let violations = 0;
for (const pkgPath of allFound) {
  const foundBy = (foundA.has(pkgPath) ? 'A' : '') + (foundB.has(pkgPath) ? 'B' : '');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.codegenConfig) {
      violations++;
      fail(
        'codegenConfig still present in: ' + pkgPath + '\n' +
        '  Found by strategy: ' + foundBy + '\n' +
        '  patch-slider-codegen.js did not remove it.\n' +
        '  codegenConfig: ' + JSON.stringify(pkg.codegenConfig, null, 2)
      );
    } else {
      log('CLEAN [strategy ' + foundBy + '] — no codegenConfig in: ' + pkgPath);
    }
  } catch (e) {
    if (e.message && e.message.startsWith('[assert-slider-clean]')) throw e; // re-throw fail()
    log('Could not read ' + pkgPath + ' (' + e.message + ') — skipping.');
  }
}

if (violations === 0) {
  log(
    'All ' + allFound.size + ' slider package.json file(s) verified clean by both strategies. ' +
    'Safe to proceed with expo prebuild.'
  );
}
