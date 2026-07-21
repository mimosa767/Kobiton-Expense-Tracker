# @workspace/kobiton-automation

Vendor-agnostic **Kobiton automation toolkit**. A typed Kobiton **v2** REST client
(auth / devices / apps / teams / tags), a device **allocator** (fixed + dynamic),
and a bulk **deploy engine** that installs an app across devices over Appium and
reports. The REST client is read-only; `deploy` creates Appium sessions and is
gated behind `--dry-run` / `--confirm`.

> **v2 only.** The whole toolkit targets the Kobiton **v2** API (`/v2/...`). The
> wire format is snake_case; it is normalised to a stable camelCase domain model
> at the client boundary, so the allocator/CLI never see snake_case.

Turns:

- **Turn 1** ✅ — typed REST client, CLI skeleton, smoke.
- **Turn 2** ✅ — Scenario 7: device allocation (`allocate`, fixed + dynamic).
- **v2 migration** ✅ — moved off v1 to v2; real device-group targeting via
  **teams**; `--tags` now cross-references `/v2/tags/devices`.
- **Scenario 6** ✅ — bulk `deploy` over Appium/webdriverio: install + verify +
  report, worker pool, retries, dynamic re-allocation. Verified live (Android).

## Layout

```text
src/
├── api/
│   ├── auth.ts        # Basic auth + loadHubCredentials() for the wd/hub (never logged)
│   ├── http.ts        # fetch wrapper: auth header, JSON parse, typed errors, debug log
│   ├── devices.ts     # GET /v2/devices (+ ?teamId) → normalised camelCase; filterDevices()
│   ├── apps.ts        # GET /v2/apps (paged, size=200) + latest-version-by-package resolver
│   ├── teams.ts       # GET /v2/teams — the device groups; resolveByName()
│   ├── tags.ts        # GET /v2/tags + /v2/tags/devices (udid → tag names)
│   └── index.ts       # barrel + createKobitonClient(env)
├── allocation/        # types, capabilities, strategy, errors, logger, dynamic/fixed allocators
├── appium/
│   └── session.ts     # createKobitonSession() over the wd/hub + buildDeployCapabilities()
├── deployment/        # deploy-engine (pool/retries/re-allocate), report (console/JSON/CSV)
├── cli.ts             # commander CLI (bin: kobiton-automation)
├── smoke.ts           # read-only live smoke test
└── fixtures/          # sanitized v2 sample responses used by the unit tests
```

