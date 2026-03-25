# E2E Harness

`hawcx-login.yaml` is the lightweight Maestro starter flow for the in-repo V6 example app.

It currently covers:

1. launching the example app
2. entering an identifier into the V6 auth card
3. starting the V6 sign-in flow
4. waiting for the prompt-driven screen to advance far enough that `Change Identifier` becomes visible

Run it with Maestro:

```bash
# iOS Simulator
maestro test hawcx-login.yaml

# Android emulator (replace with your device id)
maestro test --device emulator-5554 hawcx-login.yaml
```

This file is intentionally small. Extend it with environment-specific data for:

- resend countdown checks
- redirect callbacks
- QR approval flows
- legacy PIN fallback
- device reset actions
