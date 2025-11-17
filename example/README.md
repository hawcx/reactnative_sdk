# Hawcx React Native SDK Example

This example demonstrates the cross-platform APIs exported by `@hawcx/react-native-sdk`. It mirrors the flows in the native reference apps (email/OTP login, web PIN validation, and manual push approvals) so you can validate your Hawcx project keys on both iOS and Android.

## Getting Started

1. Install dependencies:
   ```bash
   cd example
   npm install
   ```
2. Configure credentials in `src/hawcx.config.ts`. The file ships with dev defaults—replace the API key and OAuth values with your own.
3. **iOS only:** install pods:
   ```bash
   cd ios && pod install && cd ..
   ```
4. **Android (optional push support):**
   - Create a Firebase project and enable Cloud Messaging.
   - Download `google-services.json` and drop it into `android/app/`. The Gradle script automatically applies the Google Services plugin when this file exists.
   - If you want to drive push approvals end-to-end, wire your push provider to send Hawcx payloads (see the push harness card in the app for the expected fields).
5. Launch the app:
   ```bash
   npm run ios
   # or
   npm run android
   ```

## What It Demonstrates
- `initialize()` via `hawcx.config.ts` so you can flip credentials without editing the UI.
- `useHawcxAuth` hook for login + OTP entry.
- `useHawcxWebLogin` to validate QR/PIN flows.
- Manual push harness that lets you:
  - Register APNs bytes (iOS) or an FCM token (Android) via `setPushDeviceToken`.
  - Forward arbitrary push payload JSON to the native SDK and see emitted `hawcx.push.event` logs.
  - Approve or decline login requests by submitting the `request_id`.
- Logging card with an on/off switch so you can inspect auth/session/push events directly in the UI.

## Push Harness Tips
- On Android, paste the FCM token string and tap **Register Token** followed by **Notify Authenticated** once the user completes login. This calls `setFcmToken` + `userDidAuthenticate` so Hawcx can register for approvals.
- On iOS, enter the APNs device token as a comma-separated list of byte values (e.g., `42, 13, 255, ...`). The helper converts it into the byte array expected by `setApnsDeviceToken`.
- Use the payload editor to paste the JSON delivered by Hawcx push notifications—at minimum it must include `request_id`, `ip_address`, `deviceInfo`, and `timestamp`.

## E2E Harness (Maestro)
`e2e/hawcx-login.yaml` is a starting point for automated smoke tests:
1. Launches the sample app (`appId: com.hawcx.example`)
2. Types an email address
3. Taps **Authenticate**
4. Waits for the OTP prompt to appear

Run it on either platform:
```bash
# iOS Simulator example
maestro test e2e/hawcx-login.yaml

# Android emulator example
maestro test --device emulator-5554 e2e/hawcx-login.yaml
```

Customize the selectors, credentials, and OTP handling to match your environment. This same flow can be extended to cover push approvals, PIN validation, and regression checks on error states.
