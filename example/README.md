# Hawcx React Native SDK Example

This example app shows how to call the new SDK APIs from a React Native client. It is intentionally minimal so you can plug in real credentials and run flows end-to-end.

## Getting Started
1. Install dependencies:
   ```bash
   cd example
   npm install
   ```
2. Install iOS pods:
   ```bash
   cd ios && pod install && cd ..
   ```
3. Link the local SDK (already referenced via `file:..` in `package.json`).
4. Update the API key inside `src/App.tsx` or inject via secure storage.
5. Run the app:
   ```bash
   npm run ios
   # or
   npm run android
   ```

## What It Demonstrates
- `useHawcxAuth` hook for login + OTP entry
- `useHawcxWebLogin` to validate QR/PIN flows
- How to initialize the SDK once your API key is available
- Basic UI wiring for OTP prompts and status updates

## E2E Harness
See `e2e/hawcx-login.yaml` for a Maestro flow that exercises the main authentication path:
- Launches the example app
- Types a test email
- Taps the Authenticate button
- Waits for the OTP prompt

Run it with:
```bash
maestro test e2e/hawcx-login.yaml
```

Update the steps to include your real account + OTP handling. Feel free to add additional flows for web login, push approvals, etc.
