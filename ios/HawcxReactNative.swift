import Foundation
import React
import HawcxFramework

@objc(HawcxReactNative)
class HawcxReactNative: RCTEventEmitter {
    private let authEventName = "hawcx.auth.event"
    private let sessionEventName = "hawcx.session.event"
    private let pushEventName = "hawcx.push.event"
    private var hawcxSDK: HawcxSDK?
    private var authCallbackProxy: AuthCallbackProxy?
    private var sessionCallbackProxy: SessionCallbackProxy?
    private var pushDelegateProxy: PushDelegateProxy?

    override static func requiresMainQueueSetup() -> Bool {
        true

        
    }

    override func supportedEvents() -> [String]! {
        [authEventName, sessionEventName, pushEventName]
    }

    @objc
    func initialize(_ config: NSDictionary,
                    resolver resolve: RCTPromiseResolveBlock,
                    rejecter reject: RCTPromiseRejectBlock) {
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

        DispatchQueue.main.async {
            self.hawcxSDK = HawcxSDK(projectApiKey: projectApiKey, oauthConfig: oauthConfig)
            self.authCallbackProxy = AuthCallbackProxy(emitter: self)
            self.sessionCallbackProxy = SessionCallbackProxy(emitter: self)
            let pushDelegate = PushDelegateProxy(emitter: self)
            self.pushDelegateProxy = pushDelegate
            self.hawcxSDK?.pushAuthDelegate = pushDelegate
            resolve(nil)
        }
    }

    @objc
    func authenticate(_ userId: NSString,
                      resolver resolve: RCTPromiseResolveBlock,
                      rejecter reject: RCTPromiseRejectBlock) {
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
                   resolver resolve: RCTPromiseResolveBlock,
                   rejecter reject: RCTPromiseRejectBlock) {
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
                  resolver resolve: RCTPromiseResolveBlock,
                  rejecter reject: RCTPromiseRejectBlock) {
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
                    resolver resolve: RCTPromiseResolveBlock,
                    rejecter reject: RCTPromiseRejectBlock) {
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

    fileprivate func emitAuthEvent(_ body: [String: Any]) {
        sendEvent(withName: authEventName, body: body)
    }

    fileprivate func emitSessionEvent(_ body: [String: Any]) {
        sendEvent(withName: sessionEventName, body: body)
    }

    fileprivate func emitPushEvent(_ body: [String: Any]) {
        sendEvent(withName: pushEventName, body: body)
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
        let payload: [String: Any] = [
            "requestId": requestId,
            "projectId": details.project_id ?? "",
            "relyingParty": details.relying_party ?? "",
            "location": details.location ?? "",
            "timestamp": details.timestamp ?? ""
        ]
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
