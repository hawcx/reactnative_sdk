package com.hawcx.reactnative

import com.facebook.react.bridge.Arguments
import com.hawcx.model.PushLoginRequestDetails
import com.hawcx.utils.HawcxPushAuthDelegate

internal class PushDelegateProxy(
    private val dispatcher: HawcxEventDispatcher
) : HawcxPushAuthDelegate {

    override fun hawcx(didReceiveLoginRequest: String, details: PushLoginRequestDetails) {
        val payload = Arguments.createMap().apply {
            putString("requestId", didReceiveLoginRequest)
            putString("ipAddress", details.ipAddress)
            putString("deviceInfo", details.deviceInfo)
            putString("timestamp", details.timestamp)
            if (!details.location.isNullOrBlank()) {
                putString("location", details.location)
            }
        }
        dispatcher.emitPushEvent("push_login_request", payload)
    }

    override fun hawcx(failedToFetchLoginRequestDetails: Throwable) {
        val payload = Arguments.createMap().apply {
            putString("code", "push_error")
            putString("message", failedToFetchLoginRequestDetails.message ?: "Failed to fetch login request details")
        }
        dispatcher.emitPushEvent("push_error", payload)
    }
}
