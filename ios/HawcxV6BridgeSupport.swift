import AuthenticationServices
import Foundation
import HawcxFramework

#if canImport(React)

internal let HAWCX_V6_FLOW_EVENT_NAME = "hawcx.v6.flow.event"

internal struct HawcxV6StartOptions {
    let flowType: HawcxV1FlowType
    /// Empty for `qrLogin`.
    let identifier: String
    let startToken: String?
    let inviteCode: String?
    let codeChallenge: String?
    let scope: String?
    let samlReqId: String?
    /// `method: "qr_login"`: anonymous QR sign-in (no identifier).
    let qrLogin: Bool

    static func from(options: NSDictionary) throws -> HawcxV6StartOptions {
        let identifier = (options["identifier"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty
        let method = (options["method"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty
        let codeChallenge = (options["codeChallenge"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty

        if let method {
            guard method == "qr_login" else {
                throw HawcxV6BridgeError.invalidInput("method must be qr_login when set")
            }
            guard identifier == nil else {
                throw HawcxV6BridgeError.invalidInput("identifier must be omitted for qr_login")
            }
            return HawcxV6StartOptions(
                flowType: .signin,
                identifier: "",
                startToken: nil,
                inviteCode: nil,
                codeChallenge: codeChallenge,
                scope: nil,
                samlReqId: nil,
                qrLogin: true
            )
        }

        guard let identifier else {
            throw HawcxV6BridgeError.invalidInput("identifier is required")
        }

        let flowTypeRaw = (options["flowType"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty ?? HawcxV1FlowType.signin.rawValue
        guard let flowType = HawcxV1FlowType(rawValue: flowTypeRaw) else {
            throw HawcxV6BridgeError.invalidInput("flowType must be one of signin, signup, or account_manage")
        }

        return HawcxV6StartOptions(
            flowType: flowType,
            identifier: identifier,
            startToken: (options["startToken"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty,
            inviteCode: (options["inviteCode"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty,
            codeChallenge: codeChallenge,
            scope: (options["scope"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty,
            samlReqId: (options["samlReqId"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty,
            qrLogin: false
        )
    }
}

internal enum HawcxV6MagicLinkLanding {
    /// https with a host; no user info, query or fragment (the server matches
    /// registered URLs exactly; the native SDK applies the same rule).
    static func parse(_ value: Any?) throws -> URL? {
        guard let raw = (value as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty else {
            return nil
        }
        guard let components = URLComponents(string: raw),
              components.scheme?.lowercased() == "https",
              components.host?.isEmpty == false,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              let url = components.url else {
            throw HawcxV6BridgeError.invalidInput("magicLinkLandingUrl must be an https URL without query or fragment")
        }
        return url
    }
}

internal struct HawcxV6InitializeOptions {
    let relyingParty: String?
    let autoPollApprovals: Bool
    let magicLinkLandingURL: URL?

    static func from(config: NSDictionary) throws -> HawcxV6InitializeOptions {
        let relyingParty = (config["relyingParty"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty
        let autoPollApprovals = (config["autoPollApprovals"] as? NSNumber)?.boolValue ?? true
        return HawcxV6InitializeOptions(
            relyingParty: relyingParty,
            autoPollApprovals: autoPollApprovals,
            magicLinkLandingURL: try HawcxV6MagicLinkLanding.parse(config["magicLinkLandingUrl"])
        )
    }
}

internal final class HawcxV6Bridge {
    private weak var emitter: HawcxReactNative?
    private(set) var sdk: HawcxV1SDK?
    /// Approvals v2 approver over `sdk.approvals`; nil before `configure`.
    private(set) var approver: HawcxV6ApproverBridge?

    init(emitter: HawcxReactNative) {
        self.emitter = emitter
    }

    func configure(configId: String, baseURL: URL, options: HawcxV6InitializeOptions) {
        dispose(resetFlow: true)

        let sdk = HawcxV1SDK(
            configId: configId,
            baseURL: baseURL,
            relyingParty: options.relyingParty,
            autoPollApprovals: options.autoPollApprovals,
            magicLinkLandingURL: options.magicLinkLandingURL
        )

        sdk.flow.onUpdate = { [weak self, weak sdk] update in
            var hasSessionToken = false
            if case .completed = update {
                // The token stays native; JS only learns that one exists.
                hasSessionToken = sdk?.flow.sessionToken?.isEmpty == false
            }
            self?.emitter?.emitV6FlowEvent(HawcxV6FlowEventCodec.encode(update: update, hasSessionToken: hasSessionToken))
        }
        sdk.flow.onNotice = { [weak self] notice in
            self?.emitter?.emitV6FlowEvent(HawcxV6FlowEventCodec.encode(notice: notice))
        }

        self.sdk = sdk
        self.approver = HawcxV6ApproverBridge(sdk: sdk)
    }

    func start(options: HawcxV6StartOptions) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        if options.qrLogin {
            sdk.startQrLogin(codeChallenge: options.codeChallenge)
        } else if options.scope != nil || options.samlReqId != nil {
            sdk.start(
                flowType: options.flowType,
                identifier: options.identifier,
                startToken: options.startToken,
                inviteCode: options.inviteCode,
                codeChallenge: options.codeChallenge,
                scope: options.scope,
                samlReqId: options.samlReqId
            )
        } else {
            sdk.start(
                flowType: options.flowType,
                identifier: options.identifier,
                startToken: options.startToken,
                inviteCode: options.inviteCode,
                codeChallenge: options.codeChallenge
            )
        }
    }

    /// Re-emits the last method list without a request; false when none was shown.
    func backToMethodSelection() throws -> Bool {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        return sdk.flow.backToMethodSelection()
    }

    /// Deletes this device's V6 key record for `identifier` (Keychain,
    /// synchronous). True when a record was removed, false when none was
    /// stored. The legacy `clearUserKeychainData` never touches these records.
    func forgetDevice(identifier: String) throws -> Bool {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        return sdk.forgetDevice(identifier: identifier)
    }

    /// The last completed flow's session token (a secret; never logged here).
    func currentSessionToken() -> String? {
        return sdk?.flow.sessionToken
    }

    /// `explicit`, else the flow's token; `session_required` when neither exists.
    private func bearer(_ explicit: String?) -> Result<String, HawcxV1ApprovalError> {
        if let explicit, !explicit.isEmpty {
            return .success(explicit)
        }
        if let stored = sdk?.flow.sessionToken, !stored.isEmpty {
            return .success(stored)
        }
        return .failure(HawcxV1ApprovalError(
            code: "session_required",
            message: "Sign in first: no session token is available",
            status: nil,
            retryable: false
        ))
    }

    func listDevices(
        bearerToken: String?,
        completion: @escaping (Result<[[String: Any]], HawcxV1ApprovalError>) -> Void
    ) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        switch bearer(bearerToken) {
        case let .failure(error):
            completion(.failure(error))
        case let .success(token):
            sdk.account.listDevices(sessionToken: token) { result in
                completion(result.map { $0.map(HawcxV6DeviceCodec.encode) })
            }
        }
    }

    func revokeDevice(
        bearerToken: String?,
        deviceId: String,
        reason: String?,
        completion: @escaping (Result<Void, HawcxV1ApprovalError>) -> Void
    ) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        switch bearer(bearerToken) {
        case let .failure(error):
            completion(.failure(error))
        case let .success(token):
            sdk.account.revokeDevice(sessionToken: token, deviceId: deviceId, reason: reason, completion: completion)
        }
    }

    func logoutEverywhere(
        bearerToken: String?,
        completion: @escaping (Result<Int, HawcxV1ApprovalError>) -> Void
    ) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        switch bearer(bearerToken) {
        case let .failure(error):
            completion(.failure(error))
        case let .success(token):
            sdk.account.logoutEverywhere(sessionToken: token, completion: completion)
        }
    }

    private var redirectSession: HawcxV1OAuthRedirectSession?
    /// Settles the current launch's promise exactly once. Cancelling an
    /// ASWebAuthenticationSession never calls its completion, so a replaced or
    /// disposed launch is settled here with `redirect_cancelled`.
    private var settleRedirect: ((Result<Void, HawcxV1ApprovalError>) -> Void)?

    private func cancelPendingRedirect() {
        let settle = settleRedirect
        settleRedirect = nil
        redirectSession?.cancel()
        redirectSession = nil
        settle?(.failure(Self.redirectError("redirect_cancelled", "The sign-in window was replaced or closed")))
    }

    /// ASWebAuthenticationSession for a `redirect` step; the callback goes to
    /// the flow (`oauthCallback`) before `completion` succeeds. Main thread.
    func launchRedirect(
        url urlString: String,
        returnScheme: String?,
        anchor: @escaping () -> ASPresentationAnchor,
        completion: @escaping (Result<Void, HawcxV1ApprovalError>) -> Void
    ) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        guard let url = URL(string: urlString), let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http" else {
            completion(.failure(Self.redirectError("invalid_url", "url must be an http(s) URL")))
            return
        }
        guard let returnScheme, !returnScheme.isEmpty else {
            completion(.failure(Self.redirectError("invalid_callback", "returnScheme is required on iOS")))
            return
        }
        cancelPendingRedirect()
        var settled = false
        let settleOnce: (Result<Void, HawcxV1ApprovalError>) -> Void = { result in
            guard !settled else { return }
            settled = true
            completion(result)
        }
        let session = HawcxV1OAuthRedirectSession(presentationAnchorProvider: anchor)
        redirectSession = session
        settleRedirect = settleOnce
        session.start(url: url, callbackScheme: returnScheme) { [weak self, weak sdk, weak session] result in
            DispatchQueue.main.async {
                // Only the current launch clears the slot; a replaced one was
                // already settled with redirect_cancelled.
                if let self, self.redirectSession === session {
                    self.redirectSession = nil
                    self.settleRedirect = nil
                }
                let completion = settleOnce
                switch result {
                case let .success(callbackURL):
                    guard let callback = HawcxV1OAuthCallbackParser.parse(callbackURL), let sdk else {
                        completion(.failure(Self.redirectError("invalid_callback", "The callback URL has no code and state")))
                        return
                    }
                    sdk.flow.oauthCallback(code: callback.code, state: callback.state)
                    completion(.success(()))
                case .failure(.cancelled):
                    completion(.failure(Self.redirectError("redirect_cancelled", "The sign-in window was closed")))
                case .failure(.invalidCallback):
                    completion(.failure(Self.redirectError("invalid_callback", "The callback URL was not received")))
                case let .failure(.failed(message)):
                    completion(.failure(Self.redirectError("redirect_failed", message)))
                default:
                    completion(.failure(Self.redirectError("redirect_failed", "The sign-in window failed")))
                }
            }
        }
    }

    private static func redirectError(_ code: String, _ message: String) -> HawcxV1ApprovalError {
        HawcxV1ApprovalError(code: code, message: message, status: nil, retryable: false)
    }

    func selectMethod(_ methodId: String) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        sdk.flow.selectMethod(methodId)
    }

    func submitCode(_ code: String) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        sdk.flow.submitCode(code)
    }

    func submitTotp(_ code: String) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        sdk.flow.submitTotp(code)
    }

    func submitPhone(_ phone: String) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        sdk.flow.submitPhone(phone)
    }

    @discardableResult
    func resend() throws -> Bool {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        return sdk.flow.resend()
    }

    func poll() throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        sdk.flow.poll()
    }

    /// Thread-safe in the SDK (hops to the controller's state queue).
    func pausePolling() {
        sdk?.flow.pausePolling()
    }

    func resumePolling() {
        sdk?.flow.resumePolling()
    }

    func cancel() throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        sdk.flow.cancel()
    }

    /// A v1 (6.0.x) QR approval through `HawcxV1SDK.approvals.approveV1`.
    func approveQr(
        rawPayload: String,
        identifier: String,
        rememberDevice: Bool,
        completion: @escaping (Result<HawcxV6QrApprovalResult, HawcxV1QrApprovalError>) -> Void
    ) throws {
        guard let approver else {
            throw HawcxV6BridgeError.notInitialized
        }
        let trimmedIdentifier = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedIdentifier.isEmpty else {
            throw HawcxV6BridgeError.invalidInput("identifier is required")
        }
        try approver.approveV1(
            rawPayload: rawPayload,
            identifier: trimmedIdentifier,
            rememberDevice: rememberDevice,
            completion: completion
        )
    }

    func handleRedirect(urlString: String) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        guard let url = URL(string: urlString),
              let callback = HawcxV1OAuthCallbackParser.parse(url) else {
            throw HawcxV6BridgeError.invalidInput("url must be a valid V6 OAuth callback URL")
        }
        sdk.flow.oauthCallback(code: callback.code, state: callback.state)
    }

    /// Resolves `{outcome, code?, message?, retryable?}` on the main queue.
    func completeMagicLinkRedirect(
        urlString: String,
        completion: @escaping ([String: Any]) -> Void
    ) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        guard let url = URL(string: urlString) else {
            completion(["outcome": "not_magic_link"])
            return
        }
        sdk.completeMagicLinkRedirect(url) { outcome in
            completion(HawcxV6MagicLinkOutcomeCodec.encode(outcome))
        }
    }

    func dispose(resetFlow: Bool) {
        cancelPendingRedirect()
        approver?.dispose()
        approver = nil
        guard let sdk else { return }
        sdk.flow.onUpdate = nil
        sdk.flow.onNotice = nil
        if resetFlow {
            sdk.reset()
        }
        self.sdk = nil
    }
}

internal enum HawcxV6QrApprovalResult {
    case approved(payloadType: String)
    case bound(payloadType: String, userId: String?)
}

internal enum HawcxV6MagicLinkOutcomeCodec {
    static func encode(_ outcome: HawcxV1MagicLinkRedirectOutcome) -> [String: Any] {
        switch outcome {
        case .notMagicLink:
            return ["outcome": "not_magic_link"]
        case .resumed:
            return ["outcome": "resumed"]
        case .handedOff:
            return ["outcome": "handed_off"]
        case let .failed(code, message, retryable):
            return [
                "outcome": "failed",
                "code": code,
                "message": message,
                "retryable": retryable
            ]
        @unknown default:
            return [
                "outcome": "failed",
                "code": "unknown_outcome",
                "message": "Unsupported magic-link outcome",
                "retryable": false
            ]
        }
    }
}

/// `HawcxV1DeviceSummary` -> JS `HawcxV6DeviceSummary`.
internal enum HawcxV6DeviceCodec {
    static func encode(_ device: HawcxV1DeviceSummary) -> [String: Any] {
        var payload: [String: Any] = [
            "deviceId": device.deviceId,
            "h2index": device.h2index,
            "revoked": device.revoked
        ]
        if let createdAt = device.createdAt { payload["createdAt"] = createdAt }
        if let revokedAt = device.revokedAt { payload["revokedAt"] = revokedAt }
        if let info = device.deviceInfo { payload["deviceInfo"] = info.mapValues(json) }
        return payload
    }

    static func json(_ value: HawcxV1JSONValue) -> Any {
        switch value {
        case let .string(text): return text
        case let .number(number): return number
        case let .bool(flag): return flag
        case let .object(object): return object.mapValues(json)
        case let .array(items): return items.map(json)
        case .null: return NSNull()
        @unknown default: return NSNull()
        }
    }
}

internal enum HawcxV6FlowEventCodec {
    static func encode(notice: HawcxV1Notice) -> [String: Any] {
        return [
            "type": "notice",
            "payload": ["code": notice.code, "message": notice.message]
        ]
    }

    static func encode(update: HawcxV1FlowUpdate, hasSessionToken: Bool = false) -> [String: Any] {
        switch update {
        case .idle:
            return ["type": "idle"]
        case .loading(let session):
            var payload: [String: Any] = [:]
            if let session, !session.isEmpty {
                payload["session"] = session
            }
            return [
                "type": "loading",
                "payload": payload
            ]
        case .prompt(let context, let prompt):
            var payload = encodePromptContext(context)
            payload["prompt"] = encodePrompt(prompt, context: context)
            return [
                "type": "prompt",
                "payload": payload
            ]
        case .completed(let session, let authCode, let expiresAt, let codeVerifier, let meta):
            var payload: [String: Any] = [
                "session": session,
                "authCode": authCode,
                "expiresAt": expiresAt,
                "traceId": meta.traceId
            ]
            if let codeVerifier, !codeVerifier.isEmpty {
                payload["codeVerifier"] = codeVerifier
            }
            payload["hasSessionToken"] = hasSessionToken
            // Who signed in: the started identifier, or for a QR sign-in the
            // account the approving phone chose (absent when not named).
            if let identifier = update.identifier, !identifier.isEmpty {
                payload["identifier"] = identifier
            }
            return [
                "type": "completed",
                "payload": payload
            ]
        case .error(let session, let code, let action, let message, let retryable, let details, let meta):
            var payload: [String: Any] = [
                "code": code,
                "message": message,
                "retryable": retryable
            ]
            if let session, !session.isEmpty {
                payload["session"] = session
            }
            if let actionRawValue = actionRawValue(action) {
                payload["action"] = actionRawValue
            }
            if let traceId = meta?.traceId, !traceId.isEmpty {
                payload["traceId"] = traceId
            }
            if let details {
                payload["details"] = encodeErrorDetails(details)
            }
            return [
                "type": "error",
                "payload": payload
            ]
        }
    }

    private static func encodePromptContext(_ context: HawcxV1PromptContext) -> [String: Any] {
        var payload: [String: Any] = [
            "session": context.session,
            "traceId": context.meta.traceId,
            "expiresAt": context.meta.expiresAt
        ]
        if let stepInfo = context.stepInfo {
            payload["step"] = encodeStepInfo(stepInfo)
        }
        if let risk = context.risk {
            payload["risk"] = encodeRiskInfo(risk)
        }
        if let codeChannel = context.codeChannel, !codeChannel.isEmpty {
            payload["codeChannel"] = codeChannel
        }
        if let pollPath = context.pollPath, !pollPath.isEmpty {
            payload["pollPath"] = pollPath
        }
        if let notice = context.notice {
            payload["notice"] = ["code": notice.code, "message": notice.message]
        }
        return payload
    }

    /// Magic-link code screen poll interval (seconds). HawcxFramework 6.1.0 carries
    /// it on the prompt context so `HawcxV1UserPrompt.enterCode` stays unchanged.
    private static func enterCodePollInterval(_ context: HawcxV1PromptContext) -> Int? {
        context.pollInterval
    }

    private static func encodePrompt(_ prompt: HawcxV1UserPrompt, context: HawcxV1PromptContext) -> [String: Any] {
        switch prompt {
        case let .selectMethod(methods, phase):
            var payload: [String: Any] = [
                "type": "select_method",
                "methods": methods.map(encodeMethod)
            ]
            if let phase, !phase.isEmpty {
                payload["phase"] = phase
            }
            return payload
        case let .enterCode(destination, codeLength, codeFormat, codeExpiresAt, resendAt):
            var payload: [String: Any] = [
                "type": "enter_code",
                "destination": destination
            ]
            if let codeLength {
                payload["codeLength"] = codeLength
            }
            if let codeFormat, !codeFormat.isEmpty {
                payload["codeFormat"] = codeFormat
            }
            if let codeExpiresAt, !codeExpiresAt.isEmpty {
                payload["codeExpiresAt"] = codeExpiresAt
            }
            if let resendAt, !resendAt.isEmpty {
                payload["resendAt"] = resendAt
            }
            if let pollInterval = enterCodePollInterval(context) {
                payload["pollInterval"] = pollInterval
            }
            return payload
        case .enterTotp:
            return ["type": "enter_totp"]
        case let .setupTotp(secret, otpauthUrl, period):
            var payload: [String: Any] = [
                "type": "setup_totp",
                "secret": secret,
                "otpauthUrl": otpauthUrl
            ]
            if let period {
                payload["period"] = period
            }
            if let backupCodes = context.backupCodes, !backupCodes.isEmpty {
                payload["backupCodes"] = backupCodes
            }
            return payload
        case let .setupSms(existingPhone):
            var payload: [String: Any] = [
                "type": "setup_sms"
            ]
            if let existingPhone, !existingPhone.isEmpty {
                payload["existingPhone"] = existingPhone
            }
            return payload
        case let .redirect(url, returnScheme):
            var payload: [String: Any] = [
                "type": "redirect",
                "url": url
            ]
            if let returnScheme, !returnScheme.isEmpty {
                payload["returnScheme"] = returnScheme
            }
            return payload
        case let .awaitApproval(qrData, expiresAt, pollInterval):
            var payload: [String: Any] = [
                "type": "await_approval",
                "expiresAt": expiresAt,
                "pollInterval": pollInterval
            ]
            if let qrData, !qrData.isEmpty {
                payload["qrData"] = qrData
            }
            if let approval = context.approval {
                if let mode = approval.mode, !mode.isEmpty { payload["mode"] = mode }
                if let approvalId = approval.approvalId, !approvalId.isEmpty { payload["approvalId"] = approvalId }
                if let number = approval.number { payload["number"] = number }
                // QR mode only; the SDK keeps it only when it is 8 ASCII digits.
                if let manualCode = approval.manualCode, !manualCode.isEmpty { payload["manualCode"] = manualCode }
            }
            return payload
        case let .locked(retryAfterSeconds, lockedUntil):
            return [
                "type": "locked",
                "retryAfterSeconds": retryAfterSeconds,
                "lockedUntil": lockedUntil
            ]
        @unknown default:
            return encodeUnknownPrompt(prompt)
        }
    }

    /// A prompt this bridge doesn't map yet: `{type: "unknown", rawType}` where
    /// `rawType` is the case name (`String(describing:)` up to the first `(`;
    /// the framework's descriptions redact associated values).
    private static func encodeUnknownPrompt(_ prompt: HawcxV1UserPrompt) -> [String: Any] {
        let caseName = String(describing: prompt).split(separator: "(").first.map(String.init) ?? ""
        var payload: [String: Any] = ["type": "unknown"]
        if !caseName.isEmpty {
            payload["rawType"] = caseName
        }
        return payload
    }

    private static func encodeMethod(_ method: HawcxV1Method) -> [String: Any] {
        var payload: [String: Any] = [
            "id": method.id,
            "label": method.label
        ]
        if let icon = method.icon, !icon.isEmpty {
            payload["icon"] = icon
        }
        return payload
    }

    private static func encodeStepInfo(_ step: HawcxV1StepInfo) -> [String: Any] {
        var payload: [String: Any] = ["id": step.id]
        if let label = step.label, !label.isEmpty {
            payload["label"] = label
        }
        return payload
    }

    private static func encodeRiskInfo(_ risk: HawcxV1RiskInfo) -> [String: Any] {
        var payload: [String: Any] = [
            "detected": risk.detected,
            "reasons": risk.reasons
        ]
        if let message = risk.message, !message.isEmpty {
            payload["message"] = message
        }
        if let riskScore = risk.riskScore {
            payload["riskScore"] = riskScore
        }
        if let location = risk.location {
            payload["location"] = encodeRiskLocation(location)
        }
        return payload
    }

    private static func encodeRiskLocation(_ location: HawcxV1RiskLocation) -> [String: Any] {
        var payload: [String: Any] = [:]
        if let city = location.city, !city.isEmpty {
            payload["city"] = city
        }
        if let country = location.country, !country.isEmpty {
            payload["country"] = country
        }
        return payload
    }

    private static func encodeErrorDetails(_ details: HawcxV1ErrorDetails) -> [String: Any] {
        var payload: [String: Any] = [:]
        if let retryAfterSeconds = details.retryAfterSeconds {
            payload["retryAfterSeconds"] = retryAfterSeconds
        }
        if let retryAt = details.retryAt, !retryAt.isEmpty {
            payload["retryAt"] = retryAt
        }
        if let attemptsRemaining = details.attemptsRemaining {
            payload["attemptsRemaining"] = attemptsRemaining
        }
        if let errors = details.errors, !errors.isEmpty {
            payload["errors"] = errors.map { ["field": $0.field, "message": $0.message] }
        }
        if let outcome = details.outcome, !outcome.isEmpty {
            payload["outcome"] = outcome
        }
        if let decidedByThisDevice = details.decidedByThisDevice {
            payload["decidedByThisDevice"] = decidedByThisDevice
        }
        return payload
    }

    private static func actionRawValue(_ action: HawcxV1ErrorAction?) -> String? {
        guard let action else { return nil }
        switch action {
        case .retryInput:
            return "retry_input"
        case .restartFlow:
            return "restart_flow"
        case .wait:
            return "wait"
        case .retryRequest:
            return "retry_request"
        case .abort:
            return "abort"
        case .resendCode:
            return "resend_code"
        case .selectMethod:
            return "select_method"
        case .unknown(let raw):
            return raw
        }
    }
}

internal enum HawcxV6BridgeError: LocalizedError {
    case notInitialized
    case invalidInput(String)

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "initialize must be called before using V6 bridge methods"
        case let .invalidInput(message):
            return message
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

#endif
