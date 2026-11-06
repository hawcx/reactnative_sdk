# Changelog

## [2.0.0] - Unreleased

> **Release as 2.0.0, not 1.x** (`package.json` is at 2.0.0). Not releasable yet: see "Release checklist" in the README (publish Android 6.2.0 first, replace the vendored iOS xcframework, a local build of the native branch, with the 6.2.0 release-tag build, confirm prod `AUTH_SDK_MIN_VERSIONS_JSON`). The 426 gate note below must stay at the top of the release notes.

### Breaking
- Server 426 gate: the bridge now sends `X-Hawcx-SDK-Version`, so React Native apps fall under the server's `AUTH_SDK_MIN_VERSIONS_JSON` minimums. The prod value must not hold a minimum above the shipped native version (6.2.0).
- Native minimum is 6.2.0 on both platforms (iOS vendored `HawcxFramework.xcframework`, Android `api.hawcx:hawcx:6.2.0`).
- Android `approveV6Qr` rejects with the server's code instead of `hawcx.sdk`.
- iOS `approveV6Qr` rejections no longer carry `userInfo.shouldClearRecord` (a server answer never clears keys now).
- `routeWebLoginScan` no longer pulls a 7-digit PIN out of a JSON payload; any JSON QR with `v: 2` routes to `approval_v2`.
- `useHawcxApprover().approve(handle, number?, opts?)` / `deny(handle)` take the handle of the request the user confirmed and reject with `approval_handle_unknown` when the current request changed.
- Types: `HawcxV6PromptPayload`, `HawcxV6AuthStatus` and `HawcxV6FlowEvent` gain variants (exhaustive switches need a new case); `HawcxV6StartOptions.identifier` is optional.
- Six legacy push calls are deprecated and warn once.

### Platform differences
- `launchRedirect` resolves at different points: on iOS after the auth session returns the callback (`{launchedWith: 'auth_session'}`), on Android once the page opens in Custom Tabs or a browser (`{launchedWith}`); the callback then arrives through the app's deep link. A replaced or disposed iOS launch rejects with `redirect_cancelled`.
- `approvals_unavailable` is Android-only (the approvals service needs the device-key signer).
- `enrolledIdentifiers()` rejects with retryable `keychain_unavailable` on both platforms while the device keys can't be read (iOS uses the native `enrolledIdentifiersOrThrow()`).
- Unknown-step `rawType` is display-only: the native case name on iOS, the native prompt class name in wire form on Android.
- `forgetDevice(identifier)` resolves true on iOS only when a record was removed (false: none was stored); on Android true once no record remains, also when none was stored (false: it could not be deleted).

### Not shipped
- `HawcxV6Completed.sessionToken` / `state.sessionToken` from the plan and spec were deliberately not shipped: the session token stays native (`completed.hasSessionToken`, `getSessionToken()`).

### Added and changed
- QR sign-in without an email, end to end (needs the native 6.2.0 builds with QR sign-in enrollment, `manualCode`, `resolveCode` and `forgetDevice`):
  - `startQrLogin()` flows now finish: the native SDKs adopt the identifier the server names once the phone approves and enroll this device under it. Nothing new to call.
  - `completed.identifier` (also `state.identifier` after completion): who the flow signed in as, i.e. the started identifier, or for a QR sign-in the account the approving phone chose.
  - `await_approval.manualCode` / `state.approval.manualCode`: the 8-digit type-in code to show under the QR (QR mode only; only 8-digit strings pass through).
- Approver "Enter code instead": `resolveApprovalCode(code)` and `useHawcxApprover().resolveCode(code)` resolve the 8-digit code to the same result as `scanApproval` for that QR. Spaces and hyphens are ignored; anything but 8 digits is refused locally with `invalid_code_format`. Other errors: `code_not_found`, `too_many_attempts` (`retryAfterSeconds`), `service_unavailable` (`serverCode`, a new `HawcxServiceError` field), `transport_error`, or the server's code (`http_error` without the endpoint).
- `forgetDevice(identifier)` (also `hawcxV6Client.forgetDevice`): deletes this device's V6 device keys for one identifier (native `HawcxV1SDK.forgetDevice`). The legacy `forgetTrustedDevice` clears V4/V5 data only and never these keys.
- `HAWCX_APPROVAL_NOTIFICATION_CATEGORY` (`HAWCX_APPROVAL`, exported by the native modules from the native SDKs): the category of approval notifications.
- Example: an "Enter code instead" screen in the Approver card, and the "Sign in with QR (no email)" screen renders the QR (`react-native-qrcode-svg`) with the 8-digit code under it and shows the account it signed in as.
- Approvals v2: the native SDKs sign `rememberDevice` into the decision and never send the requester session; `decideApproval` sends `rememberDevice=false` on deny. Requires iOS/Android 6.2.0 built after 2026-10-21.
- Magic link: the `enter_code` prompt carries `pollInterval` on the magic-link code screen and the native SDKs poll in the background (`state.magicLinkPolling`), so a link confirmed on another device completes the flow.
- Magic link: `initialize({ magicLinkLandingUrl })` and `completeMagicLinkRedirect(url)` (also on `HawcxV6Client` and `useHawcxV6Auth`) finish a same-device link from a Universal Link / App Link with typed outcomes `not_magic_link | resumed | handed_off | failed{code, message, retryable}`; `isHawcxMagicLinkUrl(url, landingUrl?)` routes incoming URLs.
- Polling: the native SDKs follow the poll-route contract (advertised `pollPath`, 2s→5s→10s schedule, `Retry-After`, 429 keeps the flow, paused in the background). Prompts expose `pollPath`; `pausePolling()` / `resumePolling()` (also `v6PausePolling` / `v6ResumePolling`, `HawcxV6Client`, `useHawcxV6Auth`) give manual control. No JS poll loop.
- Native SDKs 6.2.0 (iOS vendored `HawcxFramework.xcframework`, Android `api.hawcx:hawcx:6.2.0`). Before release, the prod `AUTH_SDK_MIN_VERSIONS_JSON` must not hold a minimum above 6.2.0: the native 6.2 SDKs send `X-Hawcx-SDK-Version`, so a higher minimum answers 426 `sdk_outdated` to every request.
- Unknown step types are surfaced as `{type: 'unknown', rawType}` (status `unknown`) instead of being dropped.
- Requester:
  - `locked` step and state.
  - Notices (`state.notice`, `{type: 'notice'}` events; `unauthorized_device` recovery happens natively).
  - `setup_totp.backupCodes`.
  - `await_approval` `mode` / `approvalId` / `number`, with `state.approval` and `state.approvalOutcome`.
  - Error details `outcome` / `decidedByThisDevice`; `HawcxV6ErrorCodes`.
  - Start options `scope`, `samlReqId` and `method: 'qr_login'`, plus `startQrLogin()` and `backToMethodSelection()` on the hook and client.
  - `launchRedirect(url, returnScheme)`.
