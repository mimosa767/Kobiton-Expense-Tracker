# @workspace/e2e-tests

Appium / WebdriverIO end-to-end tests for the Kobiton Expense Tracker, run
against real devices on the [Kobiton](https://portal.kobiton.com) cloud.

## Tests

| Script                | What it does                                                              |
| --------------------- | ------------------------------------------------------------------------- |
| `test:login:ios`      | Logs in on iOS with the demo credentials and asserts the Expenses screen. |

## Setup

1. Install deps from the repo root (pnpm workspace):

   ```bash
   pnpm install
   ```

2. Provide your Kobiton API key. Copy the template and fill it in:

   ```bash
   cd artifacts/e2e-tests
   cp .env.example .env
   # edit .env → set KOBITON_API_KEY (get it at portal.kobiton.com → Settings → API key)
   ```

## Run

The iOS app build (`kobiton-store:690060`) is already uploaded to the Kobiton
App Repository, so no app upload step is needed.

```bash
# from artifacts/e2e-tests, with .env populated:
node --env-file=.env node_modules/.bin/tsx ./src/login.e2e.ts

# …or from the repo root, exporting the key into the env yourself:
KOBITON_API_KEY=xxxx pnpm --filter @workspace/e2e-tests test:login:ios
```

The script allocates a device (default **iPhone 11 Pro / iOS 16.1**), replays
the login flow, prints `✅ Login test PASSED` (exit 0) or `❌ … FAILED`
(exit 1), and releases the device. Watch the live session and recording in the
Kobiton portal under **Sessions**.

## How it finds elements

iOS maps a React Native `testID` to the XCUITest `accessibilityIdentifier`, so
the test addresses elements by accessibility id — e.g. `~login-email-input`,
`~login-password-input`, `~login-button`, and `~expenses-add-fab` for the
post-login assertion. These `testID`s live in
`artifacts/kobiton-expense-tracker/app/login.tsx` and `.../app/expenses.tsx`.

## Targeting other devices

Override via env vars (or `.env`): `KOBITON_DEVICE_NAME`,
`KOBITON_PLATFORM_VERSION`, `KOBITON_DEVICE_GROUP`. See `.env.example`.
