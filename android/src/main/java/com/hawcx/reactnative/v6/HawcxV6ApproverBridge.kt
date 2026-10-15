package com.hawcx.reactnative.v6

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.hawcx.protocol.v1.HawcxV1ApprovalDecision
import com.hawcx.protocol.v1.HawcxV1ApprovalError
import com.hawcx.protocol.v1.HawcxV1ApprovalKind
import com.hawcx.protocol.v1.HawcxV1ApprovalReference
import com.hawcx.protocol.v1.HawcxV1ApprovalRequest
import com.hawcx.protocol.v1.HawcxV1ApprovalResult
import com.hawcx.protocol.v1.HawcxV1ApprovalService
import com.hawcx.protocol.v1.HawcxV1ApprovalSigning
import com.hawcx.protocol.v1.HawcxV1DeviceCryptoError
import com.hawcx.protocol.v1.HawcxV1ErrorCodes
import com.hawcx.protocol.v1.HawcxV1PushRegistration
import com.hawcx.protocol.v1.HawcxV1QrApprovalError
import com.hawcx.protocol.v1.HawcxV1QrApprovalOutcome
import com.hawcx.protocol.v1.HawcxV1ScannedApproval
import com.hawcx.protocol.v1.HawcxV1SDK
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Approver (approvals v2) bridge over [HawcxV1SDK.approvals].
 *
 * A fetched [HawcxV1ApprovalRequest] (it holds the approval's token) stays in
 * [cache]; JavaScript only gets an opaque `handle`. Entries leave the cache at
 * the approval's expiry, after a final decision, on [discard], or on [dispose].
 * Tokens, signatures and device keys never cross the bridge and nothing here
 * logs. Completions run on the SDK's worker threads.
 */
internal class HawcxV6ApproverBridge(
    private val sdk: HawcxV1SDK,
    /** Default `app_id` for FCM registration (the application id). */
    private val defaultAppId: String
) {
    private val cache = ConcurrentHashMap<String, HawcxV1ApprovalRequest>()

    private val approvals: HawcxV1ApprovalService
        get() = sdk.approvals ?: throw HawcxV1ApprovalError(
            code = "approvals_unavailable",
            message = "Approvals need the device-key signer; initialize the SDK first",
            status = null,
            retryable = false
        )

    /** Removes each cached request at its expiry (+1 s), like iOS. */
    private val evictor = Handler(Looper.getMainLooper())

    /** Set by [dispose]: a fetch finishing afterwards must not cache into this bridge. */
    @Volatile
    private var disposed = false

    fun dispose() {
        disposed = true
        evictor.removeCallbacksAndMessages(null)
        cache.clear()
    }

    // MARK: - Push tokens

    fun registerPushToken(input: ReadableMap, force: Boolean, completion: (Result<WritableMap>) -> Unit) {
        val token = input.optString("token")
        if (input.optString("provider") != "fcm" || token == null) {
            completion(Result.failure(localError("invalid_registration", "Android registers FCM tokens: provider fcm and a token")))
            return
        }
        val registration = HawcxV1PushRegistration.fcm(token, input.optString("appId") ?: defaultAppId)
        approvals.registerPushTokenWithReport(registration, force) { result ->
            completion(result.map { report ->
                Arguments.createMap().apply {
                    putInt("registered", report.registered)
                    putArray("orphanedIdentifiers", Arguments.createArray().apply {
                        report.orphanedIdentifiers.forEach { pushString(it) }
                    })
                }
            })
        }
    }

    fun unregisterPushToken(identifier: String?, appId: String?, completion: (Result<Unit>) -> Unit) {
        if (appId != null) {
            if (identifier == null) {
                completion(Result.failure(localError("invalid_registration", "identifier is required with appId")))
                return
            }
            approvals.unregisterPushToken(identifier, appId, completion)
        } else {
            approvals.unregisterPushToken(identifier, completion)
        }
    }

    // MARK: - References

    /** FCM data is `Map<String, String>`: nested maps (an APNs-style object) become JSON strings. */
    fun approvalReferenceFromPush(payload: ReadableMap): WritableMap? {
        val data = HashMap<String, String>()
        val iterator = payload.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            when (payload.getType(key)) {
                ReadableType.String -> payload.getString(key)?.let { data[key] = it }
                ReadableType.Map -> payload.getMap(key)?.let { data[key] = JSONObject(toJsonValue(it.toHashMap()) as Map<*, *>).toString() }
                ReadableType.Number -> data[key] = payload.getDouble(key).toString()
                ReadableType.Boolean -> data[key] = payload.getBoolean(key).toString()
                else -> Unit
            }
        }
        return approvals.approvalReference(data)?.let(::encodeReference)
    }

    fun scan(raw: String): WritableMap? {
        return when (val scanned = approvals.scan(raw)) {
            is HawcxV1ScannedApproval.V2 -> Arguments.createMap().apply {
                putInt("version", 2)
                putMap("reference", encodeReference(scanned.reference))
            }
            is HawcxV1ScannedApproval.V1 -> Arguments.createMap().apply {
                putInt("version", 1)
                putString("payloadType", scanned.payload.type.wireValue)
            }
            null -> null
        }
    }

    // MARK: - Context and decisions

    fun fetchContext(raw: ReadableMap, identifier: String?, completion: (Result<WritableMap>) -> Unit) {
        val reference = decodeReference(raw) ?: run {
            completion(Result.failure(localError("invalid_reference", "reference needs kind, projectId and approvalId")))
            return
        }
        approvals.fetchContext(reference, identifier) { result ->
            if (disposed && result.isSuccess) {
                completion(Result.failure(localError(
                    "approval_handle_unknown",
                    "The approver was reset while fetching; fetch the approval again"
                )))
            } else completion(result.map { request ->
                pruneExpired()
                val handle = UUID.randomUUID().toString()
                cache[handle] = request
                val delay = (request.expiresAtMillis - System.currentTimeMillis()).coerceAtLeast(0L) + 1_000L
                evictor.postDelayed({ cache.remove(handle) }, delay)
                encodeRequest(request, handle)
            })
        }
    }

    fun decide(
        handle: String,
        rawDecision: String,
        numberChoice: Int?,
        rememberDevice: Boolean,
        completion: (Result<WritableMap>) -> Unit
    ) {
        val decision = HawcxV1ApprovalDecision.values().firstOrNull { it.wireValue == rawDecision } ?: run {
            completion(Result.failure(localError("invalid_decision", "decision must be approve or deny")))
            return
        }
        pruneExpired(keep = handle)
        val request = cache[handle] ?: run {
            completion(Result.failure(localError("approval_handle_unknown", "This request is no longer available")))
            return
        }
        if (request.isExpired) {
            cache.remove(handle)
            completion(Result.failure(localError(HawcxV1ErrorCodes.APPROVAL_EXPIRED, "This request has expired")))
            return
        }
        approvals.decide(request, decision, numberChoice, rememberDevice) { result ->
            result.onSuccess {
                // Final: the approval is over either way.
                cache.remove(handle)
            }.onFailure { error ->
                if ((error as? HawcxV1ApprovalError)?.code == HawcxV1ErrorCodes.APPROVAL_EXPIRED) {
                    cache.remove(handle)
                }
            }
            completion(result.map(::encodeResult))
        }
    }

    fun discard(handle: String) {
        cache.remove(handle)
        pruneExpired()
    }

    /** Most recently used first; `keychain_unavailable` (retryable) when the keys can't be read right now. */
    fun enrolledIdentifiers(): Result<List<String>> {
        val signer = sdk.crypto as? HawcxV1ApprovalSigning ?: return Result.success(emptyList())
        return try {
            Result.success(signer.enrolledIdentifiers())
        } catch (error: HawcxV1DeviceCryptoError) {
            Result.failure(
                HawcxV1ApprovalError(
                    code = error.code,
                    message = error.message,
                    status = null,
                    retryable = error.code == HawcxV1ErrorCodes.KEYCHAIN_UNAVAILABLE
                )
            )
        }
    }

    // MARK: - v1 QR

    /**
     * A 6.0.x QR through `approvals.approveV1` (never clears keys on a server
     * answer; `project_mismatch`; `approval_outcome_unknown` after a lost send).
     */
    fun approveV1(
        rawPayload: String,
        identifier: String,
        rememberDevice: Boolean,
        completion: (Result<HawcxV6QrApprovalResult>) -> Unit
    ) {
        val payload = (approvals.scan(rawPayload) as? HawcxV1ScannedApproval.V1)?.payload ?: run {
            completion(Result.failure(IllegalArgumentException("rawPayload must be a v1 Hawcx QR payload (use fetchApprovalContext for approvals v2)")))
            return
        }
        approvals.approveV1(payload, identifier, rememberDevice) { result ->
            completion(result.map { outcome ->
                when (outcome) {
                    HawcxV1QrApprovalOutcome.Approved -> HawcxV6QrApprovalResult("approved", payload.type.wireValue)
                    is HawcxV1QrApprovalOutcome.Bound -> HawcxV6QrApprovalResult("bound", payload.type.wireValue, outcome.userid)
                }
            })
        }
    }

    /** Drops expired requests; [keep] stays so its caller can answer approval_expired. */
    private fun pruneExpired(keep: String? = null) {
        cache.entries.removeIf { it.key != keep && it.value.isExpired }
    }

    companion object {
        /** `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`, as the iOS bridge formats it. */
        private val ISO: DateTimeFormatter =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

        fun iso(millis: Long): String = ISO.format(Instant.ofEpochMilli(millis))

        fun parseIsoMillis(text: String): Long? =
            runCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()

        fun encodeReference(reference: HawcxV1ApprovalReference): WritableMap = Arguments.createMap().apply {
            putString("kind", reference.kind.wireValue)
            putString("projectId", reference.projectId)
            putString("approvalId", reference.approvalId)
            reference.expiresAtMillis?.let { putString("expiresAt", iso(it)) }
        }

        fun decodeReference(raw: ReadableMap): HawcxV1ApprovalReference? {
            val kind = HawcxV1ApprovalKind.fromWire(raw.optString("kind")) ?: return null
            val projectId = raw.optString("projectId") ?: return null
            val approvalId = raw.optString("approvalId") ?: return null
            val expiresAt = raw.optString("expiresAt")?.let { parseIsoMillis(it) ?: return null }
            return HawcxV1ApprovalReference(kind, projectId, approvalId, expiresAt)
        }

        fun encodeRequest(request: HawcxV1ApprovalRequest, handle: String): WritableMap = Arguments.createMap().apply {
            putString("handle", handle)
            putMap("reference", encodeReference(request.reference))
            putString("identifier", request.identifier)
            putString("mode", request.mode)
            putMap("requester", Arguments.createMap().apply {
                putString("requestedAt", request.requester.requestedAt)
                request.requester.appName?.let { putString("appName", it) }
                request.requester.origin?.let { putString("origin", it) }
                request.requester.browser?.let { putString("browser", it) }
                request.requester.ip?.let { putString("ip", it) }
                request.requester.location?.let { putString("location", it) }
            })
            putBoolean("numberRequired", request.numberRequired)
            putString("expiresAt", iso(request.expiresAtMillis))
            request.locationMismatch?.let { putBoolean("locationMismatch", it) }
        }

        fun encodeResult(result: HawcxV1ApprovalResult): WritableMap = Arguments.createMap().apply {
            when (result) {
                HawcxV1ApprovalResult.Approved -> putString("outcome", "approved")
                HawcxV1ApprovalResult.Denied -> putString("outcome", "denied")
                HawcxV1ApprovalResult.WrongNumber -> putString("outcome", "wrong_number")
                is HawcxV1ApprovalResult.Resolved -> {
                    putString("outcome", "resolved")
                    putString("resolvedOutcome", result.outcome)
                    putBoolean("decidedByThisDevice", result.decidedByThisDevice)
                }
            }
        }

        fun localError(code: String, message: String) =
            HawcxV1ApprovalError(code = code, message = message, status = null, retryable = false)

        /** v1 QR errors: same userInfo keys as the iOS bridge. */
        fun qrUserInfo(error: HawcxV1QrApprovalError): WritableMap = Arguments.createMap().apply {
            putBoolean("retryable", error.retryable)
            error.retryAfterSeconds?.let { putInt("retryAfterSeconds", it) }
        }

        private fun toJsonValue(value: Any?): Any? = when (value) {
            is Map<*, *> -> value.entries.associate { (k, v) -> k.toString() to toJsonValue(v) }
            is List<*> -> JSONArray(value.map(::toJsonValue))
            // RN maps numbers to Double; keep integral values integral (`"v": 2`).
            is Double -> if (value % 1.0 == 0.0 && value in -1e15..1e15) value.toLong() else value
            else -> value
        }
    }
}

private fun ReadableMap.optString(key: String): String? {
    if (!hasKey(key) || isNull(key) || getType(key) != ReadableType.String) {
        return null
    }
    return getString(key)?.trim()?.takeUnless { it.isEmpty() }
}
