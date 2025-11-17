package com.hawcx.reactnative

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.hawcx.internal.HawcxOAuthConfig
import com.hawcx.internal.HawcxSDK
import com.hawcx.utils.AuthV5Callback

internal const val AUTH_EVENT_NAME = "hawcx.auth.event"
internal const val SESSION_EVENT_NAME = "hawcx.session.event"
internal const val PUSH_EVENT_NAME = "hawcx.push.event"

@ReactModule(name = HawcxReactNativeModule.NAME)
class HawcxReactNativeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "HawcxReactNative"
        private const val CODE_CONFIG = "hawcx.config"
        private const val CODE_SDK = "hawcx.sdk"
        private const val CODE_INPUT = "hawcx.input"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val applicationContext = reactApplicationContext.applicationContext

    private val eventDispatcher = HawcxEventDispatcher(reactApplicationContext)

    @Volatile
    private var hawcxSDK: HawcxSDK? = null
    @Volatile
    private var authCallbackProxy: AuthV5Callback? = null
    @Volatile
    private var sessionCallbackProxy: SessionCallbackProxy? = null
    @Volatile
    private var pushDelegateProxy: PushDelegateProxy? = null

    override fun getName(): String = NAME

    @ReactMethod
    fun initialize(config: ReadableMap?, promise: Promise) {
        val configMap = config ?: run {
            promise.reject(CODE_CONFIG, "initialize requires a configuration map")
            return
        }

        val projectApiKey = configMap.getString("projectApiKey")?.trim().orEmpty()
        if (projectApiKey.isEmpty()) {
            promise.reject(CODE_CONFIG, "projectApiKey is required")
            return
        }

        val oauthConfig = if (configMap.hasKey("oauthConfig") && !configMap.isNull("oauthConfig")) {
            val oauth = configMap.getMap("oauthConfig") ?: run {
                promise.reject(CODE_CONFIG, "oauthConfig must be an object")
                return
            }
            val endpoint = oauth.getString("tokenEndpoint")?.trim().orEmpty()
            val clientId = oauth.getString("clientId")?.trim().orEmpty()
            val publicKeyPem = oauth.getString("publicKeyPem")?.trim().orEmpty()

            if (endpoint.isEmpty() || clientId.isEmpty() || publicKeyPem.isEmpty()) {
                promise.reject(CODE_CONFIG, "oauthConfig must include tokenEndpoint, clientId, and publicKeyPem")
                return
            }
            HawcxOAuthConfig(
                tokenEndpoint = endpoint,
                clientId = clientId,
                publicKeyPem = publicKeyPem
            )
        } else {
            null
        }

        runOnUiThread {
            try {
                val sdk = HawcxSDK(
                    context = applicationContext,
                    projectApiKey = projectApiKey,
                    oauthConfig = oauthConfig
                )
                hawcxSDK = sdk
                val authProxy = AuthCallbackProxy(eventDispatcher)
                val sessionProxy = SessionCallbackProxy(eventDispatcher)
                val pushProxy = PushDelegateProxy(eventDispatcher)
                authCallbackProxy = authProxy
                sessionCallbackProxy = sessionProxy
                pushDelegateProxy = pushProxy
                sdk.pushAuthDelegate = pushProxy
                promise.resolve(null)
            } catch (error: Exception) {
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun authenticate(userId: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before authenticate")
            return
        }
        val callback = authCallbackProxy ?: run {
            promise.reject(CODE_SDK, "Auth callback not configured")
            return
        }
        val sanitizedUserId = userId?.trim().orEmpty()
        if (sanitizedUserId.isEmpty()) {
            promise.reject(CODE_INPUT, "userId cannot be empty")
            return
        }

        runOnUiThread {
            sdk.authenticateV5(sanitizedUserId, callback)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun submitOtp(otp: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before submitOtp")
            return
        }
        val sanitizedOtp = otp?.trim().orEmpty()
        if (sanitizedOtp.isEmpty()) {
            promise.reject(CODE_INPUT, "otp cannot be empty")
            return
        }

        runOnUiThread {
            sdk.submitOtpV5(sanitizedOtp)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun getDeviceDetails(promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before getDeviceDetails")
            return
        }
        val callback = sessionCallbackProxy ?: run {
            promise.reject(CODE_SDK, "Session callback not configured")
            return
        }

        runOnUiThread {
            sdk.getDeviceDetails(callback)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun webLogin(pin: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before webLogin")
            return
        }
        val callback = sessionCallbackProxy ?: run {
            promise.reject(CODE_SDK, "Session callback not configured")
            return
        }
        val sanitizedPin = pin?.trim().orEmpty()
        if (sanitizedPin.isEmpty()) {
            promise.reject(CODE_INPUT, "pin cannot be empty")
            return
        }

        runOnUiThread {
            sdk.webLogin(sanitizedPin, callback)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun webApprove(token: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before webApprove")
            return
        }
        val callback = sessionCallbackProxy ?: run {
            promise.reject(CODE_SDK, "Session callback not configured")
            return
        }
        val sanitizedToken = token?.trim().orEmpty()
        if (sanitizedToken.isEmpty()) {
            promise.reject(CODE_INPUT, "token cannot be empty")
            return
        }

        runOnUiThread {
            sdk.webApprove(sanitizedToken, callback)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun getLastLoggedInUser(promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before getLastLoggedInUser")
            return
        }
        promise.resolve(sdk.getLastLoggedInUser())
    }

    @ReactMethod
    fun clearSessionTokens(userId: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before clearSessionTokens")
            return
        }
        val sanitizedUserId = userId?.trim().orEmpty()
        if (sanitizedUserId.isEmpty()) {
            promise.reject(CODE_INPUT, "userId cannot be empty")
            return
        }

        runOnUiThread {
            sdk.clearSessionTokens(sanitizedUserId)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun clearUserKeychainData(userId: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before clearUserKeychainData")
            return
        }
        val sanitizedUserId = userId?.trim().orEmpty()
        if (sanitizedUserId.isEmpty()) {
            promise.reject(CODE_INPUT, "userId cannot be empty")
            return
        }

        runOnUiThread {
            sdk.clearUserKeychainData(sanitizedUserId)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun setFcmToken(token: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before setFcmToken")
            return
        }
        val sanitizedToken = token?.trim().orEmpty()
        if (sanitizedToken.isEmpty()) {
            promise.reject(CODE_INPUT, "token cannot be empty")
            return
        }
        runOnUiThread {
            sdk.setFcmToken(sanitizedToken)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun userDidAuthenticate(promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before userDidAuthenticate")
            return
        }
        runOnUiThread {
            sdk.userDidAuthenticate()
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun handlePushNotification(payload: ReadableMap?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before handlePushNotification")
            return
        }
        val payloadMap = payload ?: run {
            promise.reject(CODE_INPUT, "payload is required")
            return
        }

        val stringMap = mutableMapOf<String, String>()
        payloadMap.toHashMap().forEach { (key, value) ->
            val valueString = value?.toString()
            if (valueString != null) {
                stringMap[key] = valueString
            }
        }

        runOnUiThread {
            sdk.handlePushNotification(stringMap)
            promise.resolve(stringMap.containsKey("request_id"))
        }
    }

    @ReactMethod
    fun approvePushRequest(requestId: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before approvePushRequest")
            return
        }
        val sanitizedId = requestId?.trim().orEmpty()
        if (sanitizedId.isEmpty()) {
            promise.reject(CODE_INPUT, "requestId cannot be empty")
            return
        }
        sdk.approveLoginRequest(sanitizedId) { error ->
            if (error == null) {
                promise.resolve(null)
            } else {
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun declinePushRequest(requestId: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before declinePushRequest")
            return
        }
        val sanitizedId = requestId?.trim().orEmpty()
        if (sanitizedId.isEmpty()) {
            promise.reject(CODE_INPUT, "requestId cannot be empty")
            return
        }
        sdk.declineLoginRequest(sanitizedId) { error ->
            if (error == null) {
                promise.resolve(null)
            } else {
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    private fun runOnUiThread(block: () -> Unit) {
        if (Looper.getMainLooper() == Looper.myLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }
}
