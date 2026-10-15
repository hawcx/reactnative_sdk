package com.hawcx.reactnative.v6

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.hawcx.internal.HawcxSDK
import com.hawcx.protocol.v1.HawcxV1ApprovalError
import com.hawcx.protocol.v1.HawcxV1QrApprovalError
import com.hawcx.protocol.v1.HawcxV1DeviceSummary
import com.hawcx.protocol.v1.HawcxV1ErrorDetails
import com.hawcx.protocol.v1.HawcxV1FieldError
import com.hawcx.protocol.v1.HawcxV1FlowUpdate
import com.hawcx.protocol.v1.HawcxV1FlowType
import com.hawcx.protocol.v1.HawcxV1MagicLinkRedirectOutcome
import com.hawcx.protocol.v1.HawcxV1Method
import com.hawcx.protocol.v1.HawcxV1OAuthCallbackParser
import com.hawcx.protocol.v1.HawcxV1PromptContext
import com.hawcx.protocol.v1.HawcxV1RedirectLaunchResult
import com.hawcx.protocol.v1.HawcxV1RiskInfo
import com.hawcx.protocol.v1.HawcxV1RiskLocation
import com.hawcx.protocol.v1.HawcxV1SDK
import com.hawcx.protocol.v1.HawcxV1StepInfo
import com.hawcx.protocol.v1.HawcxV1UserPrompt
import com.hawcx.reactnative.HawcxEventDispatcher
import com.hawcx.reactnative.HawcxReactNativeLogger

internal data class HawcxV6StartOptions(
    /** Empty for [qrLogin]. */
    val identifier: String,
    val flowType: HawcxV1FlowType = HawcxV1FlowType.SIGNIN,
    val startToken: String? = null,
    val inviteCode: String? = null,
    val codeChallenge: String? = null,
    val scope: String? = null,
    val samlReqId: String? = null,
    /** `method: "qr_login"`: anonymous QR sign-in (no identifier). */
    val qrLogin: Boolean = false
) {
    companion object {
        fun from(options: ReadableMap): HawcxV6StartOptions {
            val identifier = options.getOptionalString("identifier").orEmpty()
            val method = options.getOptionalString("method")
            if (method != null) {
                require(method == "qr_login") { "method must be qr_login when set" }
                require(identifier.isEmpty()) { "identifier must be omitted for qr_login" }
                return HawcxV6StartOptions(
                    identifier = "",
                    codeChallenge = options.getOptionalString("codeChallenge"),
                    qrLogin = true
                )
            }
            require(identifier.isNotEmpty()) { "identifier is required" }

            val flowType = when (options.getString("flowType")?.trim().orEmpty().ifBlank { "signin" }) {
                "signin" -> HawcxV1FlowType.SIGNIN
                "signup" -> HawcxV1FlowType.SIGNUP
                "account_manage" -> HawcxV1FlowType.ACCOUNT_MANAGE
                else -> throw IllegalArgumentException(
                    "flowType must be one of signin, signup, or account_manage"
                )
            }

            return HawcxV6StartOptions(
                identifier = identifier,
                flowType = flowType,
                startToken = options.getOptionalString("startToken"),
                inviteCode = options.getOptionalString("inviteCode"),
                codeChallenge = options.getOptionalString("codeChallenge"),
                scope = options.getOptionalString("scope"),
                samlReqId = options.getOptionalString("samlReqId")
            )
        }
    }
}

internal object HawcxV6MagicLinkLanding {
    /**
     * https with a host; no user info, query or fragment (the server matches
     * registered URLs exactly; the native SDK applies the same rule).
     */
    fun parse(value: String?): String? {
        val raw = value?.trim()?.takeUnless { it.isEmpty() } ?: return null
        val uri = runCatching { java.net.URI(raw) }.getOrNull()
        require(
            uri != null &&
                uri.scheme.equals("https", ignoreCase = true) &&
                !uri.host.isNullOrEmpty() &&
                uri.rawUserInfo == null &&
                uri.rawQuery == null &&
                uri.rawFragment == null
        ) { "magicLinkLandingUrl must be an https URL without query or fragment" }
        return raw
    }
}

