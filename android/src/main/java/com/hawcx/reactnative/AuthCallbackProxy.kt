package com.hawcx.reactnative

import com.facebook.react.bridge.Arguments
import com.hawcx.utils.AuthV5Callback
import com.hawcx.utils.AuthV5ErrorCode

internal class AuthCallbackProxy(
    private val dispatcher: HawcxEventDispatcher
) : AuthV5Callback {

    override fun onOtpRequired() {
        dispatcher.emitAuthEvent("otp_required")
    }

    override fun onAuthSuccess(accessToken: String, refreshToken: String, isLoginFlow: Boolean) {
        val payload = Arguments.createMap().apply {
            putBoolean("isLoginFlow", isLoginFlow)
            if (accessToken.isNotBlank()) {
                putString("accessToken", accessToken)
            }
            if (refreshToken.isNotBlank()) {
                putString("refreshToken", refreshToken)
            }
        }
        dispatcher.emitAuthEvent("auth_success", payload)
    }

    override fun onError(errorCode: AuthV5ErrorCode, errorMessage: String) {
        val payload = Arguments.createMap().apply {
            putString("code", errorCode.name)
            putString("message", errorMessage)
        }
        dispatcher.emitAuthEvent("auth_error", payload)
    }
}
