import AuthenticationServices
import Foundation
import HawcxFramework

#if canImport(React)
import React

@objc(HawcxReactNative)
class HawcxReactNative: RCTEventEmitter {
    private let authEventName = "hawcx.auth.event"
    private let sessionEventName = "hawcx.session.event"
    private let pushEventName = "hawcx.push.event"
    private let v6FlowEventName = HAWCX_V6_FLOW_EVENT_NAME
    private var hawcxSDK: HawcxSDK?
    private var hawcxV6Bridge: HawcxV6Bridge?
    private var authCallbackProxy: AuthCallbackProxy?
    private var sessionCallbackProxy: SessionCallbackProxy?
    private var pushDelegateProxy: PushDelegateProxy?

    override static func requiresMainQueueSetup() -> Bool {
        true

        
    }

    override func supportedEvents() -> [String]! {
        [authEventName, sessionEventName, pushEventName, v6FlowEventName]
    }

    /// `approvalNotificationCategory`: the APNs `aps.category` of approval pushes.
    override func constantsToExport() -> [AnyHashable: Any]! {
        ["approvalNotificationCategory": HawcxV1ApprovalService.notificationCategory]
    }

    override func invalidate() {
        tearDownNativeLanes(resetV6Flow: true)
        super.invalidate()
    }

    @objc
    func initialize(_ config: NSDictionary,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let projectApiKey = config["projectApiKey"] as? String, !projectApiKey.isEmpty else {
            reject("hawcx.config", "projectApiKey is required", nil)
            return
        }

        var oauthConfig: HawcxOAuthConfig?
        if let oauthDict = config["oauthConfig"] as? [String: Any] {
            do {
                oauthConfig = try makeOAuthConfig(from: oauthDict)
            } catch {
                reject("hawcx.config", error.localizedDescription, error)
                return
            }
        }

        guard let baseUrl = HawcxReactNative.resolveBaseUrl(config: config) else {
            reject("hawcx.config", "baseUrl is required", nil)
            return
        }

        DispatchQueue.main.async {
            self.tearDownNativeLanes(resetV6Flow: true)
            self.hawcxSDK = HawcxSDK(projectApiKey: projectApiKey, baseURL: baseUrl, oauthConfig: oauthConfig)
            self.authCallbackProxy = AuthCallbackProxy(emitter: self)
            self.sessionCallbackProxy = SessionCallbackProxy(emitter: self)
            let pushDelegate = PushDelegateProxy(emitter: self)
            self.pushDelegateProxy = pushDelegate
            self.hawcxSDK?.pushAuthDelegate = pushDelegate

            guard let v6BaseURL = URL(string: baseUrl) else {
                self.tearDownNativeLanes(resetV6Flow: true)
                reject("hawcx.config", "baseUrl must be a valid URL", nil)
                return
            }

            let v6Options: HawcxV6InitializeOptions
            do {
                v6Options = try HawcxV6InitializeOptions.from(config: config)
            } catch {
                self.tearDownNativeLanes(resetV6Flow: true)
                reject("hawcx.config", error.localizedDescription, error)
                return
            }

            let v6Bridge = HawcxV6Bridge(emitter: self)
            v6Bridge.configure(
                configId: projectApiKey,
                baseURL: v6BaseURL,
                options: v6Options
            )
            self.hawcxV6Bridge = v6Bridge
            resolve(nil)
        }
    }