`*.test.ts` files sit next to the modules they cover (Node's built-in runner).

## Setup

Credentials come from the environment (never flags, never hardcoded):

```bash
cp .env.example .env   # then edit, OR just export them in your shell
export KOBITON_USERNAME=...
export KOBITON_API_KEY=...
```

## Commands

```bash
# Read-only smoke test (auth → devices → resolve com.kobiton.expensetracker):
pnpm --filter @workspace/kobiton-automation run smoke

# CLI (pass args after `--`):
pnpm --filter @workspace/kobiton-automation run cli -- devices list --platform ANDROID --available
pnpm --filter @workspace/kobiton-automation run cli -- devices list --team "iOS 18.x devices" --group ALL
pnpm --filter @workspace/kobiton-automation run cli -- teams
pnpm --filter @workspace/kobiton-automation run cli -- apps resolve com.kobiton.expensetracker --platform IOS

# Allocate a device (read-only): prints the selection + the Appium caps it would use.
pnpm --filter @workspace/kobiton-automation run cli -- allocate --mode dynamic --platform android --model "Pixel" --version 16
pnpm --filter @workspace/kobiton-automation run cli -- allocate --mode dynamic --team "Quality Assurance" --platform android
pnpm --filter @workspace/kobiton-automation run cli -- allocate --mode dynamic --tags cc-demo   # tag-scoped (via /v2/tags/devices)
pnpm --filter @workspace/kobiton-automation run cli -- allocate --mode fixed --udid R5CR80WYSBX  # WARNs + errors if booked/offline

# Bulk deploy (installs the app + verifies + writes reports). Refuses without
# --dry-run or --confirm. Dry-run creates NO sessions:
pnpm --filter @workspace/kobiton-automation run cli -- deploy --bundle-id com.kobiton.expensetracker --platform android --model Pixel --max 3 --dry-run
# Real multi-device run, 2 at a time (verified live 2026-07-21 — 3 Pixels, 3/0):
pnpm --filter @workspace/kobiton-automation run cli -- deploy --bundle-id com.kobiton.expensetracker --platform android --model Pixel --max 3 --concurrency 2 --retries 1 --confirm

# Unit tests (Node built-in runner via tsx):
pnpm --filter @workspace/kobiton-automation run test
```

### `deploy` (Scenario 6)

Per-device pipeline: **session → verify-installed → activate → verify-state →
terminate** (terminate always runs, in a `finally`). The install itself rides on
the session caps (`appium:app` = `kobiton-store:v<id>` + `fullReset`), Kobiton's
reliable install-from-store path — so the `session` step *is* the remove+install.

| flag | meaning |
|---|---|
| `--bundle-id <id>` / `--app-version-id <id>` | app to deploy (bundle id resolves to the latest version) |
| `--platform <ANDROID\|IOS>` | required |
| `--udids a,b` | explicit fixed targets |
| `--model/--version/--team/--tags/--group` | dynamic targeting (same semantics as `allocate`) |
| `--max <n>` | dynamic: cap on devices targeted (default 1) |
| `--concurrency <n>` | parallel installs — **default 2, hard cap 3** |
| `--retries <n>` | per-device retries after the first attempt (default 1) |
| `--report-dir <dir>` | JSON + CSV output (default `./reports/`) |
| `--dry-run` / `--confirm` | one is required; dry-run creates no sessions |
| `--json` | full run result as JSON |

**Concurrency cap (3).** Held deliberately low for now: each worker holds a live
Kobiton device reservation for the whole install, and the private Atlanta pool is
small and shared. 2 is the default; 3 is the ceiling until we've load-tested
higher against the fleet. Change `CONCURRENCY_CAP` in `deployment/types.ts` when
that's done.

**Dynamic re-allocation.** In dynamic mode, if a device's *session* can't be
created (device fell offline, install/signing error), the engine excludes that
udid and allocates a different matching device for the retry — the `excludeUdids`
hook working live. Verified during the iOS run below.

**Reports.** `deploy-<ts>.json` (full per-device steps + timings + wd sessionId +
**Kobiton numeric session id**) and `deploy-<ts>.csv` (one row per device). The
Kobiton session id is read from the returned `kobiton:session` capability — use it
to find the session in the portal / via MCP.

### `allocate` flags

| flag | mode | meaning |
|---|---|---|
| `--mode <fixed\|dynamic>` | both | default `dynamic` |
| `--udid <udid>` | fixed | required; the exact device |
| `--platform <ANDROID\|IOS>` | dynamic | case-insensitive |
| `--model <name>` | dynamic | partial, case-insensitive match on device name |
| `--version <v>` | dynamic | exact (`16`) or major-version prefix (`16` matches `16.1`) |
| `--team <name>` | dynamic | **real device-group filter** — resolves the team via `/v2/teams`, scopes with `?teamId=` |
| `--group <PRIVATE\|CLOUD\|ALL>` | dynamic | which pool to search within the results (default PRIVATE) |
| `--tags a,b` | dynamic | device must carry **all** listed tags (from `/v2/tags/devices`) |
| `--exclude-udids u1,u2` | dynamic | skip these (the deploy engine's re-allocation hook) |
| `--strategy <name>` | dynamic | selection strategy (only `first-available` today) |
| `--app <ref>` / `--session-name <s>` | both | folded into the `kobiton:` caps |
| `--create-session` | both | not supported by `allocate` — use `deploy` to open sessions |
| `--json` | both | full result (device + caps + diagnostics) as JSON |

Logs (`criteria → Found N matching → available/busy/offline → Selected`) go to
**stderr**; `--json` output goes to **stdout**, so it pipes cleanly.
`KOBITON_DEBUG=1` adds the filter pipeline (matched / available udids).

## Device groups = teams (resolved on v2)

The earlier "device-groups gap" (v1 `/v1/devices` carried no group id) is **solved
on v2**: Kobiton device groups are **teams**.

- `GET /v2/teams` → `{ teams: [{ id, name, members_count, devices_count, … }] }`.
- `GET /v2/devices?teamId={id}` scopes the fleet to a team. The param is exactly
  `teamId` (camelCase); `team_id` / `groupId` are ignored. There is **no**
  `/v2/groups` or `/v2/device-groups`.
- `allocate --team "<name>"` / `devices list --team "<name>"` resolve the name to
  an id via `/v2/teams`, then query `?teamId=`. An unknown name errors with the
  list of available teams.

## Tags (device targeting) on v2

- **`GET /v2/devices` does NOT include tag assignments** — a device's tags live
  only in `GET /v2/tags/devices` (`{ items: [{ udid, tags: [{ tag_name, … }] }] }`).
  So `--tags` fetches that map and merges tag names onto each device before
  filtering (all requested tags must be present).
- `GET /v2/tags` lists org tag definitions (`{ name, id, is_private }`).
- Writes exist on v2 (`POST /v2/tags` create, `DELETE /v2/tags` with
  `{ names: [...] }`, `POST /v2/tags/{name}/devices` with `{ udids: [...] }`) but
  are **not** exposed by this read-only toolkit. Note: only **public** tags
  (`is_private:false`) can be assigned to a device by name.

## Verified v2 API notes (live, 2026-07-21)

- `GET /v2/devices` groups devices as snake_case arrays (`private_devices`,
  `cloud_devices`, `favorite_devices`, `ita_trial_cloud_devices`). **Favorites are
  thin `{id, udid}` references**, not full records — they are parsed leniently and
  skipped (a favorite is always also in private/cloud). Fields are snake_case
  (`device_name`, `platform_name`, `is_online`, `model_name`, …).
- `GET /v2/apps` paginates: `{ apps, current_page, total_items, current_size }`;
  default page size 20, `?size=200` widens it, `?keyword=` filters by name. Each
  app embeds `latest_version.native_properties` where the installable id lives:
  Android `package`, iOS `CFBundleIdentifier`.

## Deploy findings (live, 2026-07-21)

- **Session naming.** Kobiton honors `sessionName` / `sessionDescription` only as
  **top-level `kobiton:sessionName` / `kobiton:sessionDescription`** capabilities.
  The same keys nested under `kobiton:options` are silently ignored (the session
  keeps the server default "Session created at …"). `deviceGroup` and
  `captureScreenshots`, by contrast, ARE honored nested under `kobiton:options`.
  Confirmed by a two-shape probe (session 8806389 took the top-level name) and by
  the multi-device run (sessions 8806410/8806411/8806415 all named `bulk-deploy …`).
- **Kobiton session id.** The returned capabilities include `kobiton:session`
  (numeric id) — captured into `KobitonSession.kobitonSessionId` and the reports,
  so a run's devices map straight to portal/MCP sessions.
- **Android install-from-store works** (Pixel 8 Pro / Pixel 10 / Pixel 10 Pro XL,
  Android 16): `queryAppState` returns `4` (FOREGROUND). One Galaxy S22 unit
  returned `APP-500 adb: failed to install` — a device-specific install failure the
  engine reports per-device.
- **iOS install currently FAILS at resigning.** Deploying `kobiton-store:v766511`
  (com.kobiton.expensetracker) to iPhones fails at session creation with
  `AppSigningError: unable to resign embedded folder path …/KobitonExpenseTracker.app/Frameworks/KobitonSdk.framework`.
  Kobiton's auto app-signing can't re-sign the embedded `KobitonSdk.framework` in
  this build. The engine handled it correctly — session-create failure triggered
  dynamic re-allocation to a second iPhone (which failed identically), then a clean
  `0 Successful / 1 Failed`. This is an app-packaging/signing issue in the uploaded
  IPA, not a toolkit bug; fixing it needs a re-signable iOS build (or launching a
  pre-installed copy via `appium:bundleId` instead of installing from store).
