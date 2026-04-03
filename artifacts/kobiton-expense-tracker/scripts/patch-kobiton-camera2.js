#!/usr/bin/env node
/**
 * patch-kobiton-camera2.js
 *
 * Runs automatically after every `pnpm install` (postinstall).
 * Replaces stock Android camera2 imports in react-native-vision-camera
 * source files with Kobiton SDK equivalents, enabling Kobiton's image
 * injection SDK to intercept all camera2 API calls at compile time.
 *
 * Targets — 3 lines across 2 files:
 *
 *   CameraDevicesManager.kt
 *     import android.hardware.camera2.CameraManager
 *       → import kobiton.hardware.camera2.CameraManager
 *     reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
 *       → CameraManager.getInstance(reactContext)
 *
 *   ImageAnalysis.Builder+setTargetFrameRate.kt
 *     import android.hardware.camera2.CaptureRequest
 *       → import kobiton.hardware.camera2.CaptureRequest
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Locate react-native-vision-camera package root ───────────────────────────

let vcamRoot;
try {
  const pkgJson = require.resolve('react-native-vision-camera/package.json');
  vcamRoot = path.dirname(pkgJson);
} catch {
  console.warn(
    '[kobiton-camera2-patch] ⚠ react-native-vision-camera not found in node_modules — skipping.'
  );
  process.exit(0);
}

const androidSrc = path.join(vcamRoot, 'android', 'src', 'main', 'java');

// ── Patch definitions ────────────────────────────────────────────────────────

const PATCHES = [
  {
    file: path.join(
      androidSrc,
      'com', 'mrousavy', 'camera', 'react',
      'CameraDevicesManager.kt'
    ),
    replacements: [
      {
        description: 'import android.hardware.camera2.CameraManager → kobiton',
        from: 'import android.hardware.camera2.CameraManager',
        to:   'import kobiton.hardware.camera2.CameraManager',
      },
      {
        description: 'getSystemService(CAMERA_SERVICE) as CameraManager → CameraManager.getInstance()',
        from: 'reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager',
        to:   'CameraManager.getInstance(reactContext)',
      },
    ],
  },
  {
    file: path.join(
      androidSrc,
      'com', 'mrousavy', 'camera', 'core', 'extensions',
      'ImageAnalysis.Builder+setTargetFrameRate.kt'
    ),
    replacements: [
      {
        description: 'import android.hardware.camera2.CaptureRequest → kobiton',
        from: 'import android.hardware.camera2.CaptureRequest',
        to:   'import kobiton.hardware.camera2.CaptureRequest',
      },
    ],
  },
];

// ── Apply patches ────────────────────────────────────────────────────────────

let totalReplaced = 0;
let totalAlreadyPatched = 0;
let totalFailed = 0;

for (const { file, replacements } of PATCHES) {
  const relPath = path.relative(vcamRoot, file);

  if (!fs.existsSync(file)) {
    console.error(`[kobiton-camera2-patch] ✗ File not found: ${relPath}`);
    totalFailed++;
    continue;
  }

  let src = fs.readFileSync(file, 'utf8');
  let modified = false;

  for (const { description, from, to } of replacements) {
    if (src.includes(to)) {
      console.log(`[kobiton-camera2-patch] ✓ Already patched  ${relPath}\n    ${description}`);
      totalAlreadyPatched++;
      continue;
    }

    if (!src.includes(from)) {
      console.error(
        `[kobiton-camera2-patch] ✗ Pattern not found in ${relPath}\n    Expected: ${from}`
      );
      totalFailed++;
      continue;
    }

    src = src.split(from).join(to);  // global replace (handles duplicates)

    if (!src.includes(to)) {
      console.error(
        `[kobiton-camera2-patch] ✗ Replacement failed in ${relPath}\n    ${description}`
      );
      totalFailed++;
      continue;
    }

    console.log(`[kobiton-camera2-patch] ✓ Replaced       ${relPath}\n    ${description}`);
    modified = true;
    totalReplaced++;
  }

  if (modified) {
    fs.writeFileSync(file, src, 'utf8');
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(
  `\n[kobiton-camera2-patch] Done — ` +
  `${totalReplaced} replaced, ` +
  `${totalAlreadyPatched} already patched, ` +
  `${totalFailed} failed.`
);

if (totalFailed > 0) {
  console.error(
    '[kobiton-camera2-patch] ✗ One or more replacements failed. ' +
    'Kobiton image injection may not work on Android.'
  );
  process.exit(1);
}