    private static func resolveBaseUrl(config: NSDictionary) -> String? {
        if let directBase = config["baseUrl"] as? String {
            let trimmed = directBase.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed
            }
        }
        if let endpoints = config["endpoints"] as? [String: Any],
           let authBase = endpoints["authBaseUrl"] as? String {
            let trimmed = authBase.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed
            }
        }
        return nil
    }

    private func rejectV6Error(_ error: Error, reject: @escaping RCTPromiseRejectBlock) {
        let code: String
        if case HawcxV6BridgeError.notInitialized = error {
            code = "hawcx.sdk"
        } else {
            code = "hawcx.input"
        }
        reject(code, error.localizedDescription, error)
    }

    private func qrApprovalNSError(_ error: HawcxV1QrApprovalError) -> NSError {
        var userInfo: [String: Any] = [
            NSLocalizedDescriptionKey: error.message,
            "retryable": error.retryable
        ]
        if let retryAfterSeconds = error.retryAfterSeconds {
            userInfo["retryAfterSeconds"] = retryAfterSeconds
        }
        return NSError(domain: "com.hawcx.reactnative.qr", code: 0, userInfo: userInfo)
    }

    @objc
    func authenticate(_ userId: NSString,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before authenticate", nil)
            return
        }

        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "userid cannot be empty", nil)
            return
        }

        guard let callback = authCallbackProxy else {
            reject("hawcx.sdk", "Auth callback not configured", nil)
            return
        }

        DispatchQueue.main.async {
            sdk.authenticateV5(userid: trimmed, callback: callback)
            resolve(nil)
        }
    }

    @objc
    func submitOtp(_ otp: NSString,
                   resolver resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before submitOtp", nil)
            return
        }
        let trimmed = otp.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "otp cannot be empty", nil)
            return
        }
        DispatchQueue.main.async {
            sdk.submitOtpV5(otp: trimmed)
            resolve(nil)
        }
    }

    @objc
    func v6Start(_ options: NSDictionary,
                 resolver resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                let v6Options = try HawcxV6StartOptions.from(options: options)
                try bridge.start(options: v6Options)
                resolve(nil)
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6SelectMethod(_ methodId: NSString,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = methodId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "methodId is required", nil)
            return
        }

        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.selectMethod(trimmed)
                resolve(nil)
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6SubmitCode(_ code: NSString,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "code is required", nil)
            return
        }

        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.submitCode(trimmed)
                resolve(nil)
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6SubmitTotp(_ code: NSString,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "code is required", nil)
            return
        }

        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.submitTotp(trimmed)
                resolve(nil)
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6SubmitPhone(_ phone: NSString,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "phone is required", nil)
            return
        }

        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.submitPhone(trimmed)
                resolve(nil)
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6Resend(_ resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                let dispatched = try bridge.resend()
                resolve(dispatched)
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6Poll(_ resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.poll()
                resolve(nil)
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    /// Manual hold on background polling. The native SDK already pauses on
    /// `didEnterBackground` and resumes on `willEnterForeground`. A no-op
    /// before `initialize`.
    @objc
    func v6PausePolling(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.hawcxV6Bridge?.pausePolling()
            resolve(nil)
        }
    }

    @objc
    func v6ResumePolling(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.hawcxV6Bridge?.resumePolling()
            resolve(nil)
        }
    }

    @objc
    func v6Cancel(_ resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.cancel()
                resolve(nil)
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6Reset(_ resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard let bridge = self.hawcxV6Bridge else {
                self.rejectV6Error(HawcxV6BridgeError.notInitialized, reject: reject)
                return
            }
            bridge.sdk?.reset()
            resolve(nil)
        }
    }

    @objc
    func v6HandleRedirectUrl(_ url: NSString,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "url is required", nil)
            return
        }

        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.handleRedirect(urlString: trimmed)
                resolve(nil)
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6CompleteMagicLinkRedirect(_ url: NSString,
                                     resolver resolve: @escaping RCTPromiseResolveBlock,
                                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "url is required", nil)
            return
        }

        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.completeMagicLinkRedirect(urlString: trimmed) { outcome in
                    resolve(outcome)
                }
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6BackToMethodSelection(_ resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                resolve(try bridge.backToMethodSelection())
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    /// Resolves the last completed flow's session token or nil. Never logged.
    @objc
    func v6GetSessionToken(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            resolve(self.hawcxV6Bridge?.currentSessionToken())
        }
    }

    @objc
    func v6ListDevices(_ sessionToken: Any?,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        let bearer = HawcxReactNative.optionalString(sessionToken)
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.listDevices(bearerToken: bearer) { result in
                    DispatchQueue.main.async {
                        switch result {
                        case let .success(devices): resolve(devices)
                        case let .failure(error): self.rejectApprovalError(error, reject: reject)
                        }
                    }
                }
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6RevokeDevice(_ sessionToken: Any?,
                        deviceId: NSString,
                        reason: Any?,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        let bearer = HawcxReactNative.optionalString(sessionToken)
        let trimmedDevice = deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedDevice.isEmpty else {
            reject("hawcx.input", "deviceId is required", nil)
            return
        }
        let trimmedReason = HawcxReactNative.optionalString(reason)
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.revokeDevice(bearerToken: bearer, deviceId: trimmedDevice, reason: trimmedReason) { result in
                    DispatchQueue.main.async {
                        switch result {
                        case .success: resolve(nil)
                        case let .failure(error): self.rejectApprovalError(error, reject: reject)
                        }
                    }
                }
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6LogoutEverywhere(_ sessionToken: Any?,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        let bearer = HawcxReactNative.optionalString(sessionToken)
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.logoutEverywhere(bearerToken: bearer) { result in
                    DispatchQueue.main.async {
                        switch result {
                        case let .success(count): resolve(["sessionsEnded": count])
                        case let .failure(error): self.rejectApprovalError(error, reject: reject)
                        }
                    }
                }
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func v6LaunchRedirect(_ url: NSString,
                          returnScheme: Any?,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "url is required", nil)
            return
        }
        let scheme = HawcxReactNative.optionalString(returnScheme)
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                try bridge.launchRedirect(
                    url: trimmed,
                    returnScheme: scheme,
                    anchor: { RCTKeyWindow() ?? ASPresentationAnchor() }
                ) { result in
                    switch result {
                    case .success: resolve(["launchedWith": "auth_session"])
                    case let .failure(error): self.rejectApprovalError(error, reject: reject)
                    }
                }
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    // MARK: - Approver (approvals v2)

    private func withApprover(
        reject: @escaping RCTPromiseRejectBlock,
        _ work: @escaping (HawcxV6ApproverBridge) -> Void
    ) {
        DispatchQueue.main.async {
            guard let approver = self.hawcxV6Bridge?.approver else {
                self.rejectV6Error(HawcxV6BridgeError.notInitialized, reject: reject)
                return
            }
            work(approver)
        }
    }

    private func settle<T>(
        _ result: Result<T, HawcxV1ApprovalError>,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock,
        transform: (T) -> Any?
    ) {
        switch result {
        case let .success(value): resolve(transform(value))
        case let .failure(error): rejectApprovalError(error, reject: reject)
        }
    }

    @objc
    func v6RegisterPushToken(_ registration: NSDictionary,
                             force: NSNumber,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        withApprover(reject: reject) { approver in
            approver.registerPushToken(registration, force: force.boolValue) { result in
                self.settle(result, resolve: resolve, reject: reject) { $0 }
            }
        }
    }

    @objc
    func v6UnregisterPushToken(_ identifier: Any?,
                               appId: Any?,
                               resolver resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        let identifierValue = HawcxReactNative.optionalString(identifier)
        let appIdValue = HawcxReactNative.optionalString(appId)
        withApprover(reject: reject) { approver in
            approver.unregisterPushToken(identifier: identifierValue, appId: appIdValue) { result in
                self.settle(result, resolve: resolve, reject: reject) { _ in nil }
            }
        }
    }

    @objc
    func v6ApprovalReferenceFromPush(_ payload: NSDictionary,
                                     resolver resolve: @escaping RCTPromiseResolveBlock,
                                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        withApprover(reject: reject) { approver in
            resolve(approver.approvalReference(fromPush: payload))
        }
    }

    @objc
    func v6ScanApproval(_ raw: NSString,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        withApprover(reject: reject) { approver in
            resolve(trimmed.isEmpty ? nil : approver.scan(trimmed))
        }
    }

    @objc
    func v6FetchApprovalContext(_ reference: NSDictionary,
                                identifier: Any?,
                                resolver resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
        let identifierValue = HawcxReactNative.optionalString(identifier)
        withApprover(reject: reject) { approver in
            approver.fetchContext(reference: reference, identifier: identifierValue) { result in
                self.settle(result, resolve: resolve, reject: reject) { $0 }
            }
        }
    }

    @objc
    func v6DecideApproval(_ handle: NSString,
                          decision: NSString,
                          numberChoice: Any?,
                          rememberDevice: NSNumber,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        let number = (numberChoice as? NSNumber)?.intValue
        let handleValue = handle as String
        let decisionValue = decision as String
        withApprover(reject: reject) { approver in
            approver.decide(
                handle: handleValue,
                decision: decisionValue,
                numberChoice: number,
                rememberDevice: rememberDevice.boolValue
            ) { result in
                self.settle(result, resolve: resolve, reject: reject) { $0 }
            }
        }
    }

    @objc
    func v6DiscardApproval(_ handle: NSString,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        let handleValue = handle as String
        DispatchQueue.main.async {
            self.hawcxV6Bridge?.approver?.discard(handle: handleValue)
            resolve(nil)
        }
    }

    @objc
    func v6EnrolledIdentifiers(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        withApprover(reject: reject) { approver in
            switch approver.enrolledIdentifiers() {
            case let .success(identifiers):
                resolve(identifiers)
            case let .failure(error):
                self.rejectApprovalError(error, reject: reject)
            }
        }
    }

    /// Resolves the scan shape (`{version: 2, reference}` / `{version: 1,
    /// payloadType}`) for a requester screen's 8-digit code.
    @objc
    func v6ResolveApprovalCode(_ code: NSString,
                               resolver resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        let codeValue = code as String
        withApprover(reject: reject) { approver in
            approver.resolveCode(codeValue) { result in
                switch result {
                case let .success(scanned): resolve(scanned)
                case let .failure(error): self.rejectApprovalCodeError(error, reject: reject)
                }
            }
        }
    }

    /// Deletes this device's V6 key record for `identifier`; resolves whether
    /// one was removed. Not the legacy `clearUserKeychainData`.
    @objc
    func v6ForgetDevice(_ identifier: NSString,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "identifier is required", nil)
            return
        }
        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }
                resolve(try bridge.forgetDevice(identifier: trimmed))
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    /// `resolveApprovalCode` failures: the same `userInfo` keys as
    /// `rejectApprovalError`, plus `serverCode` for `service_unavailable`.
    func rejectApprovalCodeError(_ error: HawcxV1ApprovalCodeError, reject: @escaping RCTPromiseRejectBlock) {
        let message = HawcxV6ApproverBridge.message(for: error)
        var userInfo: [String: Any] = [
            NSLocalizedDescriptionKey: message,
            "retryable": error.retryable
        ]
        if let status = error.status { userInfo["status"] = status }
        if let retryAfterSeconds = error.retryAfterSeconds { userInfo["retryAfterSeconds"] = retryAfterSeconds }
        if let serverCode = HawcxV6ApproverBridge.serverCode(of: error) { userInfo["serverCode"] = serverCode }
        reject(error.code, message, NSError(domain: "com.hawcx.reactnative.approvals", code: error.status ?? 0, userInfo: userInfo))
    }

    /// Rejects with the error's code; `userInfo` carries
    /// `{status, retryable, retryAfterSeconds, outcome, decidedByThisDevice}`
    /// (the same keys the Android bridge sends). No secrets are in these errors.
    func rejectApprovalError(_ error: HawcxV1ApprovalError, reject: @escaping RCTPromiseRejectBlock) {
        var userInfo: [String: Any] = [
            NSLocalizedDescriptionKey: error.message,
            "retryable": error.retryable
        ]
        if let status = error.status { userInfo["status"] = status }
        if let retryAfterSeconds = error.retryAfterSeconds { userInfo["retryAfterSeconds"] = retryAfterSeconds }
        if let outcome = error.outcome { userInfo["outcome"] = outcome }
        if let decided = error.decidedByThisDevice { userInfo["decidedByThisDevice"] = decided }
        reject(error.code, error.message, NSError(domain: "com.hawcx.reactnative.approvals", code: error.status ?? 0, userInfo: userInfo))
    }

    static func optionalString(_ value: Any?) -> String? {
        guard let text = value as? String else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    @objc
    func v6ApproveQr(_ rawPayload: NSString,
                     identifier: NSString,
                     rememberDevice: NSNumber,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmedPayload = rawPayload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPayload.isEmpty else {
            reject("hawcx.input", "rawPayload is required", nil)
            return
        }

        let trimmedIdentifier = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedIdentifier.isEmpty else {
            reject("hawcx.input", "identifier is required", nil)
            return
        }

        DispatchQueue.main.async {
            do {
                guard let bridge = self.hawcxV6Bridge else {
                    throw HawcxV6BridgeError.notInitialized
                }

                try bridge.approveQr(
                    rawPayload: trimmedPayload,
                    identifier: trimmedIdentifier,
                    rememberDevice: rememberDevice.boolValue
                ) { result in
                    DispatchQueue.main.async {
                        switch result {
                        case .success(.approved(let payloadType)):
                            resolve([
                                "outcome": "approved",
                                "payloadType": payloadType
                            ])
                        case .success(.bound(let payloadType, let userId)):
                            var payload: [String: Any] = [
                                "outcome": "bound",
                                "payloadType": payloadType
                            ]
                            if let userId, !userId.isEmpty {
                                payload["userId"] = userId
                            }
                            resolve(payload)
                        case .failure(let error):
                            reject(error.code, error.message, self.qrApprovalNSError(error))
                        }
                    }
                }
            } catch {
                self.rejectV6Error(error, reject: reject)
            }
        }
    }

    @objc
    func getDeviceDetails(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before getDeviceDetails", nil)
            return
        }
        guard let callback = sessionCallbackProxy else {
            reject("hawcx.sdk", "Session callback not configured", nil)
            return
        }
        DispatchQueue.main.async {
            sdk.getDeviceDetails(callback: callback)
            resolve(nil)
        }
    }

    @objc
    func webLogin(_ pin: NSString,
                  resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before webLogin", nil)
            return
        }
        guard let callback = sessionCallbackProxy else {
            reject("hawcx.sdk", "Session callback not configured", nil)
            return
        }
        let trimmed = pin.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "pin cannot be empty", nil)
            return
        }
        DispatchQueue.main.async {
            sdk.webLogin(pin: trimmed, callback: callback)
            resolve(nil)
        }
    }

    @objc
    func webApprove(_ token: NSString,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before webApprove", nil)
            return
        }
        guard let callback = sessionCallbackProxy else {
            reject("hawcx.sdk", "Session callback not configured", nil)
            return
        }
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "token cannot be empty", nil)
            return
        }
        DispatchQueue.main.async {
            sdk.webApprove(token: trimmed, callback: callback)
            resolve(nil)
        }
    }

    @objc
    func storeBackendOAuthTokens(_ userId: NSString,
                                 accessToken: NSString,
                                 refreshToken: Any?,
                                 resolver resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before storeBackendOAuthTokens", nil)
            return
        }

        let trimmedUser = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAccess = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedUser.isEmpty else {
            reject("hawcx.input", "userId cannot be empty", nil)
            return
        }

        guard !trimmedAccess.isEmpty else {
            reject("hawcx.input", "accessToken cannot be empty", nil)
            return
        }

        var refreshValue: String?
        if let refreshString = refreshToken as? NSString {
            let trimmed = refreshString.trimmingCharacters(in: .whitespacesAndNewlines)
            refreshValue = trimmed.isEmpty ? nil : trimmed
        }

        DispatchQueue.main.async {
            let stored = sdk.storeBackendOAuthTokens(accessToken: trimmedAccess,
                                                     refreshToken: refreshValue,
                                                     forUser: trimmedUser)
            if stored {
                resolve(true)
            } else {
                reject("hawcx.storage", "Failed to persist backend-issued tokens", nil)
            }
        }
    }

    @objc
    func setApnsDeviceToken(_ tokenBase64: NSString,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before setApnsDeviceToken", nil)
            return
        }

        let trimmed = tokenBase64.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "token cannot be empty", nil)
            return
        }
        guard let tokenData = Data(base64Encoded: trimmed), !tokenData.isEmpty else {
            reject("hawcx.input", "token must be valid base64 data", nil)
            return
        }

        DispatchQueue.main.async {
            sdk.setAPNsDeviceToken(tokenData)
            resolve(nil)
        }
    }

    @objc
    func userDidAuthenticate(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before userDidAuthenticate", nil)
            return
        }

        DispatchQueue.main.async {
            sdk.userDidAuthenticate()
            resolve(nil)
        }
    }

    @objc
    func handlePushNotification(_ payload: NSDictionary,
                                resolver resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before handlePushNotification", nil)
            return
        }

        var userInfo: [AnyHashable: Any] = [:]
        payload.forEach { key, value in
            if let stringKey = key as? String {
                userInfo[stringKey] = value
            }
        }

        DispatchQueue.main.async {
            let handled = sdk.handlePushNotification(userInfo: userInfo)
            resolve(handled)
        }
    }

    @objc
    func approvePushRequest(_ requestId: NSString,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before approvePushRequest", nil)
            return
        }

        let trimmed = requestId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "requestId cannot be empty", nil)
            return
        }

        DispatchQueue.main.async {
            sdk.approveLoginRequest(requestId: trimmed) { error in
                DispatchQueue.main.async {
                    if let error {
                        reject("hawcx.sdk", error.localizedDescription, error)
                    } else {
                        resolve(nil)
                    }
                }
            }
        }
    }

    @objc
    func declinePushRequest(_ requestId: NSString,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before declinePushRequest", nil)
            return
        }

        let trimmed = requestId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reject("hawcx.input", "requestId cannot be empty", nil)
            return
        }

        DispatchQueue.main.async {
            sdk.declineLoginRequest(requestId: trimmed) { error in
                DispatchQueue.main.async {
                    if let error {
                        reject("hawcx.sdk", error.localizedDescription, error)
                    } else {
                        resolve(nil)
                    }
                }
            }
        }
    }

    @objc
    func getLastLoggedInUser(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before getLastLoggedInUser", nil)
            return
        }

        DispatchQueue.main.async {
            resolve(sdk.getLastLoggedInUser())
        }
    }

    @objc
    func clearSessionTokens(_ userId: NSString,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before clearSessionTokens", nil)
            return
        }

        let trimmedUser = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedUser.isEmpty else {
            reject("hawcx.input", "userId cannot be empty", nil)
            return
        }

        DispatchQueue.main.async {
            self.hawcxV6Bridge?.sdk?.reset()
            sdk.clearSessionTokens(forUser: trimmedUser)
            resolve(nil)
        }
    }

    @objc
    func clearUserKeychainData(_ userId: NSString,
                               resolver resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before clearUserKeychainData", nil)
            return
        }

        let trimmedUser = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedUser.isEmpty else {
            reject("hawcx.input", "userId cannot be empty", nil)
            return
        }

        DispatchQueue.main.async {
            self.hawcxV6Bridge?.sdk?.reset()
            sdk.clearUserKeychainData(forUser: trimmedUser)
            resolve(nil)
        }
    }

    @objc
    func clearLastLoggedInUser(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = hawcxSDK else {
            reject("hawcx.sdk", "initialize must be called before clearLastLoggedInUser", nil)
            return
        }

        DispatchQueue.main.async {
            sdk.clearLastLoggedInUser()
            resolve(nil)
        }
    }

    fileprivate func emitAuthEvent(_ body: [String: Any]) {
        sendEvent(withName: authEventName, body: body)
    }

    fileprivate func emitSessionEvent(_ body: [String: Any]) {
        sendEvent(withName: sessionEventName, body: body)
    }

    fileprivate func emitPushEvent(_ body: [String: Any]) {
        sendEvent(withName: pushEventName, body: body)
    }

    func emitV6FlowEvent(_ body: [String: Any]) {
        sendEvent(withName: v6FlowEventName, body: body)
    }

    private func tearDownNativeLanes(resetV6Flow: Bool) {
        hawcxSDK?.pushAuthDelegate = nil
        pushDelegateProxy = nil
        sessionCallbackProxy = nil
        authCallbackProxy = nil
        hawcxV6Bridge?.dispose(resetFlow: resetV6Flow)
        hawcxV6Bridge = nil
        hawcxSDK = nil
    }

    private func makeOAuthConfig(from dict: [String: Any]) throws -> HawcxOAuthConfig {
        guard
            let endpointString = dict["tokenEndpoint"] as? String,
            let endpointURL = URL(string: endpointString),
            let clientId = dict["clientId"] as? String,
            let publicKeyPem = dict["publicKeyPem"] as? String,
            !clientId.isEmpty,
            !publicKeyPem.isEmpty
        else {
            throw HawcxReactNativeError.invalidOAuthConfig
        }
        return HawcxOAuthConfig(tokenEndpoint: endpointURL, clientId: clientId, publicKeyPem: publicKeyPem)
    }
}

