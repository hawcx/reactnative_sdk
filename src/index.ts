import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  EmitterSubscription,
  NativeModule,
} from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

const LINKING_ERROR =
  "The package '@hawcx/react-native-sdk' doesn't seem to be linked.\n" +
  "Please ensure you have run 'pod install' in the ios directory and rebuilt the app.";

const AUTH_EVENT = 'hawcx.auth.event';
const SESSION_EVENT = 'hawcx.session.event';
const PUSH_EVENT = 'hawcx.push.event';

export type HawcxInitializeConfig = {
  projectApiKey: string;
  oauthConfig?: {
    clientId: string;
    publicKeyPem: string;
    tokenEndpoint: string;
  };
  endpoints?: {
    authBaseUrl?: string;
  };
};

export type AuthSuccessPayload = {
  accessToken?: string;
  refreshToken?: string;
  isLoginFlow: boolean;
};

export type AuthorizationCodePayload = {
  code: string;
  expiresIn?: number;
};

export type AdditionalVerificationPayload = {
  sessionId: string;
  detail?: string;
};

export type BackendOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
};

export type AuthErrorPayload = {
  code: string;
  message: string;
};

export type AuthEvent =
  | { type: 'otp_required' }
  | { type: 'auth_success'; payload: AuthSuccessPayload }
  | { type: 'authorization_code'; payload: AuthorizationCodePayload }
  | { type: 'additional_verification_required'; payload: AdditionalVerificationPayload }
  | { type: 'auth_error'; payload: AuthErrorPayload };

export type SessionEvent =
  | { type: 'session_success' }
  | { type: 'session_error'; payload: AuthErrorPayload };

export type PushLoginPayload = {
  requestId: string;
  ipAddress: string;
  deviceInfo: string;
  location?: string;
  timestamp: string;
};

export type PushEvent =
  | { type: 'push_login_request'; payload: PushLoginPayload }
  | { type: 'push_error'; payload: AuthErrorPayload };

type NativeBridge = {
  initialize(config: HawcxInitializeConfig): Promise<void>;
  authenticate(userId: string): Promise<void>;
  submitOtp(otp: string): Promise<void>;
  storeBackendOAuthTokens(
    userId: string,
    accessToken: string,
    refreshToken?: string | null,
  ): Promise<boolean>;
  getDeviceDetails(): Promise<void>;
  webLogin(pin: string): Promise<void>;
  webApprove(token: string): Promise<void>;
  setApnsDeviceToken(tokenBase64: string): Promise<void>;
  setFcmToken(token: string): Promise<void>;
  userDidAuthenticate(): Promise<void>;
  handlePushNotification(payload: Record<string, unknown>): Promise<boolean>;
  approvePushRequest(requestId: string): Promise<void>;
  declinePushRequest(requestId: string): Promise<void>;
};

type HawcxNativeModule = NativeBridge & NativeModule;

const HawcxReactNativeModule = NativeModules.HawcxReactNative as HawcxNativeModule | undefined;

if (!HawcxReactNativeModule) {
  throw new Error(LINKING_ERROR);
}

const HawcxReactNative = HawcxReactNativeModule;

const authEventEmitter = new NativeEventEmitter(HawcxReactNativeModule);
const sessionEventEmitter = new NativeEventEmitter(HawcxReactNativeModule);
const pushEventEmitter = new NativeEventEmitter(HawcxReactNativeModule);

const isIOS = () => Platform.OS === 'ios';
const isAndroid = () => Platform.OS === 'android';

const ensureNonEmpty = (value: string, field: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
};

