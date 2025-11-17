package com.hawcx.reactnative

import com.facebook.react.bridge.Arguments
import com.hawcx.utils.DevSessionCallback
import com.hawcx.utils.WebLoginCallback
import com.hawcx.utils.WebLoginError

internal class SessionCallbackProxy(
    private val dispatcher: HawcxEventDispatcher
) : DevSessionCallback, WebLoginCallback {

    override fun onSuccess() {
        dispatcher.emitSessionEvent("session_success")
    }

    override fun onError() {
        dispatcher.emitSessionEvent(
            "session_error",
            Arguments.createMap().apply {
                putString("code", "session_error")
                putString("message", "Failed to fetch device session")
            }
        )
    }

    override fun onError(webLoginErrorCode: WebLoginError, errorMessage: String) {
        dispatcher.emitSessionEvent(
            "session_error",
            Arguments.createMap().apply {
                putString("code", webLoginErrorCode.name)
                putString("message", errorMessage)
            }
        )
    }
}