private enum HawcxReactNativeError: LocalizedError {
    case invalidOAuthConfig

    var errorDescription: String? {
        switch self {
        case .invalidOAuthConfig:
            return "oauthConfig must include tokenEndpoint, clientId, and publicKeyPem"
        }
    }
}

private final class AuthCallbackProxy: NSObject, AuthV5Callback {
    weak var emitter: HawcxReactNative?

    init(emitter: HawcxReactNative) {
        self.emitter = emitter
    }

    func onOtpRequired() {
        emitter?.emitAuthEvent(["type": "otp_required"])
    }

    func onAuthSuccess(accessToken: String?, refreshToken: String?, isLoginFlow: Bool) {
        var payload: [String: Any] = [
            "isLoginFlow": isLoginFlow
        ]

        if let accessToken {
            payload["accessToken"] = accessToken
        }
        if let refreshToken {
            payload["refreshToken"] = refreshToken
        }

        emitter?.emitAuthEvent(["type": "auth_success", "payload": payload])
    }

    func onError(errorCode: AuthV5ErrorCode, errorMessage: String) {
        let payload: [String: Any] = [
            "code": errorCode.rawValue,
            "message": errorMessage
        ]
        emitter?.emitAuthEvent(["type": "auth_error", "payload": payload])
    }

