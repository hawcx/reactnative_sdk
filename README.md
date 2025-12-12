# Hawcx React Native SDK

Official React Native bindings for the Hawcx V5 mobile authentication platform. The package wraps the production Hawcx iOS and Android SDKs so you can deliver Smart‑Connect (OTP + device trust + push approvals) inside a single cross‑platform API.

## Requirements

* React Native ≥ 0.73 (Hermes enabled by default)
* iOS 17+ / Android 8+ (SDK requires API level 26 for Android)
* OAuth client credentials **must stay on your backend**.

## Installation

```bash
npm install @hawcx/react-native-sdk@1.0.7
# or yarn add @hawcx/react-native-sdk
```

### iOS

```
cd ios
pod install
cd ..
```

Open the workspace (`ios/*.xcworkspace`) in Xcode when you need to run on a device. The pod installs the vendored HawcxFramework.xcframework automatically.

### Android

No manual steps are required—Gradle picks up the bundled `hawcx-*.aar`. Make sure the Android SDK is installed and `ANDROID_HOME`/`adb` are on your path, then run `npm run android`. If you upgrade from an older package version, run `cd android && ./gradlew clean` once before rebuilding so React Native re-links the native module.

## Quick Start

```tsx
import { useEffect } from 'react';
import { initialize, addAuthListener } from '@hawcx/react-native-sdk';

export function bootstrapHawcx() {
  return initialize({
    projectApiKey: 'YOUR_PROJECT_API_KEY',
    baseUrl: 'https://your-hawcx-host.example.com',
  }).then(() => {
    const subscription = addAuthListener(event => {
      if (event.type === 'auth_error') {
        console.warn('Hawcx error', event.payload);
      }
    });
    return () => subscription.remove();
  });
}
```

Call `bootstrapHawcx()` once when your app starts (e.g., inside your root component or Redux saga). After that you can use hooks or imperative helpers to drive Smart‑Connect.

> **Note:** `baseUrl` must be the tenant-specific Hawcx host (e.g., `https://hawcx-api.hawcx.com`). The native SDK appends `/hc_auth` internally and routes all APIs through that cluster.

### Authentication flow (OTP + authorization code)

The SDK now always returns an authorization code. Your frontend must forward it to your backend, which redeems it with Hawcx using the OAuth client credentials we issued for your project.

```tsx
import React, { useEffect, useState } from 'react';
import { useHawcxAuth, storeBackendOAuthTokens } from '@hawcx/react-native-sdk';

export function SmartConnectScreen() {
  const { state, authenticate, submitOtp, reset } = useHawcxAuth();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');

  useEffect(() => {
    if (state.status === 'authorization_code') {
      void exchangeCode(state.payload).finally(() => reset());
    }
  }, [state, reset]);

  const exchangeCode = async ({ code, expiresIn }) => {
    const response = await fetch('https://your-backend.example.com/api/hawcx/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), code, expires_in: expiresIn }),
    });
    if (!response.ok) {
      throw new Error('Backend verification failed');
    }
    const { access_token, refresh_token } = await response.json();
    await storeBackendOAuthTokens(email.trim(), access_token, refresh_token);
  };

  return (
    <>
      {/* Collect identifier */}
      <Button title="Continue" onPress={() => authenticate(email.trim())} />

      {state.status === 'otp' && (
        <>
          <TextInput value={otp} onChangeText={setOtp} keyboardType="number-pad" />
          <Button title="Verify OTP" onPress={() => submitOtp(otp)} />
        </>
      )}

      {state.status === 'authorization_code' && <Text>Sending authorization code…</Text>}
      {state.status === 'additional_verification_required' && (
        <Text>Additional verification required: {state.payload.detail ?? state.payload.sessionId}</Text>
      )}
      {state.status === 'error' && <Text>{state.error.message}</Text>}
    </>
  );
}
```

### Backend exchange

Redeem the authorization code on your server using the hawcx/oauth-client package or your preferred language SDK. Never ship `clientId`, token endpoint, private keys, or Hawcx public keys inside your mobile app.

```ts
import express from 'express';
import { exchangeCodeForTokenAndClaims } from '@hawcx/oauth-client';

const app = express();
app.use(express.json());

app.post('/api/hawcx/login', async (req, res) => {
  const { email, code, expires_in } = req.body ?? {};
  if (!email || !code) {
    return res.status(400).json({ success: false, error: 'Missing email or code' });
  }

  try {
    const [claims, idToken] = await exchangeCodeForTokenAndClaims({
      code,
      oauthTokenUrl: process.env.HAWCX_OAUTH_TOKEN_ENDPOINT!,
      clientId: process.env.HAWCX_OAUTH_CLIENT_ID!,
      publicKey: process.env.HAWCX_OAUTH_PUBLIC_KEY_PEM!,
      audience: process.env.HAWCX_OAUTH_CLIENT_ID,
      issuer: process.env.HAWCX_OAUTH_ISSUER,
    });

    return res.json({
      success: true,
      message: `Verified ${claims.email}`,
      access_token: idToken,
      refresh_token: idToken,
    });
  } catch (error) {
    return res.status(401).json({ success: false, error: error.message });
  }
});
```

Once the backend responds, call `storeBackendOAuthTokens(userId, tokens)` so the Hawcx SDK saves them securely and can continue handling push registration and device sessions.

## Hooks & Helpers

* `useHawcxAuth()` – React hook that exposes the current auth state and helpers (`authenticate`, `submitOtp`, `reset`).
* `useHawcxWebLogin()` – Drive QR/PIN based approvals.
* `addAuthListener` / `addSessionListener` / `addPushListener` – Lower-level event APIs if you prefer an imperative approach.
* `setPushDeviceToken` / `notifyUserAuthenticated` – Wire push login approvals.

Refer to the updated [React Quickstart documentation](https://docs.hawcx.com/react/quickstart) for details on each API, push approvals, and device session management.

## Example App

`/example` contains a full React Native app wired to the SDK with logging, OTP UI, push harness, and a backend toggle. To run it:

```bash
cd example
npm install
npm run ios   # or npm run android
```

Add your Project API key in `example/src/hawcx.config.ts` or paste it into the in-app form. The **Authorization Code & Backend Exchange** card runs in demo mode by default (codes complete locally). Set `BACKEND_FLOW_ENABLED = true` in `example/src/App.tsx` when you have a tunnel or backend ready to receive `{ code, email, expires_in }`.

## Support

* Documentation: [React Quickstart](https://docs.hawcx.com/react/quickstart)
* Questions? Reach out to your Hawcx solutions engineer or info@hawcx.com.
