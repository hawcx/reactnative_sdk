import Foundation
import HawcxFramework

#if canImport(React)

internal let HAWCX_V6_FLOW_EVENT_NAME = "hawcx.v6.flow.event"

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
            return [
                "type": "loading",
                "payload": [
                    "session": session as Any
                ]
            ]
        case .prompt(let context, let prompt):
            return [
                "type": "prompt",
                "payload": [
                    "session": context.session,
                    "traceId": context.meta.traceId,
                    "expiresAt": context.meta.expiresAt,
                    "stepId": context.stepInfo?.id as Any,
                    "stepLabel": context.stepInfo?.label as Any,
                    "codeChannel": context.codeChannel as Any,
                    "promptType": promptType(prompt)
                ]
            ]
        case .completed(let session, let authCode, let expiresAt, let codeVerifier, let meta):
            return [
                "type": "completed",
                "payload": [
                    "session": session,
                    "authCode": authCode,
                    "expiresAt": expiresAt,
                    "codeVerifier": codeVerifier as Any,
                    "traceId": meta.traceId
                ]
            ]
        case .error(let session, let code, let action, let message, let retryable, _, let meta):
            return [
                "type": "error",
                "payload": [
                    "session": session as Any,
                    "code": code,
                    "action": actionRawValue(action) as Any,
                    "message": message,
                    "retryable": retryable,
                    "traceId": meta?.traceId as Any
                ]
            ]
        }
    }

    private static func promptType(_ prompt: HawcxV1UserPrompt) -> String {
        switch prompt {
        case .selectMethod:
            return "select_method"
        case .enterCode:
            return "enter_code"
        case .enterTotp:
            return "enter_totp"
        case .setupTotp:
            return "setup_totp"
        case .setupSms:
            return "setup_sms"
        case .redirect:
            return "redirect"
        case .awaitApproval:
            return "await_approval"
        }
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

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

#endif
