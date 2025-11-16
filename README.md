# Hawcx React Native SDK (iOS)

This package provides the React Native wrapper for the Hawcx V5 mobile authentication framework. It reuses the production iOS implementation (`dev_ios/ios_sdk/HawcxFramework`) and exposes a typed JavaScript/TypeScript API for React Native applications.

## Repository Layout
- `src/` – TypeScript entry point and public API surface.
- `ios/` – Native bridge sources (Swift) plus the Podspec that embeds `HawcxFramework`.
- `android/` – React Native Android bridge module (Gradle library) plus the bundled Hawcx SDK AAR.
- `example/` – Runnable React Native demo app using the SDK (`npm install` -> `npm run ios`).
- `react_mobile_sdk_plan.md` – Detailed delivery plan and progress tracker. **Always read and update this file when working on the SDK.**

## Scripts
| Command | Description |
| --- | --- |
| `npm run clean` | Removes the build output under `lib/`. |
| `npm run lint` | Runs ESLint using the React Native + TypeScript rules. |
| `npm run typecheck` | Executes the TypeScript compiler in `--noEmit` mode. |
| `npm run build` | Builds distributable bundles via `react-native-builder-bob`. |

> Note: Dependencies are declared in `package.json` but not yet installed. Install them once local tooling is in place (`npm install`).

## Android Module (WIP)
- `android/` hosts the Gradle-based library that React Native autolinks for Android builds. It already references the Hawcx Android SDK via `android/libs/hawcx-5.1.0.aar` and exposes `./gradlew` helpers for linting/publishing.
- Run Gradle tasks from the repo root with `./gradlew -p android <task>` (for example, `./gradlew -p android :hawcxreactnative:lintRelease`). The first invocation requires network/Gradle cache access for AGP + React Native dependencies.

### Refreshing the Hawcx Android SDK AAR
1. Build the native Android SDK (`cd ~/dev_android/android_sdk && ./gradlew :app:assembleRelease`).
2. Copy the generated `app/build/outputs/aar/hawcx-<version>.aar` into `android/libs/`, replacing the existing binary.
3. Update any documentation or release notes (e.g., `react_mobile_sdk_plan.md`, `CHANGELOG.md`) to reflect the new Hawcx SDK version.

## Usage (WIP)

```ts
import {
  initialize,
  authenticate,
  submitOtp,
  addAuthListener,
  hawcxClient,
  useHawcxAuth,
  useHawcxWebLogin,
} from '@hawcx/react-native-sdk';

await initialize({ projectApiKey: 'YOUR_PROJECT_KEY' });

const subscription = addAuthListener(event => {
  switch (event.type) {
    case 'otp_required':
      // show OTP UI
      break;
    case 'auth_success':
      console.log('Login success', event.payload);
      break;
    case 'auth_error':
      console.error('Auth failed', event.payload.message);
      break;
  }
});

await authenticate('user@example.com');
await submitOtp('123456');

subscription.remove();

// HawcxClient helper
const { promise } = hawcxClient.authenticate('user@example.com', {
  onOtpRequired: () => console.log('show OTP UI'),
});
const result = await promise; // -> { accessToken?, refreshToken?, isLoginFlow }

// React hook example
function AuthScreen() {
  const { state, authenticate, submitOtp } = useHawcxAuth();

  const start = () => authenticate('user@example.com');
  const sendOtp = (otp: string) => submitOtp(otp);

  return null;
}

function WebLoginScreen() {
  const { state, webLogin, webApprove, getDeviceDetails } = useHawcxWebLogin();

  const validatePin = (pin: string) => webLogin(pin);
  const approveSession = (token: string) => webApprove(token);
  const refreshDevices = () => getDeviceDetails();

  return null;
}
```

## Example App & E2E
- `cd example && npm install` to bootstrap the sample app.
- Edit `example/src/hawcx.config.ts` with your project API key plus the OAuth client ID, token endpoint, and PEM from `dev_ios/ios_demo_dev`, then run `npm run ios` or `npm run android`.
- Use `example/e2e/hawcx-login.yaml` with [Maestro](https://maestro.mobile.dev/) to drive a smoke test through OTP login. Adjust selectors to match your bundle ID and UI tweaks.

## Release Process
Review `docs/RELEASE.md` before publishing. In short:
1. Run `npm run lint && npm run typecheck && npm test && npm run build`.
2. Update `package.json` + `CHANGELOG.md`.
3. Smoke test the example app.
4. `npm publish --access public` and `pod repo push trunk HawcxReactNative.podspec`.
5. Tag the repo (`git tag vX.Y.Z && git push origin --tags`).

## Next Steps
1. Follow `react_mobile_sdk_plan.md` Phase 1+ to implement the native bridge and JS API.
2. Keep this README updated with integration steps and release instructions as the SDK matures.
