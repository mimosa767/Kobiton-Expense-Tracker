#!/usr/bin/env node
/**
 * patch-kobiton-camera2.js
 *
 * Runs automatically after every `pnpm install` (postinstall).
 *
 * Does two things to wire Kobiton's image injection SDK into
 * react-native-vision-camera on Android:
 *
 * 1. SOURCE PATCHES — 3 lines across 2 Kotlin files:
 *
 *    CameraDevicesManager.kt
 *      import android.hardware.camera2.CameraManager
 *        → import kobiton.hardware.camera2.CameraManager
 *      reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
 *        → CameraManager.getInstance(reactContext)
 *
 *    ImageAnalysis.Builder+setTargetFrameRate.kt
 *      import android.hardware.camera2.CaptureRequest
 *        → import kobiton.hardware.camera2.CaptureRequest
 *
 * 2. BUILD.GRADLE PATCH — adds camera2.aar as compileOnly so Gradle can
 *    resolve kobiton.hardware.camera2.* at compile time without bundling it
 *    into the app (the AAR is provided at runtime by Kobiton):
 *
 *    react-native-vision-camera/android/build.gradle
 *      dependencies { ... }
 *        + compileOnly files('<abs-path-to-sdk-files/android/camera2.aar>')
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Absolute path to camera2.aar (sdk-files lives next to scripts/) ──────────

const camera2AarPath = path.resolve(__dirname, '..', 'sdk-files', 'android', 'camera2.aar');

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

const androidSrc     = path.join(vcamRoot, 'android', 'src', 'main', 'java');
const buildGradlePath = path.join(vcamRoot, 'android', 'build.gradle');

// ── Patch definitions — Kotlin source files ──────────────────────────────────

const SOURCE_PATCHES = [
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

// ── Helper: apply a list of string replacements to a file ────────────────────

function patchFile(file, replacements, vcamRoot) {
  let replaced = 0;
  let alreadyPatched = 0;
  let failed = 0;

  const relPath = path.relative(vcamRoot, file);

  if (!fs.existsSync(file)) {
    console.error(`[kobiton-camera2-patch] ✗ File not found: ${relPath}`);
    return { replaced: 0, alreadyPatched: 0, failed: 1 };
  }

  let src = fs.readFileSync(file, 'utf8');
  let modified = false;

  for (const { description, from, to } of replacements) {
    if (src.includes(to)) {
      console.log(`[kobiton-camera2-patch] ✓ Already patched  ${relPath}\n    ${description}`);
      alreadyPatched++;
      continue;
    }

    if (!src.includes(from)) {
      console.error(
        `[kobiton-camera2-patch] ✗ Pattern not found in ${relPath}\n    Expected: ${from}`
      );
      failed++;
      continue;
    }

    src = src.split(from).join(to);

    if (!src.includes(to)) {
      console.error(
        `[kobiton-camera2-patch] ✗ Replacement verification failed in ${relPath}\n    ${description}`
      );
      failed++;
      continue;
    }

    console.log(`[kobiton-camera2-patch] ✓ Replaced       ${relPath}\n    ${description}`);
    modified = true;
    replaced++;
  }

  if (modified) {
    fs.writeFileSync(file, src, 'utf8');
  }

  return { replaced, alreadyPatched, failed };
}

// ── 1. Apply Kotlin source patches ───────────────────────────────────────────

let totalReplaced = 0;
let totalAlreadyPatched = 0;
let totalFailed = 0;

console.log('[kobiton-camera2-patch] ── Kotlin source patches ──────────────────────────────');

for (const { file, replacements } of SOURCE_PATCHES) {
  const result = patchFile(file, replacements, vcamRoot);
  totalReplaced      += result.replaced;
  totalAlreadyPatched += result.alreadyPatched;
  totalFailed        += result.failed;
}

// ── 2. Patch build.gradle — add camera2.aar as compileOnly ───────────────────

console.log('[kobiton-camera2-patch] ── build.gradle patch ─────────────────────────────────');

const buildGradleRelPath = path.relative(vcamRoot, buildGradlePath);

// Verify camera2.aar exists before injecting its path
if (!fs.existsSync(camera2AarPath)) {
  console.error(
    `[kobiton-camera2-patch] ✗ camera2.aar not found at: ${camera2AarPath}\n` +
    `    compileOnly dependency NOT added — build will fail without it.`
  );
  totalFailed++;
} else if (!fs.existsSync(buildGradlePath)) {
  console.error(`[kobiton-camera2-patch] ✗ build.gradle not found: ${buildGradleRelPath}`);
  totalFailed++;
} else {
  // The idempotency sentinel: any pre-existing compileOnly files(...) line that
  // references camera2.aar means we already patched this run.
  const SENTINEL = `compileOnly files('${camera2AarPath}')`;

  // Anchor: the unique comment+import line at the top of the dependencies block
  const ANCHOR_FROM = `  //noinspection GradleDynamicVersion\n  implementation "com.facebook.react:react-android:+"`;
  const ANCHOR_TO   = `  //noinspection GradleDynamicVersion\n  ${SENTINEL}\n  implementation "com.facebook.react:react-android:+"`;

  const result = patchFile(
    buildGradlePath,
    [
      {
        description: `add compileOnly files('...camera2.aar') to dependencies block`,
        from: ANCHOR_FROM,
        to:   ANCHOR_TO,
      },
    ],
    vcamRoot
  );

  totalReplaced      += result.replaced;
  totalAlreadyPatched += result.alreadyPatched;
  totalFailed        += result.failed;
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(
  `\n[kobiton-camera2-patch] Done — ` +
  `${totalReplaced} replaced, ` +
  `${totalAlreadyPatched} already patched, ` +
  `${totalFailed} failed.`
);

if (totalFailed > 0) {
  console.error(
    '[kobiton-camera2-patch] ✗ One or more patches failed.\n' +
    '    Kobiton image injection will not work on Android until these are resolved.'
  );
  process.exit(1);
}
