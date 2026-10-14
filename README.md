# Hawcx React Native SDK

Official React Native bindings for the Hawcx mobile authentication platform. The package
wraps the production Hawcx iOS and Android SDKs so you can ship the current V6 adaptive
flow in a single cross-platform API while keeping existing V5 utilities available during
migration.

## What This Package Includes

- V6 adaptive authentication via `useHawcxV6Auth`, `startV6Flow`, and `hawcxV6Client`
- Production native iOS and Android SDK integrations under the hood
- Redirect, approval polling, and QR approval helpers for V6 flows
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

## QR Approvals and Web Login Helpers

The package also exposes helpers for QR approval and legacy web-login scans:

- `routeWebLoginScan(raw)`
- `approveV6Qr(rawPayload, identifier, options)`
- `useHawcxWebLogin()`

For protocol QR payloads, you can approve directly from React Native:

```tsx
import { approveV6Qr, routeWebLoginScan } from '@hawcx/react-native-sdk';

const route = routeWebLoginScan(scanValue);
if (route.kind === 'protocol_qr') {
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
- `setPushDeviceToken`
- `notifyUserAuthenticated`
- `handlePushNotification`, `approvePushRequest`, `declinePushRequest`

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