internal data class HawcxV6InitializeOptions(
    val relyingParty: String? = null,
    val autoPollApprovals: Boolean = true,
    val magicLinkLandingUrl: String? = null
) {
    companion object {
        fun from(config: ReadableMap): HawcxV6InitializeOptions {
            val relyingParty = if (config.hasKey("relyingParty") && !config.isNull("relyingParty")) {
                config.getString("relyingParty")?.trim().takeUnless { it.isNullOrEmpty() }
            } else {
                null
            }
            val autoPollApprovals = if (config.hasKey("autoPollApprovals") && !config.isNull("autoPollApprovals")) {
                config.getBoolean("autoPollApprovals")
            } else {
                true
            }
            val magicLinkLandingUrl = HawcxV6MagicLinkLanding.parse(
                config.getOptionalString("magicLinkLandingUrl")
            )
            return HawcxV6InitializeOptions(
                relyingParty = relyingParty,
                autoPollApprovals = autoPollApprovals,
                magicLinkLandingUrl = magicLinkLandingUrl
            )
        }
    }
}

internal class HawcxV6Bridge(
    private val eventDispatcher: HawcxEventDispatcher
) {
    private var sdk: HawcxV1SDK? = null

    /** Approvals v2 approver over `sdk.approvals`; null before [configure]. */
    @Volatile
    var approver: HawcxV6ApproverBridge? = null
        private set

    /** [appId]: the default push `app_id` (the application id). */
    fun configure(legacySdk: HawcxSDK, configId: String, options: HawcxV6InitializeOptions, appId: String) {
        dispose(resetFlow = true)

        // buildProtocolV1Sdk wires the Keystore-backed saved-flow store, so a
        // magic link can resume the sign-in after the app was killed.
        val sdk = legacySdk.buildProtocolV1Sdk(
            configId = configId,
            relyingParty = options.relyingParty,
            autoPollApprovals = options.autoPollApprovals,
            magicLinkLandingUrl = options.magicLinkLandingUrl
        )

        sdk.flow.onUpdate = { update ->
            // The session token stays native; JS only learns that one exists.
            val hasSessionToken = update is HawcxV1FlowUpdate.Completed &&
                !sdk.flow.sessionToken.isNullOrEmpty()
            val event = HawcxV6FlowEventCodec.encode(update, hasSessionToken)
            eventDispatcher.emitV6FlowEvent(event.type, event.payload)
        }
        sdk.flow.onNotice = { notice ->
            eventDispatcher.emitV6FlowEvent(
                "notice",
                Arguments.createMap().apply {
                    putString("code", notice.code)
                    putString("message", notice.message)
                }
            )
        }

        this.sdk = sdk
        this.approver = HawcxV6ApproverBridge(sdk, appId)
    }

    fun start(options: HawcxV6StartOptions) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        when {
            options.qrLogin -> sdk.startQrLogin(codeChallenge = options.codeChallenge)
            options.scope != null || options.samlReqId != null -> sdk.start(
                flowType = options.flowType,
                identifier = options.identifier,
                startToken = options.startToken,
                inviteCode = options.inviteCode,
                codeChallenge = options.codeChallenge,
                scope = options.scope,
                samlReqId = options.samlReqId
            )
            else -> sdk.start(
                flowType = options.flowType,
                identifier = options.identifier,
                startToken = options.startToken,
                inviteCode = options.inviteCode,
                codeChallenge = options.codeChallenge
            )
        }
    }

    /** Re-emits the last method list without a request; false when none was shown. */
    fun backToMethodSelection(): Boolean {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        return sdk.flow.backToMethodSelection()
    }

    /** The last completed flow's session token (a secret; never logged here). */
    fun currentSessionToken(): String? = sdk?.flow?.sessionToken

    /** [explicit], else the flow's token; `session_required` when neither exists. */
    private fun bearer(explicit: String?): Result<String> {
        explicit?.takeIf { it.isNotEmpty() }?.let { return Result.success(it) }
        sdk?.flow?.sessionToken?.takeIf { it.isNotEmpty() }?.let { return Result.success(it) }
        return Result.failure(
            HawcxV1ApprovalError(
                code = "session_required",
                message = "Sign in first: no session token is available",
                status = null,
                retryable = false
            )
        )
    }

    /** Completion runs on an OkHttp thread. */
    fun listDevices(bearerToken: String?, completion: (Result<WritableArray>) -> Unit) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        bearer(bearerToken).fold(
            onSuccess = { token ->
                sdk.account.listDevices(token) { result ->
                    completion(result.map { devices ->
                        Arguments.createArray().apply {
                            devices.forEach { pushMap(HawcxV6DeviceCodec.encode(it)) }
                        }
                    })
                }
            },
            onFailure = { completion(Result.failure(it)) }
        )
    }

    fun revokeDevice(bearerToken: String?, deviceId: String, reason: String?, completion: (Result<Unit>) -> Unit) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        bearer(bearerToken).fold(
            onSuccess = { token -> sdk.account.revokeDevice(token, deviceId, reason, completion) },
            onFailure = { completion(Result.failure(it)) }
        )
    }

    fun logoutEverywhere(bearerToken: String?, completion: (Result<Int>) -> Unit) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        bearer(bearerToken).fold(
            onSuccess = { token -> sdk.account.logoutEverywhere(token, completion) },
            onFailure = { completion(Result.failure(it)) }
        )
    }

    /**
     * Opens a `redirect` step in Custom Tabs (browser fallback). The callback
     * returns through the host's intent filter (`v6HandleRedirectUrl`).
     * [returnScheme] is unused on Android (iOS needs it for its auth session).
     */
    fun launchRedirect(context: Context, url: String): Result<String> {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        return when (sdk.redirectLauncher.launch(context, url)) {
            HawcxV1RedirectLaunchResult.CUSTOM_TAB -> Result.success("custom_tab")
            HawcxV1RedirectLaunchResult.BROWSER -> Result.success("browser")
            HawcxV1RedirectLaunchResult.NO_BROWSER -> Result.failure(
                HawcxV1ApprovalError(code = "no_browser", message = "No browser can open the sign-in page", status = null, retryable = false)
            )
            HawcxV1RedirectLaunchResult.INVALID_URL -> Result.failure(
                HawcxV1ApprovalError(code = "invalid_url", message = "url must be an http(s) URL", status = null, retryable = false)
            )
        }
    }

    fun selectMethod(methodId: String) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        sdk.flow.selectMethod(methodId)
    }

    fun submitCode(code: String) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        sdk.flow.submitCode(code)
    }

    fun submitTotp(code: String) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        sdk.flow.submitTotp(code)
    }

    fun submitPhone(phone: String) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        sdk.flow.submitPhone(phone)
    }

    fun resend(): Boolean {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        return sdk.flow.resend()
    }

    /** Thread-safe in the SDK (guarded by the controller's poll lock). No-op before initialize. */
    fun pausePolling() {
        sdk?.flow?.pausePolling()
    }

    fun resumePolling() {
        sdk?.flow?.resumePolling()
    }

    fun poll() {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        sdk.flow.poll()
    }

    fun cancel() {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        sdk.flow.cancel()
    }

    fun reset() {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        sdk.reset()
    }

    /** A v1 (6.0.x) QR approval through `HawcxV1SDK.approvals.approveV1`. */
    fun approveQr(
        rawPayload: String,
        identifier: String,
        rememberDevice: Boolean,
        completion: (Result<HawcxV6QrApprovalResult>) -> Unit
    ) {
        val approver = requireNotNull(approver) { "initialize must be called before using V6 bridge methods" }
        val trimmedIdentifier = identifier.trim()
        if (trimmedIdentifier.isEmpty()) {
            completion(Result.failure(IllegalArgumentException("identifier is required")))
            return
        }
        runCatching {
            approver.approveV1(rawPayload.trim(), trimmedIdentifier, rememberDevice, completion)
        }.onFailure { completion(Result.failure(it)) }
    }

    fun handleRedirectUrl(url: String) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        val callback = HawcxV1OAuthCallbackParser.parse(url)
            ?: throw IllegalArgumentException("url must be a valid V6 OAuth callback URL")
        sdk.flow.oauthCallback(callback.code, callback.state)
    }

    /** Completion runs on a background thread (the SDK's magic-link executor). */
    fun completeMagicLinkRedirect(url: String, completion: (WritableMap) -> Unit) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        sdk.completeMagicLinkRedirect(url) { outcome ->
            completion(HawcxV6MagicLinkOutcomeCodec.encode(outcome))
        }
    }

    fun dispose(resetFlow: Boolean) {
        approver?.dispose()
        approver = null
        val current = sdk ?: return
        current.flow.onUpdate = null
        current.flow.onNotice = null
        if (resetFlow) {
            runCatching { current.reset() }
                .onFailure { error ->
                    HawcxReactNativeLogger.w("Failed to reset V6 flow during bridge disposal", error)
                }
        }
        sdk = null
    }

}

