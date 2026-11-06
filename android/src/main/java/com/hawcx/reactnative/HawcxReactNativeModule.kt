package com.hawcx.reactnative

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Dynamic
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.hawcx.internal.HawcxSDK
import com.hawcx.protocol.v1.HawcxV1ApprovalService
import com.hawcx.reactnative.v6.HawcxV6ApproverBridge
import com.hawcx.reactnative.v6.HawcxV6Bridge
import com.hawcx.reactnative.v6.HawcxV6InitializeOptions
import com.hawcx.reactnative.v6.HawcxV6StartOptions
import com.hawcx.reactnative.v6.rejectApproval
import com.hawcx.utils.AuthV5Callback

internal const val AUTH_EVENT_NAME = "hawcx.auth.event"
internal const val SESSION_EVENT_NAME = "hawcx.session.event"
internal const val PUSH_EVENT_NAME = "hawcx.push.event"
internal const val V6_FLOW_EVENT_NAME = "hawcx.v6.flow.event"

@ReactModule(name = HawcxReactNativeModule.NAME)
class HawcxReactNativeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext),
    LifecycleEventListener {

    companion object {
        const val NAME = "HawcxReactNative"
        private const val CODE_CONFIG = "hawcx.config"
        private const val CODE_SDK = "hawcx.sdk"
        private const val CODE_INPUT = "hawcx.input"
        private const val CODE_STORAGE = "hawcx.storage"
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
    @Volatile
    private var hawcxV6Bridge: HawcxV6Bridge? = null

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = NAME

    /** `approvalNotificationCategory`: the category of approval notifications (`HAWCX_APPROVAL`). */
    override fun getConstants(): Map<String, Any> =
        mapOf("approvalNotificationCategory" to HawcxV1ApprovalService.NOTIFICATION_CATEGORY)

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

        val baseUrl = when {
            configMap.hasKey("baseUrl") && !configMap.isNull("baseUrl") ->
                configMap.getString("baseUrl")?.trim().orEmpty()
            configMap.hasKey("endpoints") && !configMap.isNull("endpoints") -> {
                configMap.getMap("endpoints")?.getString("authBaseUrl")?.trim().orEmpty()
            }
            else -> ""
        }

        if (baseUrl.isEmpty()) {
            promise.reject(CODE_CONFIG, "baseUrl is required")
            return
        }

        if (configMap.hasKey("oauthConfig") && !configMap.isNull("oauthConfig")) {
            HawcxReactNativeLogger.w(
                "oauthConfig was provided but the Android SDK no longer accepts client credentials on-device. " +
                    "Remove this field from initialize()."
            )
        }

        val v6Options = runCatching { HawcxV6InitializeOptions.from(configMap) }
            .getOrElse { error ->
                promise.reject(CODE_CONFIG, error.message, error)
                return
            }

        runOnUiThread {
            try {
                resetNativeLanes(resetV6Flow = true)
                val sdk = HawcxSDK(
                    context = applicationContext,
                    projectApiKey = projectApiKey,
                    baseUrl = baseUrl
                )
                hawcxSDK = sdk
                val authProxy = AuthCallbackProxy(eventDispatcher)
                val sessionProxy = SessionCallbackProxy(eventDispatcher)
                val pushProxy = PushDelegateProxy(eventDispatcher)
                authCallbackProxy = authProxy
                sessionCallbackProxy = sessionProxy
                pushDelegateProxy = pushProxy
                sdk.pushAuthDelegate = pushProxy
                val v6Bridge = HawcxV6Bridge(eventDispatcher)
                v6Bridge.configure(
                    legacySdk = sdk,
                    configId = projectApiKey,
                    options = v6Options,
                    appId = applicationContext.packageName
                )
                hawcxV6Bridge = v6Bridge
                promise.resolve(null)
            } catch (error: Exception) {
                resetNativeLanes(resetV6Flow = true)
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
    fun v6Start(options: ReadableMap?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val config = options ?: run {
            promise.reject(CODE_INPUT, "options are required")
            return
        }

        val startOptions = runCatching { HawcxV6StartOptions.from(config) }
            .getOrElse { error ->
                promise.reject(CODE_INPUT, error.message, error)
                return
            }

        runOnUiThread {
            runCatching {
                bridge.start(startOptions)
            }.onSuccess {
                promise.resolve(null)
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6SelectMethod(methodId: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedMethodId = methodId?.trim().orEmpty()
        if (sanitizedMethodId.isEmpty()) {
            promise.reject(CODE_INPUT, "methodId is required")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.selectMethod(sanitizedMethodId)
            }.onSuccess {
                promise.resolve(null)
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6SubmitCode(code: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedCode = code?.trim().orEmpty()
        if (sanitizedCode.isEmpty()) {
            promise.reject(CODE_INPUT, "code is required")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.submitCode(sanitizedCode)
            }.onSuccess {
                promise.resolve(null)
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6SubmitTotp(code: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedCode = code?.trim().orEmpty()
        if (sanitizedCode.isEmpty()) {
            promise.reject(CODE_INPUT, "code is required")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.submitTotp(sanitizedCode)
            }.onSuccess {
                promise.resolve(null)
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6SubmitPhone(phone: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedPhone = phone?.trim().orEmpty()
        if (sanitizedPhone.isEmpty()) {
            promise.reject(CODE_INPUT, "phone is required")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.submitPhone(sanitizedPhone)
            }.onSuccess {
                promise.resolve(null)
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6Resend(promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.resend()
            }.onSuccess { dispatched ->
                promise.resolve(dispatched)
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6Poll(promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.poll()
            }.onSuccess {
                promise.resolve(null)
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    /**
     * Manual hold on background polling. The native SDK already pauses on
     * ProcessLifecycleOwner ON_STOP and resumes on ON_START. No-op before initialize.
     */
    @ReactMethod
    fun v6PausePolling(promise: Promise) {
        runCatching { hawcxV6Bridge?.pausePolling() }
            .onSuccess { promise.resolve(null) }
            .onFailure { error -> promise.reject(CODE_SDK, error.message, error) }
    }

    @ReactMethod
    fun v6ResumePolling(promise: Promise) {
        runCatching { hawcxV6Bridge?.resumePolling() }
            .onSuccess { promise.resolve(null) }
            .onFailure { error -> promise.reject(CODE_SDK, error.message, error) }
    }

    @ReactMethod
    fun v6Cancel(promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.cancel()
            }.onSuccess {
                promise.resolve(null)
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6Reset(promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.reset()
            }.onSuccess {
                promise.resolve(null)
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6ApproveQr(rawPayload: String?, identifier: String?, rememberDevice: Boolean, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedPayload = rawPayload?.trim().orEmpty()
        if (sanitizedPayload.isEmpty()) {
            promise.reject(CODE_INPUT, "rawPayload is required")
            return
        }

        val sanitizedIdentifier = identifier?.trim().orEmpty()
        if (sanitizedIdentifier.isEmpty()) {
            promise.reject(CODE_INPUT, "identifier is required")
            return
        }

        runOnUiThread {
            // The bridge may have been torn down (onHostDestroy / re-initialize)
            // before this runs: reject instead of throwing on the main thread.
            runCatching {
                bridge.approveQr(
                    rawPayload = sanitizedPayload,
                    identifier = sanitizedIdentifier,
                    rememberDevice = rememberDevice
                ) { result ->
                    result.onSuccess { outcome ->
                        promise.resolve(
                            Arguments.createMap().apply {
                                putString("outcome", outcome.outcome)
                                putString("payloadType", outcome.payloadType)
                                outcome.userId?.takeIf { it.isNotBlank() }?.let { putString("userId", it) }
                            }
                        )
                    }.onFailure { error ->
                        promise.rejectApproval(error)
                    }
                }
            }.onFailure { promise.rejectApproval(it) }
        }
    }

    // MARK: - Approver (approvals v2)

    private fun withApprover(promise: Promise, work: (HawcxV6ApproverBridge) -> Unit) {
        val approver = hawcxV6Bridge?.approver ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        runCatching { work(approver) }.onFailure { promise.rejectApproval(it) }
    }

    @ReactMethod
    fun v6RegisterPushToken(registration: ReadableMap?, force: Boolean, promise: Promise) {
        val input = registration ?: run {
            promise.reject(CODE_INPUT, "registration is required")
            return
        }
        withApprover(promise) { approver ->
            approver.registerPushToken(input, force) { result ->
                result.onSuccess { promise.resolve(it) }.onFailure { promise.rejectApproval(it) }
            }
        }
    }

    @ReactMethod
    fun v6UnregisterPushToken(identifier: String?, appId: String?, promise: Promise) {
        withApprover(promise) { approver ->
            approver.unregisterPushToken(
                identifier?.trim()?.ifEmpty { null },
                appId?.trim()?.ifEmpty { null }
            ) { result ->
                result.onSuccess { promise.resolve(null) }.onFailure { promise.rejectApproval(it) }
            }
        }
    }

    @ReactMethod
    fun v6ApprovalReferenceFromPush(payload: ReadableMap?, promise: Promise) {
        val data = payload ?: run {
            promise.resolve(null)
            return
        }
        withApprover(promise) { approver -> promise.resolve(approver.approvalReferenceFromPush(data)) }
    }

    @ReactMethod
    fun v6ScanApproval(raw: String?, promise: Promise) {
        val trimmed = raw?.trim().orEmpty()
        withApprover(promise) { approver ->
            promise.resolve(if (trimmed.isEmpty()) null else approver.scan(trimmed))
        }
    }

    @ReactMethod
    fun v6FetchApprovalContext(reference: ReadableMap?, identifier: String?, promise: Promise) {
        val raw = reference ?: run {
            promise.reject(CODE_INPUT, "reference is required")
            return
        }
        withApprover(promise) { approver ->
            approver.fetchContext(raw, identifier?.trim()?.ifEmpty { null }) { result ->
                result.onSuccess { promise.resolve(it) }.onFailure { promise.rejectApproval(it) }
            }
        }
    }

    @ReactMethod
    fun v6DecideApproval(handle: String?, decision: String?, numberChoice: Dynamic?, rememberDevice: Boolean, promise: Promise) {
        val key = handle?.trim().orEmpty()
        if (key.isEmpty()) {
            promise.reject(CODE_INPUT, "handle is required")
            return
        }
        val number = numberChoice?.takeUnless { it.isNull }?.let {
            if (it.type == ReadableType.Number) it.asDouble() else null
        }
        if (number != null && number % 1.0 != 0.0) {
            promise.reject("invalid_number", "The number has two digits")
            return
        }
        withApprover(promise) { approver ->
            approver.decide(key, decision.orEmpty(), number?.toInt(), rememberDevice) { result ->
                result.onSuccess { promise.resolve(it) }.onFailure { promise.rejectApproval(it) }
            }
        }
    }

    @ReactMethod
    fun v6DiscardApproval(handle: String?, promise: Promise) {
        handle?.let { hawcxV6Bridge?.approver?.discard(it) }
        promise.resolve(null)
    }

    @ReactMethod
    fun v6EnrolledIdentifiers(promise: Promise) {
        withApprover(promise) { approver ->
            approver.enrolledIdentifiers()
                .onSuccess { ids ->
                    promise.resolve(Arguments.createArray().apply { ids.forEach { pushString(it) } })
                }
                .onFailure { promise.rejectApproval(it) }
        }
    }

    /** Resolves the scan shape for a requester screen's 8-digit code. */
    @ReactMethod
    fun v6ResolveApprovalCode(code: String?, promise: Promise) {
        withApprover(promise) { approver ->
            approver.resolveCode(code.orEmpty()) { result ->
                result.onSuccess { promise.resolve(it) }.onFailure { promise.rejectApproval(it) }
            }
        }
    }

    /**
     * Deletes this device's V6 device credentials for [identifier] (not the
     * legacy `clearUserKeychainData`). Blocking Keystore I/O: it runs on the
     * native-modules thread, never the main thread.
     */
    @ReactMethod
    fun v6ForgetDevice(identifier: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedIdentifier = identifier?.trim().orEmpty()
        if (sanitizedIdentifier.isEmpty()) {
            promise.reject(CODE_INPUT, "identifier is required")
            return
        }
        runCatching { bridge.forgetDevice(sanitizedIdentifier) }
            .onSuccess { promise.resolve(it) }
            .onFailure { error -> promise.reject(CODE_SDK, error.message, error) }
    }

    @ReactMethod
    fun v6HandleRedirectUrl(url: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedUrl = url?.trim().orEmpty()
        if (sanitizedUrl.isEmpty()) {
            promise.reject(CODE_INPUT, "url is required")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.handleRedirectUrl(sanitizedUrl)
            }.onSuccess {
                promise.resolve(null)
            }.onFailure { error ->
                promise.reject(CODE_INPUT, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6CompleteMagicLinkRedirect(url: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedUrl = url?.trim().orEmpty()
        if (sanitizedUrl.isEmpty()) {
            promise.reject(CODE_INPUT, "url is required")
            return
        }

        runOnUiThread {
            runCatching {
                bridge.completeMagicLinkRedirect(sanitizedUrl) { outcome ->
                    promise.resolve(outcome)
                }
            }.onFailure { error ->
                promise.reject(CODE_SDK, error.message, error)
            }
        }
    }

    @ReactMethod
    fun v6BackToMethodSelection(promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        runOnUiThread {
            runCatching { bridge.backToMethodSelection() }
                .onSuccess { promise.resolve(it) }
                .onFailure { error -> promise.reject(CODE_SDK, error.message, error) }
        }
    }

    /** Resolves the last completed flow's session token or null. Never logged. */
    @ReactMethod
    fun v6GetSessionToken(promise: Promise) {
        promise.resolve(hawcxV6Bridge?.currentSessionToken())
    }

    @ReactMethod
    fun v6ListDevices(sessionToken: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        runCatching {
            bridge.listDevices(sessionToken?.trim()?.ifEmpty { null }) { result ->
                result.onSuccess { promise.resolve(it) }.onFailure { promise.rejectApproval(it) }
            }
        }.onFailure { error -> promise.reject(CODE_SDK, error.message, error) }
    }

    @ReactMethod
    fun v6RevokeDevice(sessionToken: String?, deviceId: String?, reason: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedDevice = deviceId?.trim().orEmpty()
        if (sanitizedDevice.isEmpty()) {
            promise.reject(CODE_INPUT, "deviceId is required")
            return
        }
        runCatching {
            bridge.revokeDevice(
                sessionToken?.trim()?.ifEmpty { null },
                sanitizedDevice,
                reason?.trim()?.ifEmpty { null }
            ) { result ->
                result.onSuccess { promise.resolve(null) }.onFailure { promise.rejectApproval(it) }
            }
        }.onFailure { error -> promise.reject(CODE_SDK, error.message, error) }
    }

    @ReactMethod
    fun v6LogoutEverywhere(sessionToken: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        runCatching {
            bridge.logoutEverywhere(sessionToken?.trim()?.ifEmpty { null }) { result ->
                result.onSuccess { count ->
                    promise.resolve(Arguments.createMap().apply { putInt("sessionsEnded", count) })
                }.onFailure { promise.rejectApproval(it) }
            }
        }.onFailure { error -> promise.reject(CODE_SDK, error.message, error) }
    }

    /** Custom Tabs launch; [returnScheme] only matters on iOS. */
    @ReactMethod
    fun v6LaunchRedirect(url: String?, returnScheme: String?, promise: Promise) {
        val bridge = hawcxV6Bridge ?: run {
            promise.reject(CODE_SDK, "initialize must be called before using V6 bridge methods")
            return
        }
        val sanitizedUrl = url?.trim().orEmpty()
        if (sanitizedUrl.isEmpty()) {
            promise.reject(CODE_INPUT, "url is required")
            return
        }
        runOnUiThread {
            val context = reactApplicationContext.currentActivity ?: applicationContext
            runCatching { bridge.launchRedirect(context, sanitizedUrl) }
                .fold(
                    onSuccess = { result ->
                        result.onSuccess { launchedWith ->
                            promise.resolve(Arguments.createMap().apply { putString("launchedWith", launchedWith) })
                        }.onFailure { promise.rejectApproval(it) }
                    },
                    onFailure = { error -> promise.reject(CODE_SDK, error.message, error) }
                )
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
    fun storeBackendOAuthTokens(userId: String?, accessToken: String?, refreshToken: String?, promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before storeBackendOAuthTokens")
            return
        }
        val trimmedUser = userId?.trim().orEmpty()
        if (trimmedUser.isEmpty()) {
            promise.reject(CODE_INPUT, "userId cannot be empty")
            return
        }

        val trimmedAccess = accessToken?.trim().orEmpty()
        if (trimmedAccess.isEmpty()) {
            promise.reject(CODE_INPUT, "accessToken cannot be empty")
            return
        }

        val refresh = refreshToken?.trim().orEmpty().ifBlank { null }

        runCatching {
            sdk.storeBackendOAuthTokens(
                accessToken = trimmedAccess,
                refreshToken = refresh,
                userId = trimmedUser
            )
        }.onSuccess { stored ->
            if (stored) {
                promise.resolve(true)
            } else {
                promise.reject(CODE_STORAGE, "Failed to persist backend-issued tokens")
            }
        }.onFailure { error ->
            promise.reject(CODE_STORAGE, error.message, error)
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
            resetV6FlowIfAvailable()
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
            resetV6FlowIfAvailable()
            sdk.clearUserKeychainData(sanitizedUserId)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun clearLastLoggedInUser(promise: Promise) {
        val sdk = hawcxSDK ?: run {
            promise.reject(CODE_SDK, "initialize must be called before clearLastLoggedInUser")
            return
        }

        runOnUiThread {
            sdk.clearLastLoggedInUser()
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

    private fun resetV6FlowIfAvailable() {
        hawcxV6Bridge?.let { bridge ->
            runCatching { bridge.reset() }
                .onFailure { error ->
                    HawcxReactNativeLogger.w("Failed to reset V6 flow while clearing local state.", error)
                }
        }
    }

    override fun onHostResume() = Unit

    override fun onHostPause() = Unit

    override fun onHostDestroy() {
        resetNativeLanes(resetV6Flow = true)
    }

    override fun invalidate() {
        reactApplicationContext.removeLifecycleEventListener(this)
        resetNativeLanes(resetV6Flow = true)
        super.invalidate()
    }

    private fun resetNativeLanes(resetV6Flow: Boolean) {
        hawcxV6Bridge?.dispose(resetFlow = resetV6Flow)
        hawcxV6Bridge = null
        hawcxSDK?.pushAuthDelegate = null
        pushDelegateProxy = null
        sessionCallbackProxy = null
        authCallbackProxy = null
        hawcxSDK = null
    }
}
