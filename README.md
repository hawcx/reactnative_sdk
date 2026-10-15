# Hawcx React Native SDK

Official React Native bindings for the Hawcx mobile authentication platform. The package
wraps the production Hawcx iOS and Android SDKs so you can ship the current V6 adaptive
flow in a single cross-platform API while keeping existing V5 utilities available during
migration.

## What This Package Includes

- V6 adaptive authentication via `useHawcxV6Auth`, `startV6Flow`, and `hawcxV6Client`
- Production native iOS and Android SDK integrations under the hood
- Redirect, approval polling, and QR approval helpers for V6 flows
- Approvals v2 on both sides: the requester (number matching, typed outcomes, anonymous
  QR sign-in) and the approver (push-token registration, push / QR references, context,
  approve / deny), plus self-service device APIs
- Existing V5 auth and push/session helpers for apps already in production

## Requirements

- React Native 0.73+
- iOS 17.5+
- Android API 26+
- OAuth client credentials kept on your backend

## Installation

Add the package:

```bash
npm install @hawcx/react-native-sdk@1.1.5
```

### iOS

Install pods after adding the package:

```bash
cd ios
pod install
cd ..
```

The Podspec vendors `HawcxFramework.xcframework` automatically, so no manual iOS
framework setup is required.

### Android

The React Native package depends on the released Hawcx Android SDK, so your Android app
must be able to resolve the Hawcx Maven repository.

Add the repository in `android/settings.gradle`:

```groovy
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven {
            url = uri("https://raw.githubusercontent.com/hawcx/hawcx_android_sdk/main/maven")
            metadataSources {
                mavenPom()
                artifact()
            }
        }
    }
}
```

The hosted Hawcx Maven repository is public. You do not need a GitHub token for the
standard React Native setup.

If your Android project still bundles a local `hawcx-*.aar` or uses `flatDir { dirs("libs") }`,
remove that and let Gradle resolve the native SDK from Maven.

If Gradle has cached an older dependency graph, run:

```bash
cd android
./gradlew clean
cd ..
```

## V6 Quick Start

Initialize the SDK once during app bootstrap:

```tsx
import { initialize } from '@hawcx/react-native-sdk';

await initialize({
  projectApiKey: '<YOUR_CONFIG_ID>',
  baseUrl: 'https://stage-api.hawcx.com',
  autoPollApprovals: true,
});
```

### Initialization Notes

- `projectApiKey` is the Hawcx value provisioned for this integration. In current public
  releases, this is the same value you may receive as your project API key / Config ID.
- `baseUrl` should point to your Hawcx tenant host root. Do not append `/v1`, `/auth`,
  or `/hc_auth` yourself.
- `autoPollApprovals` defaults to `true`, which is the right choice for most apps.
- `relyingParty` is optional. Set it only when your backend expects the
  `X-Relying-Party` header for this integration.
- `oauthConfig` is not required for the recommended V6 flow. Keep OAuth credentials on
  your backend.

## How V6 Works

1. Initialize the package with your Config ID and tenant host.
2. Start a flow, usually `signin`, with the user's identifier.
3. Render the next prompt Hawcx returns.
4. Send the user's input back to the SDK.
5. When the flow completes, send the authorization code to your backend.
6. Let your backend exchange the code and create the app session.

The native SDKs handle protocol requests, PKCE when needed, trusted-device storage,
device-trust processing, and approval polling.

## Build an Auth Screen

The recommended React Native integration shape is a screen or coordinator that:

1. holds the current `HawcxV6AuthState`
2. starts the flow
3. reacts to the current prompt
4. forwards the user's input back to the SDK

```tsx
import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import {
  useHawcxV6Auth,
  type HawcxV6Method,
} from '@hawcx/react-native-sdk';

export function V6AuthScreen() {
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState('');
  const v6 = useHawcxV6Auth(undefined, { flowType: 'signin' });

  const renderPrompt = () => {
    switch (v6.state.status) {
      case 'select_method':
        return v6.state.prompt?.prompt.type === 'select_method'
          ? v6.state.prompt.prompt.methods.map((method: HawcxV6Method) => (
              <Button
                key={method.id}
                title={method.label}
                onPress={() => void v6.selectMethod(method.id)}
              />
            ))
          : null;

      case 'enter_code':
        return (
          <>
            <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" />
            <Button title="Continue" onPress={() => void v6.submitCode(code)} />
          </>
        );

      case 'enter_totp':
        return (
          <>
            <TextInput value={totp} onChangeText={setTotp} />
            <Button title="Continue" onPress={() => void v6.submitTotp(totp)} />
          </>
        );

      case 'await_approval':
        return <Text>Waiting for approval...</Text>;

      case 'redirect':
        return <Text>Continue in the browser to finish this step.</Text>;

      default:
        return null;
    }
  };

  return (
    <View>
      <TextInput value={identifier} onChangeText={setIdentifier} />
      <Button
        title="Continue"
        onPress={() =>
          void v6.start({
            flowType: 'signin',
            identifier: identifier.trim(),
          })
        }
      />
      {renderPrompt()}
    </View>
  );
}
```

