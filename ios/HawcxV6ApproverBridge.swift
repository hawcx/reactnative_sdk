import Foundation
import HawcxFramework

#if canImport(React)

/// Approver (approvals v2) bridge over `HawcxV1SDK.approvals`.
///
/// A fetched `HawcxV1ApprovalRequest` (it holds the approval's token) stays in
/// `cache`; JavaScript only gets an opaque `handle`. Entries leave the cache at
/// the approval's expiry, after a final decision, on `discard`, or on
/// `dispose`. Tokens, signatures and device keys never cross the bridge and
/// nothing here logs. Main thread only (the SDK calls back on the main queue).
internal final class HawcxV6ApproverBridge {
    private let sdk: HawcxV1SDK
    private var cache: [String: HawcxV1ApprovalRequest] = [:]

    init(sdk: HawcxV1SDK) {
        self.sdk = sdk
    }

    func dispose() {
        disposed = true
        cache.removeAll()
    }

    /// Set by `dispose()`: a fetch finishing afterwards must not cache into
    /// this (dead) bridge, where no later decide could find it.
    private var disposed = false

    // MARK: - Push tokens

    func registerPushToken(
        _ input: NSDictionary,
        force: Bool,
        completion: @escaping (Result<[String: Any], HawcxV1ApprovalError>) -> Void
    ) {
        guard (input["provider"] as? String) == "apns",
              let token = (input["token"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !token.isEmpty,
              let apnsEnv = input["apnsEnv"] as? String else {
            completion(.failure(Self.localError("invalid_registration", "iOS registers APNs tokens: provider apns, a hex token and apnsEnv")))
            return
        }
        let appId = (input["appId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let registration = HawcxV1PushRegistration(
            appId: (appId?.isEmpty == false ? appId : nil) ?? Bundle.main.bundleIdentifier ?? "",
            apnsEnv: apnsEnv,
            token: token
        )
        sdk.approvals.registerPushTokenWithReport(registration, force: force) { result in
            completion(result.map { report in
                ["registered": report.registered, "orphanedIdentifiers": report.orphanedIdentifiers]
            })
        }
    }

    func unregisterPushToken(
        identifier: String?,
        appId: String?,
        completion: @escaping (Result<Void, HawcxV1ApprovalError>) -> Void
    ) {
        if let appId {
            guard let identifier else {
                completion(.failure(Self.localError("invalid_registration", "identifier is required with appId")))
                return
            }
            sdk.approvals.unregisterPushToken(identifier: identifier, appId: appId, completion: completion)
        } else {
            sdk.approvals.unregisterPushToken(identifier: identifier, completion: completion)
        }
    }

    // MARK: - References

    func approvalReference(fromPush payload: NSDictionary) -> [String: Any]? {
        var userInfo: [AnyHashable: Any] = [:]
        payload.forEach { key, value in
            if let key = key as? String { userInfo[key] = value }
        }
        return sdk.approvals.approvalReference(fromPush: userInfo).map(Self.encode(reference:))
    }

    func scan(_ raw: String) -> [String: Any]? {
        guard let scanned = sdk.approvals.scan(raw) else { return nil }
        switch scanned {
        case let .v2(reference):
            return ["version": 2, "reference": Self.encode(reference: reference)]
        case let .v1(payload):
            return ["version": 1, "payloadType": payload.type.rawValue]
        @unknown default:
            return nil
        }
    }

    // MARK: - Context and decisions

    func fetchContext(
        reference raw: NSDictionary,
        identifier: String?,
        completion: @escaping (Result<[String: Any], HawcxV1ApprovalError>) -> Void
    ) {
        guard let reference = Self.decode(reference: raw) else {
            completion(.failure(Self.localError("invalid_reference", "reference needs kind, projectId and approvalId")))
            return
        }
        sdk.approvals.fetchContext(reference, identifier: identifier) { [weak self] result in
            // Always settle: a bridge torn down mid-fetch (re-initialize,
            // teardown) answers approval_handle_unknown instead of hanging.
            guard let self, !self.disposed else {
                if case let .failure(error) = result {
                    completion(.failure(error))
                } else {
                    completion(.failure(Self.localError(
                        "approval_handle_unknown",
                        "The approver was reset while fetching; fetch the approval again"
                    )))
                }
                return
            }
            switch result {
            case let .success(request):
                self.pruneExpired()
                let handle = UUID().uuidString
                self.cache[handle] = request
                let delay = max(0, request.expiresAt.timeIntervalSinceNow) + 1
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    self?.cache[handle] = nil
                }
                completion(.success(Self.encode(request: request, handle: handle)))
            case let .failure(error):
                completion(.failure(error))
            }
        }
    }

    func decide(
        handle: String,
        decision rawDecision: String,
        numberChoice: Int?,
        rememberDevice: Bool,
        completion: @escaping (Result<[String: Any], HawcxV1ApprovalError>) -> Void
    ) {
        guard let decision = HawcxV1ApprovalDecision(rawValue: rawDecision) else {
            completion(.failure(Self.localError("invalid_decision", "decision must be approve or deny")))
            return
        }
        guard let request = cache[handle] else {
            completion(.failure(Self.localError("approval_handle_unknown", "This request is no longer available")))
            return
        }
        if request.isExpired {
            cache[handle] = nil
            completion(.failure(Self.localError(HawcxV1ErrorCode.approvalExpired, "This request has expired")))
            return
        }
        sdk.approvals.decide(request, decision, numberChoice: numberChoice, rememberDevice: rememberDevice) { [weak self] result in
            switch result {
            case let .success(outcome):
                // Final: the approval is over either way.
                self?.cache[handle] = nil
                completion(.success(Self.encode(result: outcome)))
            case let .failure(error):
                if error.code == HawcxV1ErrorCode.approvalExpired {
                    self?.cache[handle] = nil
                }
                completion(.failure(error))
            }
        }
    }

    func discard(handle: String) {
        cache[handle] = nil
    }

    func enrolledIdentifiers() -> [String] {
        return sdk.crypto.enrolledIdentifiers()
    }

    // MARK: - v1 QR

    /// A 6.0.x QR through `approvals.approveV1` (never clears keys on a server
    /// answer; `project_mismatch`; `approval_outcome_unknown` after a lost send).
    func approveV1(
        rawPayload: String,
        identifier: String,
        rememberDevice: Bool,
        completion: @escaping (Result<HawcxV6QrApprovalResult, HawcxV1QrApprovalError>) -> Void
    ) throws {
        guard let scanned = sdk.approvals.scan(rawPayload), case let .v1(payload) = scanned else {
            throw HawcxV6BridgeError.invalidInput("rawPayload must be a v1 Hawcx QR payload (use fetchApprovalContext for approvals v2)")
        }
        sdk.approvals.approveV1(payload, identifier: identifier, rememberDevice: rememberDevice) { result in
            switch result {
            case .success(.approved):
                completion(.success(.approved(payloadType: payload.type.rawValue)))
            case let .success(.bound(userid)):
                completion(.success(.bound(payloadType: payload.type.rawValue, userId: userid)))
            case let .failure(error):
                completion(.failure(error))
            default:
                completion(.failure(HawcxV1QrApprovalError(
                    code: "unknown_outcome",
                    message: "Unsupported QR approval outcome",
                    retryable: false,
                    shouldClearRecord: false,
                    retryAfterSeconds: nil
                )))
            }
        }
    }

    // MARK: - Codec

    private func pruneExpired() {
        cache = cache.filter { !$0.value.isExpired }
    }

    private static let isoWithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    /// `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`, as the Android bridge formats it.
    static func iso(_ date: Date) -> String {
        return isoWithFraction.string(from: date)
    }

    static func encode(reference: HawcxV1ApprovalReference) -> [String: Any] {
        var payload: [String: Any] = [
            "kind": reference.kind.rawValue,
            "projectId": reference.projectId,
            "approvalId": reference.approvalId
        ]
        if let expiresAt = reference.expiresAt {
            payload["expiresAt"] = iso(expiresAt)
        }
        return payload
    }

    static func decode(reference raw: NSDictionary) -> HawcxV1ApprovalReference? {
        guard let kindRaw = raw["kind"] as? String,
              let kind = HawcxV1ApprovalKind(rawValue: kindRaw),
              let projectId = raw["projectId"] as? String, !projectId.isEmpty,
              let approvalId = raw["approvalId"] as? String, !approvalId.isEmpty else {
            return nil
        }
        var expiresAt: Date?
        if let text = raw["expiresAt"] as? String, !text.isEmpty {
            guard let parsed = isoWithFraction.date(from: text) ?? isoPlain.date(from: text) else {
                return nil
            }
            expiresAt = parsed
        }
        return HawcxV1ApprovalReference(kind: kind, projectId: projectId, approvalId: approvalId, expiresAt: expiresAt)
    }

    static func encode(request: HawcxV1ApprovalRequest, handle: String) -> [String: Any] {
        var requester: [String: Any] = ["requestedAt": request.requester.requestedAt]
        if let value = request.requester.appName { requester["appName"] = value }
        if let value = request.requester.origin { requester["origin"] = value }
        if let value = request.requester.browser { requester["browser"] = value }
        if let value = request.requester.ip { requester["ip"] = value }
        if let value = request.requester.location { requester["location"] = value }
        var payload: [String: Any] = [
            "handle": handle,
            "reference": encode(reference: request.reference),
            "identifier": request.identifier,
            "mode": request.mode,
            "requester": requester,
            "numberRequired": request.numberRequired,
            "expiresAt": iso(request.expiresAt)
        ]
        if let mismatch = request.locationMismatch {
            payload["locationMismatch"] = mismatch
        }
        return payload
    }

    static func encode(result: HawcxV1ApprovalResult) -> [String: Any] {
        switch result {
        case .approved:
            return ["outcome": "approved"]
        case .denied:
            return ["outcome": "denied"]
        case .wrongNumber:
            return ["outcome": "wrong_number"]
        case let .resolved(outcome, decidedByThisDevice):
            return ["outcome": "resolved", "resolvedOutcome": outcome, "decidedByThisDevice": decidedByThisDevice]
        @unknown default:
            return ["outcome": "resolved", "resolvedOutcome": "unknown", "decidedByThisDevice": false]
        }
    }

    static func localError(_ code: String, _ message: String) -> HawcxV1ApprovalError {
        return HawcxV1ApprovalError(code: code, message: message, status: nil, retryable: false)
    }
}

#endif