- Device APIs: `listDevices`, `revokeDevice` and `logoutEverywhere`. They use the session token, which stays native: `completed.hasSessionToken` and `getSessionToken()`.
- Approver (approvals v2):
  - `registerPushToken` / `registerPushTokenWithReport`.
  - `unregisterPushToken` (also `{identifier, appId}`; `push_not_registered`).
  - `approvalReferenceFromPush`, `scanApproval`, `fetchApprovalContext`, `decideApproval`, `discardApproval`, `enrolledIdentifiers`.
  - `useHawcxApprover()`.
  - Tokens and keys stay native behind an opaque `handle`.
- `HawcxServiceError` for the device, approver and redirect calls. The iOS and Android bridges reject with the same `userInfo` keys.
- `approveV6Qr` now goes through the native approvals facade (`approveV1`), so a server answer never clears device keys.
  - It refuses with `project_mismatch`, and can report `approval_outcome_unknown`.
  - Its errors are `HawcxServiceError`, and Android now rejects with the real code, not `hawcx.sdk`.
- `routeWebLoginScan` returns `{kind: 'approval_v2', raw}` for v2 QR codes. A JSON payload is no longer searched for a 7-digit legacy PIN.
- Breaking (types): `HawcxV6StartOptions.identifier` is optional, because `qr_login` omits it. `HawcxV6PromptPayload` / `HawcxV6AuthStatus` / `HawcxV6FlowEvent` gain variants, so exhaustive switches need the new cases.
- Deprecated: `setApnsDeviceToken`, `setFcmToken`, `setPushDeviceToken`, `handlePushNotification`, `approvePushRequest`, `declinePushRequest`. Each warns once.

## [1.1.5] - 2026-04-24
- Fix iOS React Native bridge exports for backend token persistence, post-auth session notification, and push helper APIs.
- Add iOS bridge parity coverage so JavaScript methods, Objective-C exports, and Swift implementations stay aligned.
- Remove the runtime `Buffer` dependency from APNs token encoding for React Native app compatibility.

## [1.1.4] - 2026-04-24
- Fix V6 React Native flows that could remain on the identifier step when prompt or completion events do not include a trace ID.
- Allow successful V6 completions without requiring `traceId` in event normalization or React state handling.
- Update the example app to handle backend-selected primary method prompts more reliably while keeping MFA method selection explicit.


## [1.1.1] - 2026-04-12
- Refresh the bundled iOS Hawcx framework to native iOS SDK `6.0.3`.
- Fix iOS consumer builds by shipping compiled Swift module binaries in the vendored XCFramework.

## [1.1.0] - 2026-04-12
- Add the public V6 adaptive authentication flow for React Native.
- Ship V6-ready example apps, docs, and README guidance across iOS and Android.
- Publish `HawcxReactNative` to CocoaPods in addition to the npm package release.

## [1.0.8] - 2026-01-21
- Android biometrics restriction issue fixed

## [1.0.4] - 2025-11-28
- Include Android sources in npm package and clarify linking error message.

## [1.0.3] - 2025-11-19
- TODO: add release notes

## [1.0.2] - 2025-11-18
- OAuth flow update
- Android release prep

## [1.0.1] - 2025-11-17
- Point native Android/iOS SDKs at new production authentication endpoint
- Refresh bundled Hawcx Android/iOS binaries for the 1.0.1 cut
- Harden linting by guarding React imports when running CocoaPods validation

## [0.0.1] - 2025-11-15
- Initial React Native bridge for Hawcx V5 authentication
- Added HawcxClient helpers, hooks, push support, and example app