internal data class HawcxV6QrApprovalResult(
    val outcome: String,
    val payloadType: String,
    val userId: String? = null
)

private object HawcxV6MagicLinkOutcomeCodec {
    fun encode(outcome: HawcxV1MagicLinkRedirectOutcome): WritableMap =
        Arguments.createMap().apply {
            when (outcome) {
                HawcxV1MagicLinkRedirectOutcome.NotMagicLink -> putString("outcome", "not_magic_link")
                HawcxV1MagicLinkRedirectOutcome.Resumed -> putString("outcome", "resumed")
                HawcxV1MagicLinkRedirectOutcome.HandedOff -> putString("outcome", "handed_off")
                is HawcxV1MagicLinkRedirectOutcome.Failed -> {
                    putString("outcome", "failed")
                    putString("code", outcome.code)
                    putString("message", outcome.message)
                    putBoolean("retryable", outcome.retryable)
                }
            }
        }
}

/** [HawcxV1DeviceSummary] -> JS `HawcxV6DeviceSummary`. */
internal object HawcxV6DeviceCodec {
    fun encode(device: HawcxV1DeviceSummary): WritableMap = Arguments.createMap().apply {
        putString("deviceId", device.deviceId)
        putString("h2index", device.h2index)
        putBoolean("revoked", device.revoked)
        device.createdAt?.let { putString("createdAt", it) }
        device.revokedAt?.let { putString("revokedAt", it) }
        device.deviceInfo?.let { putMap("deviceInfo", Arguments.makeNativeMap(it)) }
    }
}

