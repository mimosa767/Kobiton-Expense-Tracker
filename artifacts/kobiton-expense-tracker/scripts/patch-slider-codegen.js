#!/usr/bin/env node
/**
 * postinstall: patch-slider-codegen.js
 *
 * React Native's Xcode Codegen build phase scans node_modules directly for
 * any package.json containing a "codegenConfig" field — independently of
 * Expo Autolinking. If @react-native-community/slider exists anywhere in
 * node_modules (e.g. as a pnpm phantom dep), Codegen picks up RNCSlider
 * and generates RNCSliderComponentView.mm, causing Old Arch build failures.
 *
 * This script removes the codegenConfig field from slider's package.json
 * after every `pnpm install`, making Codegen skip it entirely.
 *
 * @react-native-community/slider@5.1.2 codegenConfig:
 * {
 *   "name": "RNCSlider",
 *   "type": "components",
 *   "jsSrcsDir": "src",
 *   "ios": { "componentProvider": { "RNCSlider": "RNCSliderComponentView" } },
 *   "android": { "javaPackageName": "com.reactnativecommunity.slider" }
 * }
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const CANDIDATE_PATHS = [
  path.join(ROOT, 'node_modules/@react-native-community/slider/package.json'),
  path.join(ROOT, 'node_modules/.pnpm/@react-native-community+slider@5.1.2/node_modules/@react-native-community/slider/package.json'),
  path.join(ROOT, '../../node_modules/@react-native-community/slider/package.json'),
  path.join(ROOT, '../../node_modules/.pnpm/@react-native-community+slider@5.1.2/node_modules/@react-native-community/slider/package.json'),
];

let patched = 0;

for (const candidate of CANDIDATE_PATHS) {
  try {
    const resolved = fs.realpathSync(candidate);
    const raw = fs.readFileSync(resolved, 'utf8');
    const pkg = JSON.parse(raw);

    if (pkg.codegenConfig) {
      delete pkg.codegenConfig;
      fs.writeFileSync(resolved, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`[patch-slider-codegen] Removed codegenConfig from: ${resolved}`);
      patched++;
    } else {
      console.log(`[patch-slider-codegen] Already clean (no codegenConfig): ${resolved}`);
    }
  } catch {
    // File doesn't exist at this path — skip silently
  }
}

if (patched === 0) {
  console.log('[patch-slider-codegen] @react-native-community/slider not found in node_modules — nothing to patch.');
} else {
  console.log(`[patch-slider-codegen] Done. Patched ${patched} file(s). Codegen will skip RNCSlider.`);
}
