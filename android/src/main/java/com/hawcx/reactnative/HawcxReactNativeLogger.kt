package com.hawcx.reactnative

import android.util.Log

internal object HawcxReactNativeLogger {
    const val TAG = "HawcxReactNative"

    fun d(message: String) {
        Log.d(TAG, message)
    }

    fun i(message: String) {
        Log.i(TAG, message)
    }

    fun w(message: String, throwable: Throwable? = null) {
        Log.w(TAG, message, throwable)
    }
}
