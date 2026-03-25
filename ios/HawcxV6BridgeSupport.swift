import Foundation
import HawcxFramework

#if canImport(React)

internal let HAWCX_V6_FLOW_EVENT_NAME = "hawcx.v6.flow.event"

internal struct HawcxV6StartOptions {
    let flowType: HawcxV1FlowType
    let identifier: String
    let startToken: String?
    let inviteCode: String?
    let codeChallenge: String?

    static func from(options: NSDictionary) throws -> HawcxV6StartOptions {
        let identifier = (options["identifier"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty
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
            codeChallenge: (options["codeChallenge"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty
        )
    }
}

internal struct HawcxV6InitializeOptions {
    let relyingParty: String?
    let autoPollApprovals: Bool

    static func from(config: NSDictionary) -> HawcxV6InitializeOptions {
        let relyingParty = (config["relyingParty"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty
        let autoPollApprovals = (config["autoPollApprovals"] as? NSNumber)?.boolValue ?? true
        return HawcxV6InitializeOptions(
            relyingParty: relyingParty,
            autoPollApprovals: autoPollApprovals
        )
    }
}

internal final class HawcxV6Bridge {
    private weak var emitter: HawcxReactNative?
    private(set) var sdk: HawcxV1SDK?

    init(emitter: HawcxReactNative) {
        self.emitter = emitter
    }

    func configure(configId: String, baseURL: URL, options: HawcxV6InitializeOptions) {
        dispose(resetFlow: true)

        let sdk = HawcxV1SDK(
            configId: configId,
            baseURL: baseURL,
            relyingParty: options.relyingParty,
            autoPollApprovals: options.autoPollApprovals
        )

        sdk.flow.onUpdate = { [weak self] update in
            self?.emitter?.emitV6FlowEvent(HawcxV6FlowEventCodec.encode(update: update))
        }

        self.sdk = sdk
    }

    func start(options: HawcxV6StartOptions) throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        sdk.start(
            flowType: options.flowType,
            identifier: options.identifier,
            startToken: options.startToken,
            inviteCode: options.inviteCode,
            codeChallenge: options.codeChallenge
        )
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

    func cancel() throws {
        guard let sdk else {
            throw HawcxV6BridgeError.notInitialized
        }
        sdk.flow.cancel()
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

    func dispose(resetFlow: Bool) {
        guard let sdk else { return }
        sdk.flow.onUpdate = nil
        if resetFlow {
            sdk.reset()
        }
        self.sdk = nil
    }
}

internal enum HawcxV6FlowEventCodec {
    static func encode(update: HawcxV1FlowUpdate) -> [String: Any] {
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
            payload["prompt"] = encodePrompt(prompt)
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
        return payload
    }

    private static func encodePrompt(_ prompt: HawcxV1UserPrompt) -> [String: Any] {
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
            return payload
        }
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
