package com.hawcx.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

internal class HawcxEventDispatcher(
    private val reactContext: ReactApplicationContext
) {

    fun emitAuthEvent(type: String, payload: WritableMap? = null) {
        emitEvent(AUTH_EVENT_NAME, type, payload)
    }

    fun emitSessionEvent(type: String, payload: WritableMap? = null) {
        emitEvent(SESSION_EVENT_NAME, type, payload)
    }

    fun emitPushEvent(type: String, payload: WritableMap? = null) {
        emitEvent(PUSH_EVENT_NAME, type, payload)
    }

    private fun emitEvent(eventName: String, type: String, payload: WritableMap?) {
        val map = Arguments.createMap().apply {
            putString("type", type)
            if (payload != null) {
                putMap("payload", payload)
            }
        }
        runCatching {
            if (reactContext.hasActiveCatalystInstance()) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(eventName, map)
            } else {
                HawcxReactNativeLogger.w("Dropping $eventName because Catalyst instance is not ready")
            }
        }.onFailure { error ->
            HawcxReactNativeLogger.w("Failed to emit $eventName", error)
        }
    }
}
