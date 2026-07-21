# @workspace/kobiton-automation

Vendor-agnostic **Kobiton automation toolkit**. A typed Kobiton REST client
(auth / devices / apps) plus a device **allocator** that selects a device and
emits ready-to-use Appium capabilities. Everything is **read-only** — no Appium
sessions, no reservations, no writes to Kobiton yet.

Turns:

- **Turn 1** ✅ — typed REST client (auth / devices / apps), CLI skeleton, smoke.
- **Turn 2** ✅ — Scenario 7: device allocation (`allocate`, fixed + dynamic).
- **Turn 3** — Scenario 6: bulk app deployment across a device group (`deploy`);
  this is where Appium/webdriverio and actual session creation arrive.

## Layout

```text
src/
├── api/
│   ├── auth.ts        # Basic auth from KOBITON_USERNAME + KOBITON_API_KEY (never logged)
│   ├── http.ts        # fetch wrapper: auth header, JSON parse, typed errors, debug log
│   ├── devices.ts     # GET /v1/devices + pure filterDevices() (+ tags/modelName)
│   ├── apps.ts        # GET /v1/apps (+ /:id) + latest-version-by-package resolver
│   └── index.ts       # barrel + createKobitonClient(env)
├── allocation/
│   ├── types.ts             # AllocationRequest (fixed|dynamic), result, diagnostics
│   ├── capabilities.ts      # pure W3C/appium caps builder (+ kobiton: placeholders)
│   ├── strategy.ts          # pluggable strategy (first-available now; round-robin/LRU later)
│   ├── errors.ts            # NoMatchingDeviceError / FixedDeviceNotFound / DeviceUnavailable
│   ├── logger.ts            # tiny structured stderr logger (info/debug)
│   ├── dynamic-allocator.ts # filter → partition → select; pure core + client wrapper
│   └── fixed-allocator.ts   # udid lookup; WARNs + errors on booked/offline
├── cli.ts             # commander CLI (bin: kobiton-automation)
├── smoke.ts           # read-only live smoke test
└── fixtures/          # sanitized sample responses used by the unit tests
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
# Read-only smoke test (auth → 5 devices → resolve com.kobiton.expensetracker):
pnpm --filter @workspace/kobiton-automation run smoke

# CLI (pass args after `--`):
pnpm --filter @workspace/kobiton-automation run cli -- devices list --platform ANDROID --available
pnpm --filter @workspace/kobiton-automation run cli -- apps list --keyword "Expense Tracker"
pnpm --filter @workspace/kobiton-automation run cli -- apps resolve com.kobiton.expensetracker --platform IOS

# Allocate a device (read-only): prints the selection + the Appium caps it would use.
# Dynamic — select by criteria (version is exact or a major-version prefix):
pnpm --filter @workspace/kobiton-automation run cli -- allocate --mode dynamic --platform android --model "Pixel" --version 16
# Fixed — target one device by udid (WARNs + errors if it is booked/offline):
pnpm --filter @workspace/kobiton-automation run cli -- allocate --mode fixed --udid R5CR80WYSBX
# Retry hook — skip a device that just failed, and print JSON:
pnpm --filter @workspace/kobiton-automation run cli -- allocate --mode dynamic --platform android --exclude-udids UDID1,UDID2 --json

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
| `--group <PRIVATE\|CLOUD\|ALL>` | dynamic | which pool to search (default PRIVATE) |
| `--group-name <name>` | dynamic | advisory only — see the device-groups gap below |
| `--tags a,b` | dynamic | device must carry **all** listed tags |
| `--exclude-udids u1,u2` | dynamic | skip these (turn-3 retry hook) |
| `--strategy <name>` | dynamic | selection strategy (only `first-available` today) |
| `--app <ref>` / `--session-name <s>` | both | folded into the `kobiton:` caps |
| `--create-session` | both | **not yet** — exits pointing to turn 3 |
| `--json` | both | full result (device + caps + diagnostics) as JSON |

Logs (`criteria → Found N matching → available/busy/offline → Selected`) go to
**stderr**; `--json` output goes to **stdout**, so it pipes cleanly.
`KOBITON_DEBUG=1` adds the filter pipeline (matched / available udids).

## The device-groups gap (resolved 2026-07-21, read-only probe)

Turn 1 flagged that `/v1/devices` carries no device-group id. Turn 2 probed for a
dedicated endpoint. **Findings (all read-only GETs):**

- `/v1/deviceGroups`, `/v1/device-groups`, `/v1/devicegroups`, `/v1/groups`,
  `/v1/teams`, `/v1/organization`, `/v1/user`, `/v1/me` → **404**.
- `/v1/organizations` → **405** (exists, but GET is not allowed).
- `/v1/users/me` → **200**. It exposes the caller's **user teams** under
  `groups` (e.g. `{ id: 2576, name: "North America SE Team" }`), plus
  `organization` and `defaultGroupId`. These are **people/permission teams**, and
  nothing maps a *device* to one of them — the org even has permissions named
  `ASSIGN_DEVICE_TO_GROUP` / `EDIT_GROUP_MAPPING`, but no **read** endpoint
  surfaces the resulting mapping.

**Conclusion: there is no usable device-groups endpoint**, so no `src/api/groups.ts`
was added. Group targeting is therefore implemented exactly as the task's
fallback specifies: **`deviceGroup` source (PRIVATE / CLOUD / ALL) + platform /
model / version / tag filters.** `allocate --group-name <name>` is accepted for
forward-compatibility but is **advisory only** — it logs a warning and does not
filter devices.

**New this turn:** `/v1/devices` device objects *do* carry `tags`
(`{ private_tags: string[], public_tags: string[] }`) and `modelName` — both now
parsed. Tags are the closest thing to device-group targeting the read API offers
(`--tags a,b` requires all listed tags). In this org every device's tag arrays
are currently empty, so `--tags` matches nothing live today — the mechanism is
in place for when devices get tagged.

## Verified API notes (2026-07-14, live)

- `GET /v1/devices` returns devices grouped as top-level arrays
  (`privateDevices`, `cloudDevices`, `favoriteDevices`, `virtualDevices`, …).
  Device objects carry **no** numeric device-group id, so `groupId` filtering is
  not available from this response — group = which array. `platform`, name, and
  online/booked/available filtering is done client-side.
- `GET /v1/apps` with **no** `page` param returns every app in one response
  (`currentPage: null`); `?page=N` paginates at 20/page. Each version carries
  `nativeProperties` where the installable id lives: Android
  `nativeProperties.package`, iOS `nativeProperties.CFBundleIdentifier`. The
  single-app GET (`/v1/apps/:id`) also exposes a top-level `packageName` but
  omits `os`. Keyword/platform filtering is client-side.