/**
 * Rejects with the error's code; userInfo carries
 * `{status, retryable, retryAfterSeconds, outcome, decidedByThisDevice}` (the
 * same keys the iOS bridge sends). No secrets are in these errors.
 */
internal fun Promise.rejectApproval(error: Throwable) {
    if (error is HawcxV1ApprovalError) {
        val userInfo = Arguments.createMap().apply {
            putBoolean("retryable", error.retryable)
            error.status?.let { putInt("status", it) }
            error.retryAfterSeconds?.let { putInt("retryAfterSeconds", it) }
            error.outcome?.let { putString("outcome", it) }
            error.decidedByThisDevice?.let { putBoolean("decidedByThisDevice", it) }
        }
        reject(error.code, error.message, userInfo)
    } else if (error is HawcxV1QrApprovalError) {
        reject(error.code, error.message, HawcxV6ApproverBridge.qrUserInfo(error))
    } else if (error is IllegalArgumentException) {
        reject("hawcx.input", error.message ?: "Invalid input", error)
    } else {
        reject("hawcx.sdk", error.message ?: "Unexpected error", error)
    }
}

private data class HawcxV6EventEnvelope(
    val type: String,
    val payload: WritableMap? = null
)

private object HawcxV6FlowEventCodec {
    fun encode(update: HawcxV1FlowUpdate, hasSessionToken: Boolean = false): HawcxV6EventEnvelope {
        return when (update) {
            is HawcxV1FlowUpdate.Idle -> HawcxV6EventEnvelope(type = "idle")
            is HawcxV1FlowUpdate.Loading -> HawcxV6EventEnvelope(
                type = "loading",
                payload = Arguments.createMap().apply {
                    update.session?.takeIf { it.isNotBlank() }?.let { putString("session", it) }
                }
            )

            is HawcxV1FlowUpdate.Prompt -> HawcxV6EventEnvelope(
                type = "prompt",
                payload = encodePromptPayload(update.context, update.prompt)
            )

            is HawcxV1FlowUpdate.Completed -> HawcxV6EventEnvelope(
                type = "completed",
                payload = Arguments.createMap().apply {
                    putString("session", update.session)
                    putString("authCode", update.authCode)
                    putString("expiresAt", update.expiresAt)
                    update.codeVerifier?.let { putString("codeVerifier", it) }
                    putString("traceId", update.meta.traceId)
                    putBoolean("hasSessionToken", hasSessionToken)
                }
            )

            is HawcxV1FlowUpdate.Error -> HawcxV6EventEnvelope(
                type = "error",
                payload = Arguments.createMap().apply {
                    update.session?.let { putString("session", it) }
                    putString("code", update.code)
                    update.action?.let { putString("action", it.wireValue) }
                    putString("message", update.message)
                    putBoolean("retryable", update.retryable)
                    update.meta?.traceId?.let { putString("traceId", it) }
                    update.details?.let { putMap("details", encodeErrorDetails(it)) }
                }
            )
        }
    }

