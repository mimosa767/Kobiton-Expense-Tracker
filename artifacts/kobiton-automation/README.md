# @workspace/kobiton-automation

Vendor-agnostic **Kobiton automation toolkit**. A typed Kobiton **v2** REST client
(auth / devices / apps / teams / tags) plus a device **allocator** that selects a
device and emits ready-to-use Appium capabilities. Everything is **read-only** —
no Appium sessions, no reservations, no writes to Kobiton.

> **v2 only.** The whole toolkit targets the Kobiton **v2** API (`/v2/...`). The
> wire format is snake_case; it is normalised to a stable camelCase domain model
> at the client boundary, so the allocator/CLI never see snake_case.

Turns:

- **Turn 1** ✅ — typed REST client, CLI skeleton, smoke.
- **Turn 2** ✅ — Scenario 7: device allocation (`allocate`, fixed + dynamic).
- **v2 migration** ✅ — moved off v1 to v2; real device-group targeting via
  **teams**; `--tags` now cross-references `/v2/tags/devices`.
- **Turn 3** — Scenario 6: bulk app deployment (`deploy`); Appium/webdriverio and
  actual session creation arrive here.

## Layout

```text
src/
├── api/
│   ├── auth.ts        # Basic auth from KOBITON_USERNAME + KOBITON_API_KEY (never logged)
│   ├── http.ts        # fetch wrapper: auth header, JSON parse, typed errors, debug log
│   ├── devices.ts     # GET /v2/devices (+ ?teamId) → normalised camelCase; filterDevices()
│   ├── apps.ts        # GET /v2/apps (paged, size=200) + latest-version-by-package resolver
│   ├── teams.ts       # GET /v2/teams — the device groups; resolveByName()
│   ├── tags.ts        # GET /v2/tags + /v2/tags/devices (udid → tag names)
│   └── index.ts       # barrel + createKobitonClient(env)
├── allocation/        # types, capabilities, strategy, errors, logger, dynamic/fixed allocators
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

# deploy is still a stub; it refuses to run without --dry-run or --confirm:
pnpm --filter @workspace/kobiton-automation run cli -- deploy --group "Atlanta - US" --app com.kobiton.expensetracker --dry-run

# Unit tests (Node built-in runner via tsx):
pnpm --filter @workspace/kobiton-automation run test
```

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
| `--exclude-udids u1,u2` | dynamic | skip these (turn-3 retry hook) |
| `--strategy <name>` | dynamic | selection strategy (only `first-available` today) |
| `--app <ref>` / `--session-name <s>` | both | folded into the `kobiton:` caps |
| `--create-session` | both | **not yet** — exits pointing to turn 3 |
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