### V6 Flow Types

`flowType` supports:

- `signin`
- `signup`
- `account_manage`

Most apps should start with `signin`.

## Redirect Handling

When the current prompt is `redirect`, open the provided URL in the browser and forward
the return URL back into the SDK:

```tsx
import { useEffect } from 'react';
import { Linking } from 'react-native';

useEffect(() => {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    void v6.handleRedirectUrl(url);
  });

  return () => subscription.remove();
}, [v6.handleRedirectUrl]);

const openRedirect = async () => {
  if (v6.state.prompt?.prompt.type !== 'redirect') {
    return;
  }

  await Linking.openURL(v6.state.prompt.prompt.url);
};
```

React Native handles the JavaScript callback side, but you still need to register your
callback scheme natively on iOS and Android so the app receives the return URL.

`launchRedirect(url, returnScheme)` (on `HawcxV6Client`, or `v6LaunchRedirect`) opens the
step with the platform's sign-in browser instead of `Linking`:

- iOS: an `ASWebAuthenticationSession` for `returnScheme` (required on iOS). It hands the
  callback to the flow itself and then resolves `{launchedWith: 'auth_session'}`.
- Android: Custom Tabs, falling back to the browser. It resolves `custom_tab` / `browser` once
  the page is open; the callback still arrives through your intent filter, so keep the
  `Linking` handler above.

It rejects with `HawcxServiceError` (`redirect_cancelled`, `invalid_callback`, `invalid_url`,
`no_browser`, `redirect_failed`).

## Magic Links

When the server sends a magic-link code screen, the `enter_code` prompt carries
`pollInterval` (seconds). While that prompt shows, the native SDK polls in the
background, so the flow can finish with a `completed` event when the user confirms the
link on another device. `v6.state.magicLinkPolling` is `true` while this happens; keep
the code field usable, the typed code still works.

To finish a sign-in in the app when the user taps the link on the same phone, register
a landing URL and pass it at initialization:

```tsx
await initialize({
  projectApiKey: '<YOUR_CONFIG_ID>',
  baseUrl: 'https://stage-api.hawcx.com',
  magicLinkLandingUrl: 'https://login.example.com/app/magic-link/',
});
```

- The landing URL must be https with no query, fragment or user info, and must match a
  landing URL registered on the project exactly. The server redirects a confirmed link
  to it with `?hawcx_magic_link=<token>&hawcx_project=<project_id>`.
- Serve it as a Universal Link (iOS: `apple-app-site-association` plus the
  `applinks:` associated domain) and an App Link (Android: `assetlinks.json` plus an
  `autoVerify` intent filter for that path). Also serve a web page at that URL for
  devices where the app is not installed or the link opens in an in-app browser.
- With a landing URL set, the in-progress flow is saved in the Keychain / Android
  Keystore while the code screen shows, so the link can resume it after the app was
  killed.

Pass every incoming URL to `completeMagicLinkRedirect`:

```tsx
useEffect(() => {
  const handle = async (url: string | null) => {
    if (!url || !isHawcxMagicLinkUrl(url, LANDING_URL)) {
      return; // not a magic link: keep your other handlers (OAuth callbacks, ...)
    }
    const outcome = await v6.completeMagicLinkRedirect(url);
    // outcome.outcome: 'resumed' | 'handed_off' | 'failed' | 'not_magic_link'
  };
  void Linking.getInitialURL().then(handle);
  const subscription = Linking.addEventListener('url', ({ url }) => void handle(url));
  return () => subscription.remove();
}, [v6.completeMagicLinkRedirect]);
```

| Outcome | Meaning |
|---|---|
| `not_magic_link` | Not a landing URL (no `hawcx_magic_link`, or not on the configured landing URL). Nothing was sent. |
| `resumed` | This app started the sign-in; it continues through the normal flow events (usually `completed`). |
| `handed_off` | The sign-in was started elsewhere (another device or the web). Tell the user to go back there. |
| `failed` | `{ code, message, retryable }`. `retryable: true` (service unavailable, network): the saved flow is kept, try the link again. Otherwise the link is expired or used, or the flow failed after the link was accepted (the error also arrives as a flow `error` event). |