    func onAuthorizationCode(code: String, expiresIn: Int?) {
        var payload: [String: Any] = [
            "code": code
        ]

        if let expiresIn {
            payload["expiresIn"] = expiresIn
        }

        emitter?.emitAuthEvent(["type": "authorization_code", "payload": payload])
    }

    func onAdditionalVerificationRequired(sessionId: String, detail: String?) {
        var payload: [String: Any] = [
            "sessionId": sessionId
        ]
        if let detail {
            payload["detail"] = detail
        }
        emitter?.emitAuthEvent(["type": "additional_verification_required", "payload": payload])
    }
}

private final class SessionCallbackProxy: NSObject, DevSessionCallback, WebLoginCallback {
    weak var emitter: HawcxReactNative?

    init(emitter: HawcxReactNative) {
        self.emitter = emitter
    }

    func onSuccess() {
        emitter?.emitSessionEvent(["type": "session_success"])
    }

    func showError() {
        emitter?.emitSessionEvent([
            "type": "session_error",
            "payload": [
                "code": "session_error",
                "message": "Failed to fetch device session"
            ]
        ])
    }

    func showError(webLoginErrorCode: WebLoginErrorCode, errorMessage: String) {
        emitter?.emitSessionEvent([
            "type": "session_error",
            "payload": [
                "code": webLoginErrorCode.rawValue,
                "message": errorMessage
            ]
        ])
    }
}

private final class PushDelegateProxy: NSObject, HawcxPushAuthDelegate {
    weak var emitter: HawcxReactNative?

    init(emitter: HawcxReactNative) {
        self.emitter = emitter
    }

    func hawcx(didReceiveLoginRequest requestId: String, details: PushLoginRequestDetails) {
        var payload: [String: Any] = [
            "requestId": requestId,
            "ipAddress": details.ipAddress,
            "deviceInfo": details.deviceInfo,
            "timestamp": details.timestamp
        ]
        if let location = details.location {
            payload["location"] = location
        }
        emitter?.emitPushEvent(["type": "push_login_request", "payload": payload])
    }

    func hawcx(failedToFetchLoginRequestDetails error: Error) {
        emitter?.emitPushEvent([
            "type": "push_error",
            "payload": [
                "code": "push_error",
                "message": error.localizedDescription
            ]
        ])
    }
}

#else

@objc(HawcxReactNative)
class HawcxReactNative: NSObject {
    override init() {
        super.init()
        assertionFailure("React Native dependency not detected. Link React-Core before using HawcxReactNative.")
    }
}

#endif
