# E2E Harness

The `hawcx-login.yaml` Maestro script provides a starting point for automated flows:
1. Launches the example app
2. Enters a sample email address
3. Taps Authenticate and waits for the OTP prompt

Customize the `appId`, selectors, and OTP behavior to match your test devices. This script is intentionally lightweight so it can be extended to cover push approvals, PIN validation, and error states.

Run it against any emulator/simulator:
```bash
# iOS Simulator
maestro test hawcx-login.yaml

# Android emulator (replace with your device id)
maestro test --device emulator-5554 hawcx-login.yaml
```