    private fun encodePromptPayload(
        context: HawcxV1PromptContext,
        prompt: HawcxV1UserPrompt
    ): WritableMap {
        return Arguments.createMap().apply {
            putString("session", context.session)
            putString("traceId", context.meta.traceId)
            putString("expiresAt", context.meta.expiresAt)
            context.stepInfo?.let { putMap("step", encodeStepInfo(it)) }
            context.risk?.let { putMap("risk", encodeRiskInfo(it)) }
            context.codeChannel?.takeIf { it.isNotBlank() }?.let { putString("codeChannel", it) }
            context.pollPath?.takeIf { it.isNotBlank() }?.let { putString("pollPath", it) }
            context.notice?.let { notice ->
                putMap("notice", Arguments.createMap().apply {
                    putString("code", notice.code)
                    putString("message", notice.message)
                })
            }
            putMap("prompt", encodePrompt(prompt, context))
        }
    }

    private fun encodePrompt(prompt: HawcxV1UserPrompt, context: HawcxV1PromptContext): WritableMap {
        return Arguments.createMap().apply {
            when (prompt) {
                is HawcxV1UserPrompt.SelectMethod -> {
                    putString("type", "select_method")
                    putArray("methods", prompt.methods.toWritableArray { encodeMethod(it) })
                    prompt.phase?.takeIf { it.isNotBlank() }?.let { putString("phase", it) }
                }
                is HawcxV1UserPrompt.EnterCode -> {
                    putString("type", "enter_code")
                    putString("destination", prompt.destination)
                    prompt.codeLength?.let { putInt("codeLength", it) }
                    prompt.codeFormat?.takeIf { it.isNotBlank() }?.let { putString("codeFormat", it) }
                    prompt.codeExpiresAt?.takeIf { it.isNotBlank() }?.let { putString("codeExpiresAt", it) }
                    prompt.resendAt?.takeIf { it.isNotBlank() }?.let { putString("resendAt", it) }
                    prompt.pollInterval?.let { putInt("pollInterval", it) }
                }
                HawcxV1UserPrompt.EnterTotp -> {
                    putString("type", "enter_totp")
                }
                is HawcxV1UserPrompt.SetupTotp -> {
                    putString("type", "setup_totp")
                    putString("secret", prompt.secret)
                    putString("otpauthUrl", prompt.otpauthUrl)
                    prompt.period?.let { putInt("period", it) }
                    context.backupCodes?.takeIf { it.isNotEmpty() }?.let { codes ->
                        putArray("backupCodes", Arguments.createArray().apply { codes.forEach { pushString(it) } })
                    }
                }
                is HawcxV1UserPrompt.SetupSms -> {
                    putString("type", "setup_sms")
                    prompt.existingPhone?.takeIf { it.isNotBlank() }?.let { putString("existingPhone", it) }
                }
                is HawcxV1UserPrompt.Redirect -> {
                    putString("type", "redirect")
                    putString("url", prompt.url)
                    prompt.returnScheme?.takeIf { it.isNotBlank() }?.let { putString("returnScheme", it) }
                }
                is HawcxV1UserPrompt.AwaitApproval -> {
                    putString("type", "await_approval")
                    prompt.qrData?.takeIf { it.isNotBlank() }?.let { putString("qrData", it) }
                    putString("expiresAt", prompt.expiresAt)
                    putInt("pollInterval", prompt.pollInterval)
                    context.approval?.let { approval ->
                        approval.mode?.takeIf { it.isNotBlank() }?.let { putString("mode", it) }
                        approval.approvalId?.takeIf { it.isNotBlank() }?.let { putString("approvalId", it) }
                        approval.number?.let { putInt("number", it) }
                    }
                }
                is HawcxV1UserPrompt.Locked -> {
                    putString("type", "locked")
                    putInt("retryAfterSeconds", prompt.retryAfterSeconds)
                    putString("lockedUntil", prompt.lockedUntil)
                }
                else -> {
                    putString("type", "unknown")
                    prompt::class.simpleName?.let { putString("rawType", it) }
                }
            }
        }
    }

