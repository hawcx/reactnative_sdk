package com.hawcx.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = HawcxReactNativeModule.NAME)
class HawcxReactNativeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "HawcxReactNative"
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun initialize(config: ReadableMap?, promise: Promise) {
        promise.reject(
            "hawcx.android.pending",
            "Android bridge not yet implemented. Phase B will wire the native HawcxSDK."
        )
    }
}