A link that the server refuses for this saved flow (`magic_link_resume_invalid`, for
example a flow started on another device) falls back to the hand-off automatically.
`v6.state.magicLinkRedirect` keeps the last outcome until the next `start` or `reset`.
Never log the landing URL: it carries a single-use sign-in token.

## Backend Exchange

When the flow completes, the SDK returns:

- `session`
- `authCode`
- `expiresAt`
- `codeVerifier` when PKCE was generated by the SDK
- `traceId` for support and correlation

For most apps, send `authCode` and `codeVerifier` to your backend immediately over HTTPS
and perform the exchange there. Keep OAuth client credentials and token verification on
the server, not in the React Native app.

Recommended payload shape:

```json
{
  "authCode": "<authCode>",
  "codeVerifier": "<optional-codeVerifier>",
  "identifier": "user@example.com",
  "session": "<optional-session>"
}
```

Your backend should:

1. exchange `authCode` and `codeVerifier` with the Hawcx backend SDK
2. verify the returned claims
3. create your app session or tokens
4. return the app auth result your app needs

### React Native app-to-backend example

```tsx
import { useEffect } from 'react';
import {
  storeBackendOAuthTokens,
  useHawcxV6Auth,
} from '@hawcx/react-native-sdk';

useEffect(() => {
  if (v6.state.status !== 'completed' || !v6.state.completed) {
    return;
  }

  const run = async () => {
    const response = await fetch('https://your-backend.example.com/api/hawcx/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authCode: v6.state.completed.authCode,
        codeVerifier: v6.state.completed.codeVerifier,
        identifier,
        session: v6.state.completed.session,
      }),
    });

    if (!response.ok) {
      throw new Error('Backend exchange failed');
    }

    const result = await response.json();

    if (result.accessToken) {
      // The backend has already exchanged the auth code. This helper only persists
      // backend-issued tokens for shared native session and push helpers.
      await storeBackendOAuthTokens(
        identifier,
        result.accessToken,
        result.refreshToken,
      );
    }
  };

  void run();
}, [identifier, v6.state]);
```

`storeBackendOAuthTokens` is optional for the core V6 flow. It does **not** exchange
authorization codes. Use it only after your backend has already exchanged the code,
verified the result, and returned backend-issued tokens that the shared native session
and push helpers should persist.

For backend implementation details, see:

