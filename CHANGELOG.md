# Changelog

## [Unreleased]
- Magic link: the `enter_code` prompt carries `pollInterval` on the magic-link code screen and the native SDKs poll in the background (`state.magicLinkPolling`), so a link confirmed on another device completes the flow.
- Magic link: `initialize({ magicLinkLandingUrl })` and `completeMagicLinkRedirect(url)` (also on `HawcxV6Client` and `useHawcxV6Auth`) finish a same-device link from a Universal Link / App Link with typed outcomes `not_magic_link | resumed | handed_off | failed{code, message, retryable}`; `isHawcxMagicLinkUrl(url, landingUrl?)` routes incoming URLs.
- Polling: the native SDKs follow the poll-route contract (advertised `pollPath`, 2s→5s→10s schedule, `Retry-After`, 429 keeps the flow, paused in the background). Prompts expose `pollPath`; `pausePolling()` / `resumePolling()` (also `v6PausePolling` / `v6ResumePolling`, `HawcxV6Client`, `useHawcxV6Auth`) give manual control. No JS poll loop.
- Requires native iOS SDK `6.1.0` (vendored `HawcxFramework.xcframework`) and Android SDK `api.hawcx:hawcx:6.1.0`. Do not merge or release this before both native `6.1.0` SDKs are published.

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
