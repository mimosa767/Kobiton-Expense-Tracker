# CLAUDE.md

Guidance for Claude Code working in the Kobiton-Expense-Tracker repo.

## Project reference

`replit.md` is the source of truth for architecture, stack, package layout, and build
commands. Read it before touching anything. Highlights:

- pnpm workspace monorepo (Node 24, TS 5.9, Express 5, Drizzle + Postgres, Orval codegen)
- The mobile app lives in `artifacts/kobiton-expense-tracker` (Expo / React Native)
- Always typecheck from the root: `pnpm run typecheck` (project references — package-local
  tsc fails if deps aren't built)
- Build: `pnpm run build` from the root

## CRITICAL: Kobiton Camera Invariants

The "KOBITON CAMERA INVARIANTS" section in `replit.md` is protected, same as verified
formulas were on EasyOfferMaker. Summary:

1. Android QR scanner MUST use `mod.openCamera()` (manual capture) — never
   `openCameraAutoCapture()`. Timing race with Kobiton session setup.
2. Android receipt camera in `camera.tsx` correctly uses `openCameraAutoCapture()` —
   intentionally different, do not "unify" them.
3. iOS MUST NOT render `<CameraView>` anywhere — SIGABRT via double AVCaptureSession.
   iOS uses the singleton `KobitonCaptureModule.captureFrame(2500)` only.
4. No manual capture button inside Android `<CameraView>` — CameraX ImageAnalysis never
   receives Kobiton-injected frames.

**NEVER change camera code paths without explicit instruction.** If a task can't be done
without breaking an invariant, stop and bounce it back (see loop rules below).

## testID convention

Every new interactive element, screen container, and asserted data display gets a `testID`
(kebab-case, purpose-derived). The app ships with testIDs on all key controls for Kobiton
automation — keep it that way. Grep your diff before reporting done.

## Builds

EAS Android preview build (only when explicitly instructed):

```bash
EAS_SKIP_AUTO_FINGERPRINT=1 eas build --platform android --profile preview --non-interactive --no-wait
```

`android/` is gitignored — use `git add -f android/` when it must be committed.

## Destructive commands

- `pnpm --filter @workspace/db run push-force` — off-limits unless explicitly instructed.

## Chat ↔ Claude Code loop (`LOOP.md`)

`LOOP.md` at the repo root is the handoff channel between two Claudes, so Stephen stops
hand-carrying prompts and results between windows. Same protocol as EasyOfferMaker and the
blog project.

**Roles:**
- **Chat** (Claude in claude.ai — has memory, web search, and direct read/write to this
  repo) owns planning, triage, and review. It writes the execution step into `LOOP.md` and
  reads results back directly.
- **Claude Code** (this repo) owns execution. It reads `LOOP.md`, does the task, writes
  back what it did, and stops.
- **Stephen** is the trigger and the approver, not the courier.

**When Stephen says "run loop":**
1. Read `LOOP.md`. If `status` is not `NEEDS_CC`, say so and stop — nothing to execute.
2. If `status: NEEDS_CC`, do the TASK exactly as written, against this `CLAUDE.md` and
   `replit.md`.
3. Verify from the repo root: `pnpm run typecheck` and `pnpm run build`. Paste the real
   output. For device-facing changes, note whether an EAS build + Kobiton device run is
   needed — chat decides when to spend a build.
4. Write what you did under `## RESULT (from CC)` — files touched, what changed,
   verification output, and blockers. Be specific and honest about what you did NOT do.
5. Set `status: NEEDS_CHAT`, bump `turn`, update `updated:`, append a `## Log` row, stop.

**Hard rules for Claude Code in the loop:**
- **Never break the camera invariants.** Camera code paths are off-limits unless the TASK
  explicitly instructs a change (see "CRITICAL: Kobiton Camera Invariants"). If a task
  can't be done without one and doesn't say so, STOP and bounce it back via `NEEDS_CHAT`.
- **testID or it doesn't ship.** Any new or changed interactive element gets a `testID`.
  Grep your diff before reporting.
- **Verify, don't assume.** Report actual typecheck / build output. "Should pass" is not
  a result.
- **No destructive commands.** `push-force` and anything that wipes data is off-limits
  inside the loop.
- **Execute, don't decide.** Product, scope, and UX judgment calls happen in chat. If the
  task needs one, leave it undone and write the question under RESULT.
- **Stamp every write (HARD RULE).** Append exactly one row to `LOOP.md`'s `## Log` table
  on EVERY write — same as chat. Header/status/RESULT edits without a Log row are a
  protocol violation. The Log is append-only: never edit or delete a prior row. Refresh
  the `updated:` line each write. Time from the real clock, never from memory:
  `TZ='America/New_York' date '+%Y-%m-%d %H:%M %Z'`.

The protocol header is duplicated at the top of `LOOP.md` itself so it's legible without
opening this file.
