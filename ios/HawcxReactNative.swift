import Foundation
import HawcxFramework

#if canImport(React)
import React

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
            self.hawcxSDK = HawcxSDK(projectApiKey: projectApiKey, baseURL: baseUrl, oauthConfig: oauthConfig)
            self.authCallbackProxy = AuthCallbackProxy(emitter: self)
            self.sessionCallbackProxy = SessionCallbackProxy(emitter: self)
            let pushDelegate = PushDelegateProxy(emitter: self)
            self.pushDelegateProxy = pushDelegate
            self.hawcxSDK?.pushAuthDelegate = pushDelegate
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