    private fun encodeMethod(method: HawcxV1Method): WritableMap {
        return Arguments.createMap().apply {
            putString("id", method.id)
            putString("label", method.label)
            method.icon?.takeIf { it.isNotBlank() }?.let { putString("icon", it) }
        }
    }

    private fun encodeStepInfo(stepInfo: HawcxV1StepInfo): WritableMap {
        return Arguments.createMap().apply {
            putString("id", stepInfo.id)
            stepInfo.label?.takeIf { it.isNotBlank() }?.let { putString("label", it) }
        }
    }

    private fun encodeRiskInfo(risk: HawcxV1RiskInfo): WritableMap {
        return Arguments.createMap().apply {
            putBoolean("detected", risk.detected)
            putArray("reasons", risk.reasons.toStringArray())
            risk.message?.takeIf { it.isNotBlank() }?.let { putString("message", it) }
            risk.location?.let { putMap("location", encodeRiskLocation(it)) }
            risk.riskScore?.let { putDouble("riskScore", it) }
        }
    }

    private fun encodeRiskLocation(location: HawcxV1RiskLocation): WritableMap {
        return Arguments.createMap().apply {
            location.city?.takeIf { it.isNotBlank() }?.let { putString("city", it) }
            location.country?.takeIf { it.isNotBlank() }?.let { putString("country", it) }
        }
    }

    private fun encodeErrorDetails(details: HawcxV1ErrorDetails): WritableMap {
        return Arguments.createMap().apply {
            details.retryAfterSeconds?.let { putInt("retryAfterSeconds", it) }
            details.retryAt?.takeIf { it.isNotBlank() }?.let { putString("retryAt", it) }
            details.attemptsRemaining?.let { putInt("attemptsRemaining", it) }
            details.errors?.takeIf { it.isNotEmpty() }?.let {
                putArray("errors", it.toWritableArray(::encodeFieldError))
            }
            details.outcome?.takeIf { it.isNotBlank() }?.let { putString("outcome", it) }
            details.decidedByThisDevice?.let { putBoolean("decidedByThisDevice", it) }
        }
    }

    private fun encodeFieldError(error: HawcxV1FieldError): WritableMap {
        return Arguments.createMap().apply {
            putString("field", error.field)
            putString("message", error.message)
        }
    }

    private fun <T> List<T>.toWritableArray(transform: (T) -> WritableMap): WritableArray {
        return Arguments.createArray().apply {
            forEach { pushMap(transform(it)) }
        }
    }

    private fun List<String>.toStringArray(): WritableArray {
        return Arguments.createArray().apply {
            this@toStringArray.forEach { pushString(it) }
        }
    }
}

private fun ReadableMap.getOptionalString(key: String): String? {
    if (!hasKey(key) || isNull(key)) {
        return null
    }
    return getString(key)?.trim()?.takeUnless { it.isEmpty() }
}