export function initialize(config: HawcxInitializeConfig): Promise<void> {
  try {
    const apiKey = ensureNonEmpty(config.projectApiKey, 'projectApiKey');
    return HawcxReactNative.initialize({
      ...config,
      projectApiKey: apiKey,
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

export function authenticate(userId: string): Promise<void> {
  try {
    return HawcxReactNative.authenticate(ensureNonEmpty(userId, 'userId'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function submitOtp(otp: string): Promise<void> {
  try {
    return HawcxReactNative.submitOtp(ensureNonEmpty(otp, 'otp'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function storeBackendOAuthTokens(
  userId: string,
  accessToken: string,
  refreshToken?: string,
): Promise<void> {
  try {
    const trimmedUser = ensureNonEmpty(userId, 'userId');
    const trimmedAccess = ensureNonEmpty(accessToken, 'accessToken');
    const trimmedRefresh = refreshToken?.trim();
    return HawcxReactNative.storeBackendOAuthTokens(
      trimmedUser,
      trimmedAccess,
      trimmedRefresh && trimmedRefresh.length > 0 ? trimmedRefresh : null,
    ).then(() => undefined);
  } catch (error) {
    return Promise.reject(error);
  }
}

export function getDeviceDetails(): Promise<void> {
  return HawcxReactNative.getDeviceDetails();
}

export function webLogin(pin: string): Promise<void> {
  try {
    return HawcxReactNative.webLogin(ensureNonEmpty(pin, 'pin'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function webApprove(token: string): Promise<void> {
  try {
    return HawcxReactNative.webApprove(ensureNonEmpty(token, 'token'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function setApnsDeviceToken(tokenData: Uint8Array | number[]): Promise<void> {
  if (!isIOS()) {
    return Promise.resolve();
  }
  const buffer = Buffer.from(tokenData);
  return HawcxReactNative.setApnsDeviceToken(buffer.toString('base64'));
}

export function setFcmToken(token: string): Promise<void> {
  if (!isAndroid()) {
    return Promise.resolve();
  }
  try {
    return HawcxReactNative.setFcmToken(ensureNonEmpty(token, 'token'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function setPushDeviceToken(token: Uint8Array | number[] | string): Promise<void> {
  if (isIOS()) {
    if (typeof token === 'string') {
      return Promise.reject(
        new Error('APNs tokens must be provided as byte arrays or Uint8Arrays'),
      );
    }
    return setApnsDeviceToken(token);
  }
  if (isAndroid()) {
    if (typeof token !== 'string') {
      return Promise.reject(new Error('FCM token must be a string on Android'));
    }
    return setFcmToken(token);
  }
  return Promise.reject(
    new Error(`Unsupported platform for push token registration: ${Platform.OS}`),
  );
}

export function notifyUserAuthenticated(): Promise<void> {
  return HawcxReactNative.userDidAuthenticate();
}

export function handlePushNotification(payload: Record<string, unknown>): Promise<boolean> {
  return HawcxReactNative.handlePushNotification(payload);
}

export function approvePushRequest(requestId: string): Promise<void> {
  try {
    return HawcxReactNative.approvePushRequest(ensureNonEmpty(requestId, 'requestId'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function declinePushRequest(requestId: string): Promise<void> {
  try {
    return HawcxReactNative.declinePushRequest(ensureNonEmpty(requestId, 'requestId'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function addAuthListener(handler: (event: AuthEvent) => void): EmitterSubscription {
  return authEventEmitter.addListener(AUTH_EVENT, handler);
}

export function removeAllListeners(): void {
  authEventEmitter.removeAllListeners(AUTH_EVENT);
  sessionEventEmitter.removeAllListeners(SESSION_EVENT);
  pushEventEmitter.removeAllListeners(PUSH_EVENT);
}

export function addSessionListener(handler: (event: SessionEvent) => void): EmitterSubscription {
  return sessionEventEmitter.addListener(SESSION_EVENT, handler);
}

export function addPushListener(handler: (event: PushEvent) => void): EmitterSubscription {
  return pushEventEmitter.addListener(PUSH_EVENT, handler);
}

export const platform = Platform.OS;

export class HawcxAuthError extends Error {
  public readonly code: string;
  public readonly payload: AuthErrorPayload;

  constructor(payload: AuthErrorPayload) {
    super(payload.message);
    this.name = 'HawcxAuthError';
    this.code = payload.code;
    this.payload = payload;
  }
}

export type HawcxAuthOptions = {
  onOtpRequired?: () => void;
  onAuthorizationCode?: (payload: AuthorizationCodePayload) => void;
  onAdditionalVerificationRequired?: (payload: AdditionalVerificationPayload) => void;
  onEvent?: (event: AuthEvent) => void;
};

export type AuthInvocation = {
  promise: Promise<AuthSuccessPayload>;
  cancel: () => void;
};

const AUTH_CANCELLED: AuthErrorPayload = {
  code: 'auth_cancelled',
  message: 'Authentication cancelled by caller',
};

export class HawcxClient {
  initialize(config: HawcxInitializeConfig): Promise<void> {
    return initialize(config);
  }

  authenticate(userId: string, options?: HawcxAuthOptions): AuthInvocation {
    const authPromise = authenticate(userId);
    let rejectPromise: ((reason?: unknown) => void) | null = null;
    let subscription: EmitterSubscription | null = null;

    const cleanup = () => {
      subscription?.remove();
      subscription = null;
    };

    const eventPromise = new Promise<AuthSuccessPayload>((resolve, reject) => {
      rejectPromise = reject;
      subscription = addAuthListener((event) => {
        options?.onEvent?.(event);
        switch (event.type) {
          case 'otp_required':
            options?.onOtpRequired?.();
            break;
          case 'authorization_code':
            options?.onAuthorizationCode?.(event.payload);
            break;
          case 'additional_verification_required':
            options?.onAdditionalVerificationRequired?.(event.payload);
            break;
          case 'auth_success':
            cleanup();
            resolve(event.payload);
            break;
          case 'auth_error':
            cleanup();
            reject(new HawcxAuthError(event.payload));
            break;
        }
      });
    });

    authPromise.catch((error) => {
      cleanup();
      rejectPromise?.(error);
    });

    return {
      promise: eventPromise,
      cancel: () => {
        cleanup();
        rejectPromise?.(new HawcxAuthError(AUTH_CANCELLED));
      },
    };
  }

  submitOtp(otp: string): Promise<void> {
    return submitOtp(otp);
  }

  fetchDeviceDetails(): Promise<void> {
    return HawcxReactNative.getDeviceDetails();
  }

  webLogin(pin: string, options?: { onEvent?: (event: SessionEvent) => void }): Promise<void> {
    if (options?.onEvent) {
      let subscription: EmitterSubscription | null = null;
      subscription = addSessionListener((event) => {
        options.onEvent?.(event);
        subscription?.remove();
        subscription = null;
      });
      return HawcxReactNative.webLogin(pin).catch((error) => {
        subscription?.remove();
        subscription = null;
        throw error;
      });
    }
    return HawcxReactNative.webLogin(pin);
  }

  webApprove(token: string, options?: { onEvent?: (event: SessionEvent) => void }): Promise<void> {
    if (options?.onEvent) {
      let subscription: EmitterSubscription | null = null;
      subscription = addSessionListener((event) => {
        options.onEvent?.(event);
        subscription?.remove();
        subscription = null;
      });
      return HawcxReactNative.webApprove(token).catch((error) => {
        subscription?.remove();
        subscription = null;
        throw error;
      });
    }
    return HawcxReactNative.webApprove(token);
  }

  addListener(handler: (event: AuthEvent) => void): EmitterSubscription {
    return addAuthListener(handler);
  }

  clearListeners(): void {
    removeAllListeners();
  }

  setApnsDeviceToken(tokenData: Uint8Array | number[]): Promise<void> {
    return setApnsDeviceToken(tokenData);
  }

  setFcmToken(token: string): Promise<void> {
    return setFcmToken(token);
  }

  setPushDeviceToken(token: Uint8Array | number[] | string): Promise<void> {
    return setPushDeviceToken(token);
  }

  notifyUserAuthenticated(): Promise<void> {
    return notifyUserAuthenticated();
  }

  handlePushNotification(payload: Record<string, unknown>): Promise<boolean> {
    return handlePushNotification(payload);
  }

  approvePushRequest(requestId: string): Promise<void> {
    return approvePushRequest(requestId);
  }

  declinePushRequest(requestId: string): Promise<void> {
    return declinePushRequest(requestId);
  }

  addPushListener(handler: (event: PushEvent) => void): EmitterSubscription {
    return addPushListener(handler);
  }

  storeBackendOAuthTokens(userId: string, tokens: BackendOAuthTokens): Promise<void> {
    return storeBackendOAuthTokens(userId, tokens.accessToken, tokens.refreshToken);
  }
}

export const hawcxClient = new HawcxClient();

export type HawcxAuthHookState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'otp'; attempts: number }
  | { status: 'authorization_code'; payload: AuthorizationCodePayload }
  | { status: 'additional_verification_required'; payload: AdditionalVerificationPayload }
  | { status: 'success'; result: AuthSuccessPayload }
  | { status: 'error'; error: AuthErrorPayload };

export type HawcxWebSessionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success' }
  | { status: 'error'; error: AuthErrorPayload };

export function useHawcxAuth(client: HawcxClient = hawcxClient) {
  const [state, setState] = useState<HawcxAuthHookState>({ status: 'idle' });
  const otpAttempts = useRef(0);

  useEffect(() => {
    const subscription = client.addListener((event) => {
      switch (event.type) {
        case 'otp_required':
          otpAttempts.current += 1;
          setState({ status: 'otp', attempts: otpAttempts.current });
          break;
        case 'authorization_code':
          otpAttempts.current = 0;
          setState({ status: 'authorization_code', payload: event.payload });
          break;
        case 'additional_verification_required':
          otpAttempts.current = 0;
          setState({
            status: 'additional_verification_required',
            payload: event.payload,
          });
          break;
        case 'auth_success':
          otpAttempts.current = 0;
          setState({ status: 'success', result: event.payload });
          break;
        case 'auth_error':
          otpAttempts.current = 0;
          setState({ status: 'error', error: event.payload });
          break;
      }
    });

    return () => {
      subscription.remove();
    };
  }, [client]);

  const authenticateUser = useCallback(
    (userId: string, options?: HawcxAuthOptions) => {
      setState({ status: 'pending' });
      return client.authenticate(userId, options);
    },
    [client],
  );

  const submitOtpCode = useCallback(
    (otp: string) => {
      return client.submitOtp(otp);
    },
    [client],
  );

  const reset = useCallback(() => {
    otpAttempts.current = 0;
    setState({ status: 'idle' });
  }, []);

  return {
    state,
    authenticate: authenticateUser,
    submitOtp: submitOtpCode,
    reset,
  };
}

/** @internal Testing hook to emit synthetic events */
export const __INTERNAL_EVENTS__ = {
  authEmitter: authEventEmitter,
  sessionEmitter: sessionEventEmitter,
  pushEmitter: pushEventEmitter,
  authEventName: AUTH_EVENT,
  sessionEventName: SESSION_EVENT,
  pushEventName: PUSH_EVENT,
};

export function useHawcxWebLogin(client: HawcxClient = hawcxClient) {
  const [state, setState] = useState<HawcxWebSessionState>({ status: 'idle' });

  useEffect(() => {
    const subscription = addSessionListener((event) => {
      if (event.type === 'session_success') {
        setState({ status: 'success' });
      } else {
        setState({ status: 'error', error: event.payload });
      }
    });
    return () => subscription.remove();
  }, []);

  const start = useCallback(
    (pin: string) => {
      setState({ status: 'loading' });
      return client.webLogin(pin);
    },
    [client],
  );

  const approve = useCallback(
    (token: string) => {
      setState({ status: 'loading' });
      return client.webApprove(token);
    },
    [client],
  );

  const fetchDeviceDetails = useCallback(() => {
    setState({ status: 'loading' });
    return client.fetchDeviceDetails();
  }, [client]);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return {
    state,
    webLogin: start,
    webApprove: approve,
    getDeviceDetails: fetchDeviceDetails,
    reset,
  };
}
