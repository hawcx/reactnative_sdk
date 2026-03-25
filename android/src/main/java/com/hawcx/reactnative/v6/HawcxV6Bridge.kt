package com.hawcx.reactnative.v6

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.hawcx.internal.HawcxSDK
import com.hawcx.protocol.v1.HawcxV1FlowUpdate
import com.hawcx.protocol.v1.HawcxV1SDK
import com.hawcx.protocol.v1.HawcxV1UserPrompt
import com.hawcx.reactnative.HawcxEventDispatcher
import com.hawcx.reactnative.HawcxReactNativeLogger

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
                    update.session?.let { putString("session", it) }
                }
            )

            is HawcxV1FlowUpdate.Prompt -> HawcxV6EventEnvelope(
                type = "prompt",
                payload = Arguments.createMap().apply {
                    putString("session", update.context.session)
                    putString("traceId", update.context.meta.traceId)
                    putString("expiresAt", update.context.meta.expiresAt)
                    update.context.stepInfo?.id?.let { putString("stepId", it) }
                    update.context.stepInfo?.label?.let { putString("stepLabel", it) }
                    update.context.codeChannel?.let { putString("codeChannel", it) }
                    putString("promptType", promptType(update.prompt))
                }
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
                }
            )
        }
    }

    private fun promptType(prompt: HawcxV1UserPrompt): String {
        return when (prompt) {
            is HawcxV1UserPrompt.SelectMethod -> "select_method"
            is HawcxV1UserPrompt.EnterCode -> "enter_code"
            is HawcxV1UserPrompt.EnterTotp -> "enter_totp"
            is HawcxV1UserPrompt.SetupTotp -> "setup_totp"
            is HawcxV1UserPrompt.SetupSms -> "setup_sms"
            is HawcxV1UserPrompt.Redirect -> "redirect"
            is HawcxV1UserPrompt.AwaitApproval -> "await_approval"
        }
    }
}