- [Node.js backend quickstart](https://docs.hawcx.com/docs/v1/sdk-reference/backend/nodejs/quickstart)
- [Python backend quickstart](https://docs.hawcx.com/docs/v1/sdk-reference/backend/python/quickstart)

## Polling (await approval and magic links)

While an `await_approval` prompt (push or QR) or a magic-link code screen is showing, the
**native SDK** polls by itself; there is no JavaScript poll loop. It polls the route the server
advertises (`prompt.pollPath`, e.g. `/v1/auth/poll`, falling back to `POST /v1/auth` on older
servers), every 2s for the first 30s, then every 5s until 2 minutes, then every 10s, never faster
than `pollInterval`. It honours `Retry-After`, treats a 429 as "slow down" rather than an error,
keeps one poll in flight, and never emits `loading` for a poll.

Polling pauses on its own while the app is in the background (iOS app notifications, Android
`ProcessLifecycleOwner`). For manual control, for example while a modal covers the waiting
screen, call `pausePolling()` / `resumePolling()` (on `useHawcxV6Auth()`, `HawcxV6Client`, or as
`v6PausePolling` / `v6ResumePolling`). Both are idempotent and resolve without effect before
`initialize`.

## Requester: approvals v2, locked, notices, QR sign-in

- `await_approval` carries `mode` (`push` | `qr`), `approvalId` and `number` (10-99) for
  approvals v2; show `number` large ("Check your phone"). They are absent for v1 approvals.
  `state.approval` mirrors them.
- An approval ends with an error event: `approval_denied`, `approval_wrong_number`,
  `approval_superseded` or `approval_blocked` (`state.approvalOutcome`,
  `isHawcxV6ApprovalOutcome(code)`). Push start limits are `push_rate_limited` (429, with
  `details.retryAfterSeconds`) and `push_unavailable`. Both have `action: 'select_method'`: call
  `backToMethodSelection()` to show the method list again without a new start.
- `locked` (status `locked`, `state.locked`): too many attempts. Show `lockedUntil`. Nothing is
  polled or retried.
- Notices: `state.notice` (`{code, message}`), e.g. `device_revoked`, or `unauthorized_device`
  after the native SDK cleared this device's revoked keys and restarted the flow once. Notice
  events also reach `addV6FlowListener` as `{type: 'notice'}`.
- `setup_totp` may carry `backupCodes`. Show them once and never log them.
- Prompts the SDK does not model arrive as `{type: 'unknown', rawType}` (status `unknown`).
- Errors: `sdk_outdated` (HTTP 426, abort), and `rate_limited` / `Retry-After` in
  `details.retryAfterSeconds`. `HawcxV6ErrorCodes` lists the common codes.
- Start options: `scope`, `samlReqId` (`samlreq_<hex>`, validated natively), and
  `method: 'qr_login'` for an anonymous QR sign-in with no identifier. Shortcuts are
  `startQrLogin()` on the hook and client, and `startV6QrLogin()`. Show the `await_approval`
  step's `qrData` as a QR code. The tenant must enable `qr_login`; otherwise the error is
  `qr_login_not_allowed`.

## Device APIs (session token)

A completed flow may return a session token, the bearer for the self-service device APIs.
**It stays native:** the `completed` event only says `hasSessionToken: true`. Pass `null` as the
token to use it:

```tsx
const devices = await hawcxV6Client.listDevices(null);
await hawcxV6Client.revokeDevice(null, devices[0].deviceId, 'lost'); // cannot_revoke_current_device for this one
const { sessionsEnded } = await hawcxV6Client.logoutEverywhere(null);
```

`getSessionToken()` returns the token if your backend needs it. It is a secret bearer
credential: the SDK never logs it, and you must not either. Native code clears it on a new
start or reset, and it is not kept across launches. Failures reject with `HawcxServiceError`
(`code`, `status`, `retryable`, `retryAfterSeconds`).

## Approver: approve sign-ins from this phone (approvals v2)

The signed-in phone approves a sign-in that started on another screen, by push or by QR.
The approval's token, signatures and device keys never reach JavaScript. A fetched approval
is cached natively and you get an opaque `handle`.

```tsx
import {
  approvalReferenceFromPush, scanApproval, registerPushToken, unregisterPushToken,
  useHawcxApprover, enrolledIdentifiers, approveV6Qr,
} from '@hawcx/react-native-sdk';

// 1. After each sign-in and on token refresh (iOS: APNs hex or bytes; Android: the FCM token).
await registerPushToken(
  Platform.OS === 'ios'
    ? { provider: 'apns', token: apnsTokenHex, apnsEnv: 'production' }
    : { provider: 'fcm', token: fcmToken },
);

// 2. A push arrived (APNs userInfo, or the FCM data map; {data: {hawcx}} is unwrapped).
const reference = await approvalReferenceFromPush(notificationData); // null: not ours, or expired

// 2'. Or a QR was scanned.
const scanned = await scanApproval(qrText);
// {version: 2, reference} -> context; {version: 1} -> confirm, then approveV6Qr(qrText, identifier)

// 3. Show who is asking and decide.
const approver = useHawcxApprover();
const request = await approver.fetch(reference); // qr_login: approver.fetch(reference, pickedIdentifier)
await approver.approve(request.numberRequired ? typedNumber : undefined); // gate behind biometrics
await approver.deny();
```

- Show only what `fetch` returns (`requester.appName`, `origin`, `browser`, `location`, `ip`,
  `requestedAt`, `locationMismatch`), never anything from the push itself.
- When `numberRequired` is true, approve needs the number the user typed. The SDK never fills
  it in. Deny never needs it.
- Results are `approved`, `denied`, `wrong_number`, or `resolved` (`resolvedOutcome`:
  approved, denied, expired, wrong_number, superseded or blocked; plus `decidedByThisDevice`).
- Errors are `HawcxServiceError`, with the server's or the SDK's code:
  - `device_not_enrolled`, `project_mismatch`, `identifier_required` (qr_login),
    `approval_expired`
  - `approval_not_found`, `approval_resolved` (with `outcome`), `unsupported_approval_version`
  - `account_locked`, `number_required`, `invalid_number`, `approval_handle_unknown`
  - retryable: `rate_limited`, `approval_not_ready`, `keychain_unavailable`, ...
- For qr_login, let the user pick from `enrolledIdentifiers()` when more than one account is
  enrolled.
- **Unregister before signing out or clearing keys** (`unregisterPushToken()`): it is signed with
  the device key. `push_not_registered` means nothing was registered from this install. Use
  `unregisterPushToken({identifier, appId})` to unregister without a local record.
- The legacy v4 push APIs (`setApnsDeviceToken`, `setFcmToken`, `setPushDeviceToken`,
  `handlePushNotification`, `approvePushRequest`, `declinePushRequest`) are deprecated and warn
  once.
- The SDK takes the payloads your push library delivers. It has no Firebase or APNs
  dependency.

## QR Approvals and Web Login Helpers

The package also exposes helpers for QR approval and legacy web-login scans:

- `routeWebLoginScan(raw)`
- `approveV6Qr(rawPayload, identifier, options)`
- `useHawcxWebLogin()`

For protocol QR payloads, you can approve directly from React Native:

```tsx
import { approveV6Qr, routeWebLoginScan } from '@hawcx/react-native-sdk';

const route = routeWebLoginScan(scanValue);
if (route.kind === 'approval_v2') {
  // approvals v2: scanApproval(route.raw) -> approver (see above)
} else if (route.kind === 'protocol_qr') {
  const result = await approveV6Qr(route.payload.raw, identifier, {
    rememberDevice: true,
  });

  console.log(result.outcome, result.payloadType);
}
```

## Existing V5 and Shared Helpers

The package still includes the older V5 auth surface for apps that already use it,
including:

- `authenticate`, `submitOtp`, `useHawcxAuth`
- `useHawcxWebLogin`
- `setPushDeviceToken` (deprecated)
- `notifyUserAuthenticated`
- `handlePushNotification`, `approvePushRequest`, `declinePushRequest` (deprecated: use the
  approvals v2 approver)

Shared helpers such as `initialize` and `storeBackendOAuthTokens` remain available across
the current package surface.

That makes incremental migration possible: new V6 flows can live on
`useHawcxV6Auth` while existing utilities remain available in the same package.

## Example App

The `example/` directory contains the in-repo React Native reference app used during SDK
development:

```bash
cd example
npm install
npm run ios
# or
npm run android
```

Use it to validate V6 auth flows against your environment before integrating into your
own app.

The example has an **Approver** card (`example/src/ApproverScreen.tsx`) with these debug inputs,
so every approval path runs on a simulator or emulator without APNs or FCM:

- paste a push payload
- paste a QR
- register or unregister a fake push token
- list, revoke, and log out everywhere

The sign-in card shows:

- the approval number and `approvalId`
- outcome messages and "Back to methods" for `select_method` errors
- the locked screen
- **Sign in with QR (no email)**

### Developing against local native SDK builds

The package ships the released native SDKs. To try unreleased native builds locally
(do not commit these overrides):

- iOS: build `HawcxFramework.xcframework` with the iOS SDK's `build-sdk` script and copy
  it over `ios/Frameworks/HawcxFramework.xcframework`, then run `pod install` in
  `example/ios` (its Podfile syncs that framework into `node_modules`).
- Android: publish the SDK to Maven Local (`./gradlew -PhawcxVersion=<x.y.z-SNAPSHOT>
  :app:publishReleasePublicationToMavenLocal` in the Android SDK) and build with
  `-Phawcx.useMavenLocal=true -PHAWCX_ANDROID_SDK_VERSION=<x.y.z-SNAPSHOT>`.
- To make the example use this checkout instead of the npm release, replace
  `example/node_modules/@hawcx/react-native-sdk` with a symlink to the repo root and run
  `npm run build` at the root.

## Documentation

- [V6 React Native guide](https://docs.hawcx.com/docs/v1/sdk-reference/frontend/react-native/sdk-v6)
- [V5 React Native guide](https://docs.hawcx.com/docs/v1/sdk-reference/frontend/react-native/sdk)
- [V6 iOS guide](https://docs.hawcx.com/docs/v1/sdk-reference/frontend/ios/sdk-v6)
- [V6 Android guide](https://docs.hawcx.com/docs/v1/sdk-reference/frontend/android/sdk-v6)
- [Node.js backend quickstart](https://docs.hawcx.com/docs/v1/sdk-reference/backend/nodejs/quickstart)
- [Python backend quickstart](https://docs.hawcx.com/docs/v1/sdk-reference/backend/python/quickstart)
- [Documentation home](https://docs.hawcx.com)

## Support

- [Website](https://www.hawcx.com)
- [Support Email](mailto:info@hawcx.com)
