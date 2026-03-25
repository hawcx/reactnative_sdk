# Hawcx React Native SDK Example

This app is the in-repo maintainer reference app for `@hawcx/react-native-sdk`. It consumes the local workspace package via `file:..` and is meant for day-to-day implementation checks, not public release signoff.

For final published-package validation, use `/Users/agambhullar/hawcx_smoke_tests/react_native_smoke_app`.

## What This Example Covers

- V6 prompt-driven authentication with:
  - primary, MFA, and device-trust stage indicators
  - resend countdowns
  - change-identifier and reset flow controls
  - redirect handling through app deep links
  - await-approval and TOTP setup screens
  - demo-mode vs backend exchange mode
- Mixed-mode web login utilities:
  - protocol QR approval
  - legacy 7-digit PIN fallback routing
- Saved-user and device lifecycle actions:
  - sign out while keeping the trusted device
  - forget this device and clear saved local trust
- Legacy V5 push approval harness:
  - token registration
  - manual payload forwarding
  - approve / decline request controls

## Setup

1. Install dependencies:
   ```bash
   cd example
   npm install
   ```
2. Set credentials in [hawcx.config.ts](/Users/agambhullar/dev_react/example/src/hawcx.config.ts).
3. Install iOS pods:
   ```bash
   cd ios
   pod install
   cd ..
   ```
4. Optional Android push setup:
   - Add `google-services.json` to `android/app/`
   - Configure Firebase Cloud Messaging if you want end-to-end push approval testing
5. Run the app:
   ```bash
   npm run ios
   # or
   npm run android
   ```

## Redirect Handling

The example app registers these callback schemes:

- `hawcxexampleapp`
- `com.hawcx.example`

When the V6 flow enters a redirect step, the example can resume in either of two ways:

- automatically through an incoming deep link
- manually by pasting the callback URL into the auth card

## Manual QA Matrix

Use this checklist before treating the in-repo example as healthy:

1. Start a V6 sign-in flow and confirm the stage indicator moves from `Primary` into the next prompt.
2. Trigger an email or SMS code step and confirm the resend countdown and resend button behavior.
3. Trigger MFA and confirm the identifier is hidden behind the `Change Identifier` action.
4. Trigger `setup_totp` and confirm the secret, `otpauth://` link, and code submission path render correctly.
5. Trigger a redirect step and confirm the app resumes through either a real callback or the manual redirect input.
6. Trigger an await-approval step and confirm polling works.
7. Paste a protocol QR payload into the mixed-mode card and confirm approval succeeds with the current or saved user.
8. Paste a legacy PIN URL or bare 7-digit PIN and confirm the fallback routes through the legacy web login helper.
9. Use `Sign Out (Keep Trusted Device)` and confirm the trusted user remains discoverable.
10. Use `Forget This Device` and confirm the saved user is cleared.
11. Run the push harness with a real or synthetic payload and confirm events still arrive on the legacy surface.

## Build Checks

These are the maintainer-grade checks we use for this app:

```bash
cd /Users/agambhullar/dev_react/example
npm run lint
npx tsc -p tsconfig.json --noEmit

cd /Users/agambhullar/dev_react/example/android
./gradlew assembleDebug

cd /Users/agambhullar/dev_react/example/ios
pod install
xcodebuild -workspace HawcxExampleApp.xcworkspace -scheme HawcxExampleApp -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES ARCHS=arm64 COMPILER_INDEX_STORE_ENABLE=NO build
```

## Notes

- This app intentionally keeps the push harness on the legacy V5 surface because that is still the correct implementation today.
- The example prefers maintainability over polish. It should make debugging easy, not hide behavior.
