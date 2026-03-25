package com.hawcx.reactnative.v6

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.hawcx.internal.HawcxSDK
import com.hawcx.protocol.v1.HawcxV1ErrorDetails
import com.hawcx.protocol.v1.HawcxV1FieldError
import com.hawcx.protocol.v1.HawcxV1FlowUpdate
import com.hawcx.protocol.v1.HawcxV1FlowType
import com.hawcx.protocol.v1.HawcxV1Method
import com.hawcx.protocol.v1.HawcxV1OAuthCallbackParser
import com.hawcx.protocol.v1.HawcxV1PromptContext
import com.hawcx.protocol.v1.HawcxV1RiskInfo
import com.hawcx.protocol.v1.HawcxV1RiskLocation
import com.hawcx.protocol.v1.HawcxV1SDK
import com.hawcx.protocol.v1.HawcxV1StepInfo
import com.hawcx.protocol.v1.HawcxV1UserPrompt
import com.hawcx.reactnative.HawcxEventDispatcher
import com.hawcx.reactnative.HawcxReactNativeLogger

internal data class HawcxV6StartOptions(
    val identifier: String,
    val flowType: HawcxV1FlowType = HawcxV1FlowType.SIGNIN,
    val startToken: String? = null,
    val inviteCode: String? = null,
    val codeChallenge: String? = null
) {
    companion object {
        fun from(options: ReadableMap): HawcxV6StartOptions {
            val identifier = options.getString("identifier")?.trim().orEmpty()
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
                codeChallenge = options.getOptionalString("codeChallenge")
            )
        }
    }
}

internal data class HawcxV6InitializeOptions(
    val relyingParty: String? = null,
    val autoPollApprovals: Boolean = true
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
            return HawcxV6InitializeOptions(
                relyingParty = relyingParty,
                autoPollApprovals = autoPollApprovals
            )
        }
    }
}

internal class HawcxV6Bridge(
    private val eventDispatcher: HawcxEventDispatcher
) {
    private var sdk: HawcxV1SDK? = null

    fun configure(legacySdk: HawcxSDK, configId: String, options: HawcxV6InitializeOptions) {
        dispose(resetFlow = true)

        val sdk = legacySdk.buildProtocolV1Sdk(
            configId = configId,
            relyingParty = options.relyingParty,
            autoPollApprovals = options.autoPollApprovals
        )

        sdk.flow.onUpdate = { update ->
            val event = HawcxV6FlowEventCodec.encode(update)
            eventDispatcher.emitV6FlowEvent(event.type, event.payload)
        }

        this.sdk = sdk
    }

    fun start(options: HawcxV6StartOptions) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        sdk.start(
            flowType = options.flowType,
            identifier = options.identifier,
            startToken = options.startToken,
            inviteCode = options.inviteCode,
            codeChallenge = options.codeChallenge
        )
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

    fun handleRedirectUrl(url: String) {
        val sdk = requireNotNull(sdk) { "initialize must be called before using V6 bridge methods" }
        val callback = HawcxV1OAuthCallbackParser.parse(url)
            ?: throw IllegalArgumentException("url must be a valid V6 OAuth callback URL")
        sdk.flow.oauthCallback(callback.code, callback.state)
    }

    fun dispose(resetFlow: Boolean) {
        val current = sdk ?: return
        current.flow.onUpdate = null
        if (resetFlow) {
            runCatching { current.reset() }
                .onFailure { error ->
                    HawcxReactNativeLogger.w("Failed to reset V6 flow during bridge disposal", error)
                }
        }
        sdk = null
    }
}

private data class HawcxV6EventEnvelope(
    val type: String,
    val payload: WritableMap? = null
)

private object HawcxV6FlowEventCodec {
    fun encode(update: HawcxV1FlowUpdate): HawcxV6EventEnvelope {
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
            putMap("prompt", encodePrompt(prompt))
        }
    }

    private fun encodePrompt(prompt: HawcxV1UserPrompt): WritableMap {
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
                }
                HawcxV1UserPrompt.EnterTotp -> {
                    putString("type", "enter_totp")
                }
                is HawcxV1UserPrompt.SetupTotp -> {
                    putString("type", "setup_totp")
                    putString("secret", prompt.secret)
                    putString("otpauthUrl", prompt.otpauthUrl)
                    prompt.period?.let { putInt("period", it) }
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
