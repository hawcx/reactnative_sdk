import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  EmitterSubscription,
  NativeModule,
} from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeV6FlowEvent } from './v6Normalization';
import {
  canHawcxV6Resend,
  createIdentifierHawcxV6AuthState,
  createInitialHawcxV6AuthState,
  getHawcxV6ResendAvailability,
  normalizeHawcxV6FlowType,
  refreshHawcxV6AuthState,
  reduceHawcxV6FlowEvent,
} from './v6State';
import type {
  HawcxV6AuthState,
  HawcxV6FlowEvent,
  HawcxV6FlowType,
  HawcxV6StartOptions,
} from './v6Types';
import { routeWebLoginScan, type HawcxV6QrApprovalResult } from './v6WebLogin';

export type {
  HawcxV6AwaitApprovalPrompt,
  HawcxV6AuthState,
  HawcxV6AuthStatus,
  HawcxV6CompletedPayload,
  HawcxV6EnterCodePrompt,
  HawcxV6EnterTotpPrompt,
  HawcxV6ErrorAction,
  HawcxV6ErrorDetails,
  HawcxV6ErrorPayload,
  HawcxV6FieldError,
  HawcxV6FlowEvent,
  HawcxV6FlowType,
  HawcxV6Method,
  HawcxV6PromptPayload,
  HawcxV6RedirectPrompt,
  HawcxV6ResendAvailability,
  HawcxV6RiskInfo,
  HawcxV6RiskLocation,
  HawcxV6SelectMethodPrompt,
  HawcxV6SetupSmsPrompt,
  HawcxV6SetupTotpPrompt,
  HawcxV6StartOptions,
  HawcxV6StepInfo,
} from './v6Types';
export type {
  HawcxV6QrApprovalResult,
  HawcxV6QrPayload,
  HawcxV6QrPayloadType,
  HawcxWebLoginScanRoute,
} from './v6WebLogin';

const LINKING_ERROR = [
  "The package '@hawcx/react-native-sdk' doesn't seem to be linked.",
  "iOS: run 'pod install' in the ios directory and rebuild.",
  'Android: clean/rebuild the app so Gradle picks up the native module.',
].join('\n');

const AUTH_EVENT = 'hawcx.auth.event';
const SESSION_EVENT = 'hawcx.session.event';
const PUSH_EVENT = 'hawcx.push.event';
const V6_FLOW_EVENT = 'hawcx.v6.flow.event';

export type HawcxInitializeConfig = {
  projectApiKey: string;
  /**
   * Tenant-specific Hawcx host (for example: https://hawcx-api.hawcx.com).
   * The native SDK appends /hc_auth internally—do not add extra paths.
   */
  baseUrl?: string;
  oauthConfig?: {
    clientId: string;
    publicKeyPem: string;
    tokenEndpoint: string;
  };
  relyingParty?: string;
  autoPollApprovals?: boolean;
  /**
   * @deprecated Use root-level `baseUrl` instead. Kept for backward compatibility during migration.
   */
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

export type HawcxV6QrApprovalOptions = {
  rememberDevice?: boolean;
};

export type HawcxV6AuthHookResult = {
  state: HawcxV6AuthState;
  start: (options: HawcxV6StartOptions) => Promise<void>;
  selectMethod: (methodId: string) => Promise<void>;
  submitCode: (code: string) => Promise<void>;
  submitTotp: (code: string) => Promise<void>;
  submitPhone: (phone: string) => Promise<void>;
  resend: () => Promise<boolean>;
  poll: () => Promise<void>;
  cancel: () => Promise<void>;
  changeIdentifier: () => Promise<void>;
  reset: () => Promise<void>;
  handleRedirectUrl: (url: string) => Promise<void>;
  canResend: boolean;
  resendAvailability: HawcxV6AuthState['resend'];
  secondsUntilResend?: number;
};

type NativeBridge = {
  initialize(config: HawcxInitializeConfig): Promise<void>;
  authenticate(userId: string): Promise<void>;
  submitOtp(otp: string): Promise<void>;
  v6Start(options: HawcxV6StartOptions): Promise<void>;
  v6SelectMethod(methodId: string): Promise<void>;
  v6SubmitCode(code: string): Promise<void>;
  v6SubmitTotp(code: string): Promise<void>;
  v6SubmitPhone(phone: string): Promise<void>;
  v6Resend(): Promise<boolean>;
  v6Poll(): Promise<void>;
  v6Cancel(): Promise<void>;
  v6Reset(): Promise<void>;
  v6ApproveQr(
    rawPayload: string,
    identifier: string,
    rememberDevice: boolean,
  ): Promise<Record<string, unknown>>;
  v6HandleRedirectUrl(url: string): Promise<void>;
  storeBackendOAuthTokens(
    userId: string,
    accessToken: string,
    refreshToken?: string | null,
  ): Promise<boolean>;
  getLastLoggedInUser(): Promise<string>;
  clearSessionTokens(userId: string): Promise<void>;
  clearUserKeychainData(userId: string): Promise<void>;
  clearLastLoggedInUser(): Promise<void>;
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
const v6FlowEventEmitter = new NativeEventEmitter(HawcxReactNativeModule);

const isIOS = () => Platform.OS === 'ios';
const isAndroid = () => Platform.OS === 'android';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const ensureNonEmpty = (value: string, field: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
};

const normalizeByteArray = (value: Uint8Array | number[], field: string): Uint8Array => {
  if (value instanceof Uint8Array) {
    if (value.length === 0) {
      throw new Error(`${field} cannot be empty`);
    }
    return value;
  }

  if (value.length === 0) {
    throw new Error(`${field} cannot be empty`);
  }

  value.forEach((byte, index) => {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${field}[${index}] must be an integer between 0 and 255`);
    }
  });

  return Uint8Array.from(value);
};

const bytesToBase64 = (value: Uint8Array | number[], field: string): string => {
  const bytes = normalizeByteArray(value, field);
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index];
    const hasByte2 = index + 1 < bytes.length;
    const hasByte3 = index + 2 < bytes.length;
    const byte2 = hasByte2 ? bytes[index + 1] : 0;
    const byte3 = hasByte3 ? bytes[index + 2] : 0;

    output += BASE64_ALPHABET[Math.floor(byte1 / 4)];
    output += BASE64_ALPHABET[(byte1 % 4) * 16 + Math.floor(byte2 / 16)];
    output += hasByte2 ? BASE64_ALPHABET[(byte2 % 16) * 4 + Math.floor(byte3 / 64)] : '=';
    output += hasByte3 ? BASE64_ALPHABET[byte3 % 64] : '=';
  }

  return output;
};

const resolveBaseUrl = (config: HawcxInitializeConfig): string => {
  const candidate = config.baseUrl ?? config.endpoints?.authBaseUrl ?? '';
  return ensureNonEmpty(candidate, 'baseUrl');
};

export function initialize(config: HawcxInitializeConfig): Promise<void> {
  try {
    const apiKey = ensureNonEmpty(config.projectApiKey, 'projectApiKey');
    const baseUrl = resolveBaseUrl(config);
    return HawcxReactNative.initialize({
      ...config,
      projectApiKey: apiKey,
      baseUrl,
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

export function startV6Flow(options: HawcxV6StartOptions): Promise<void> {
  try {
    const identifier = ensureNonEmpty(options.identifier, 'identifier');
    return HawcxReactNative.v6Start({
      ...options,
      identifier,
      flowType: normalizeHawcxV6FlowType(options.flowType),
      startToken: options.startToken?.trim() || undefined,
      inviteCode: options.inviteCode?.trim() || undefined,
      codeChallenge: options.codeChallenge?.trim() || undefined,
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

export function v6SelectMethod(methodId: string): Promise<void> {
  try {
    return HawcxReactNative.v6SelectMethod(ensureNonEmpty(methodId, 'methodId'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function v6SubmitCode(code: string): Promise<void> {
  try {
    return HawcxReactNative.v6SubmitCode(ensureNonEmpty(code, 'code'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function v6SubmitTotp(code: string): Promise<void> {
  try {
    return HawcxReactNative.v6SubmitTotp(ensureNonEmpty(code, 'code'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function v6SubmitPhone(phone: string): Promise<void> {
  try {
    return HawcxReactNative.v6SubmitPhone(ensureNonEmpty(phone, 'phone'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function v6Resend(): Promise<boolean> {
  return HawcxReactNative.v6Resend();
}

export function v6Poll(): Promise<void> {
  return HawcxReactNative.v6Poll();
}

export function v6Cancel(): Promise<void> {
  return HawcxReactNative.v6Cancel();
}

export function v6Reset(): Promise<void> {
  return HawcxReactNative.v6Reset();
}

const normalizeV6QrApprovalResult = (value: unknown): HawcxV6QrApprovalResult => {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const outcome = record?.outcome;
  const payloadType = record?.payloadType;

  if (outcome === 'approved' && (payloadType === 'qr_auth' || payloadType === 'qr_login')) {
    return {
      outcome,
      payloadType,
    };
  }

  if (outcome === 'bound' && (payloadType === 'qr_auth' || payloadType === 'qr_login')) {
    return {
      outcome,
      payloadType,
      userId: typeof record?.userId === 'string' ? record.userId : undefined,
    };
  }

  throw new Error('Invalid V6 QR approval response from native bridge');
};

export async function approveV6Qr(
  rawPayload: string,
  identifier: string,
  options: HawcxV6QrApprovalOptions = {},
): Promise<HawcxV6QrApprovalResult> {
  const trimmedPayload = ensureNonEmpty(rawPayload, 'rawPayload');
  const trimmedIdentifier = ensureNonEmpty(identifier, 'identifier');
  const result = await HawcxReactNative.v6ApproveQr(
    trimmedPayload,
    trimmedIdentifier,
    options.rememberDevice ?? false,
  );
  return normalizeV6QrApprovalResult(result);
}

export function v6HandleRedirectUrl(url: string): Promise<void> {
  try {
    return HawcxReactNative.v6HandleRedirectUrl(ensureNonEmpty(url, 'url'));
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
  try {
    return HawcxReactNative.setApnsDeviceToken(bytesToBase64(tokenData, 'tokenData'));
  } catch (error) {
    return Promise.reject(error);
  }
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

export function addV6FlowListener(handler: (event: HawcxV6FlowEvent) => void): EmitterSubscription {
  return v6FlowEventEmitter.addListener(V6_FLOW_EVENT, (rawEvent: unknown) => {
    const normalized = normalizeV6FlowEvent(rawEvent);
    if (normalized) {
      handler(normalized);
    }
  });
}

export const addHawcxV6FlowListener = addV6FlowListener;
export const startHawcxV6Flow = startV6Flow;
export const handleHawcxV6RedirectUrl = v6HandleRedirectUrl;
export { canHawcxV6Resend, getHawcxV6ResendAvailability };
export { routeWebLoginScan };

export async function getLastLoggedInUser(): Promise<string> {
  const userId = await HawcxReactNative.getLastLoggedInUser();
  return typeof userId === 'string' ? userId : '';
}

export function logoutSession(userId: string): Promise<void> {
  try {
    return HawcxReactNative.clearSessionTokens(ensureNonEmpty(userId, 'userId'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function forgetTrustedDevice(userId: string): Promise<void> {
  try {
    return HawcxReactNative.clearUserKeychainData(ensureNonEmpty(userId, 'userId'));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function clearLastLoggedInUser(): Promise<void> {
  return HawcxReactNative.clearLastLoggedInUser();
}

export function removeAllListeners(): void {
  authEventEmitter.removeAllListeners(AUTH_EVENT);
  sessionEventEmitter.removeAllListeners(SESSION_EVENT);
  pushEventEmitter.removeAllListeners(PUSH_EVENT);
  v6FlowEventEmitter.removeAllListeners(V6_FLOW_EVENT);
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

  getLastLoggedInUser(): Promise<string> {
    return getLastLoggedInUser();
  }

  logoutSession(userId: string): Promise<void> {
    return logoutSession(userId);
  }

  forgetTrustedDevice(userId: string): Promise<void> {
    return forgetTrustedDevice(userId);
  }

  clearLastLoggedInUser(): Promise<void> {
    return clearLastLoggedInUser();
  }
}

export const hawcxClient = new HawcxClient();

export type HawcxV6PrimaryMethodSelectionPolicy = 'manual' | 'automatic_from_identifier';

export type HawcxV6HookOptions = {
  flowType?: HawcxV6FlowType;
  now?: () => number;
  resendTickMs?: number;
  primaryMethodSelectionPolicy?: HawcxV6PrimaryMethodSelectionPolicy;
};

const normalizeV6PrimaryMethodSelectionPolicy = (
  value?: HawcxV6PrimaryMethodSelectionPolicy,
): HawcxV6PrimaryMethodSelectionPolicy =>
  value === 'automatic_from_identifier' ? value : 'manual';

const isV6EmailLike = (value: string) =>
  /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,64}$/i.test(value.trim());

const isV6PhoneLike = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) {
    return false;
  }

  if (/^[+\-().\s0-9]+$/.test(trimmed) === false) {
    return false;
  }

  return trimmed.startsWith('+') ? digits.length >= 8 : true;
};

const normalizeV6StageKey = (value?: string) =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '') ?? '';

const isV6MfaOrLaterStage = (value?: string) => {
  const normalized = normalizeV6StageKey(value);
  return (
    normalized === 'mfa' ||
    normalized === 'secondfactor' ||
    normalized === 'devicetrust' ||
    normalized === 'setupdevice' ||
    normalized === 'devicechallenge'
  );
};

const resolveV6PreferredMethodId = (
  methods: Array<{ id: string }>,
  identifier: string,
  phase?: string,
  stepId?: string,
) => {
  if (methods.length === 1) {
    return methods[0]?.id;
  }

  const normalizedPhase = normalizeV6StageKey(phase);
  if (normalizedPhase) {
    if (normalizedPhase !== 'primary' || isV6MfaOrLaterStage(normalizedPhase)) {
      return undefined;
    }
  } else if (isV6MfaOrLaterStage(stepId)) {
    return undefined;
  }

  const normalizedIdentifier = identifier.trim();
  if (isV6EmailLike(normalizedIdentifier)) {
    return (
      methods.find((method) => method.id.toLowerCase().includes('email'))?.id ??
      methods.find((method) => method.id.toLowerCase().includes('magic'))?.id
    );
  }

  if (isV6PhoneLike(normalizedIdentifier)) {
    return methods.find((method) => {
      const normalized = method.id.toLowerCase();
      return normalized.includes('sms') || normalized.includes('phone');
    })?.id;
  }

  return undefined;
};

export class HawcxV6Client {
  initialize(config: HawcxInitializeConfig): Promise<void> {
    return initialize(config);
  }

  start(options: HawcxV6StartOptions): Promise<void> {
    return startV6Flow(options);
  }

  selectMethod(methodId: string): Promise<void> {
    return v6SelectMethod(methodId);
  }

  submitCode(code: string): Promise<void> {
    return v6SubmitCode(code);
  }

  submitTotp(code: string): Promise<void> {
    return v6SubmitTotp(code);
  }

  submitPhone(phone: string): Promise<void> {
    return v6SubmitPhone(phone);
  }

  resend(): Promise<boolean> {
    return v6Resend();
  }

  poll(): Promise<void> {
    return v6Poll();
  }

  cancel(): Promise<void> {
    return v6Cancel();
  }

  reset(): Promise<void> {
    return v6Reset();
  }

  approveQr(
    rawPayload: string,
    identifier: string,
    options?: HawcxV6QrApprovalOptions,
  ): Promise<HawcxV6QrApprovalResult> {
    return approveV6Qr(rawPayload, identifier, options);
  }

  changeIdentifier(): Promise<void> {
    return v6Reset();
  }

  handleRedirectUrl(url: string): Promise<void> {
    return v6HandleRedirectUrl(url);
  }

  addFlowListener(handler: (event: HawcxV6FlowEvent) => void): EmitterSubscription {
    return addV6FlowListener(handler);
  }

  storeBackendOAuthTokens(userId: string, tokens: BackendOAuthTokens): Promise<void> {
    return storeBackendOAuthTokens(userId, tokens.accessToken, tokens.refreshToken);
  }

  notifyUserAuthenticated(): Promise<void> {
    return notifyUserAuthenticated();
  }

  getLastLoggedInUser(): Promise<string> {
    return getLastLoggedInUser();
  }

  logoutSession(userId: string): Promise<void> {
    return logoutSession(userId);
  }

  forgetTrustedDevice(userId: string): Promise<void> {
    return forgetTrustedDevice(userId);
  }

  clearLastLoggedInUser(): Promise<void> {
    return clearLastLoggedInUser();
  }
}

export const hawcxV6Client = new HawcxV6Client();

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

export function useHawcxV6Auth(
  client: HawcxV6Client = hawcxV6Client,
  options: HawcxV6HookOptions = {},
): HawcxV6AuthHookResult {
  const now = options.now ?? Date.now;
  const resendTickMs = Math.max(250, options.resendTickMs ?? 1000);
  const primaryMethodSelectionPolicy = normalizeV6PrimaryMethodSelectionPolicy(
    options.primaryMethodSelectionPolicy,
  );
  const [state, setState] = useState<HawcxV6AuthState>(() =>
    createInitialHawcxV6AuthState(options.flowType),
  );
  const autoSelectedMethodKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = client.addFlowListener((event) => {
      setState((previous) => reduceHawcxV6FlowEvent(event, previous, now()));
    });

    return () => {
      subscription.remove();
    };
  }, [client, now]);

  useEffect(() => {
    if (!state.resend.resendAt || state.resend.canResend) {
      return;
    }

    const intervalId = setInterval(() => {
      setState((previous) => refreshHawcxV6AuthState(previous, now()));
    }, resendTickMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [now, resendTickMs, state.resend.canResend, state.resend.resendAt]);

  const start = useCallback(
    (startOptions: HawcxV6StartOptions) => {
      const identifier = ensureNonEmpty(startOptions.identifier, 'identifier');
      const flowType = normalizeHawcxV6FlowType(startOptions.flowType ?? options.flowType);

      setState((previous) =>
        createIdentifierHawcxV6AuthState({
          previous,
          identifier,
          flowType,
        }),
      );

      return client.start({
        ...startOptions,
        identifier,
        flowType,
      });
    },
    [client, options.flowType],
  );

  const selectMethod = useCallback((methodId: string) => client.selectMethod(methodId), [client]);

  useEffect(() => {
    const prompt = state.prompt;
    if (
      primaryMethodSelectionPolicy !== 'automatic_from_identifier' ||
      state.status !== 'select_method' ||
      !prompt ||
      prompt.prompt.type !== 'select_method'
    ) {
      autoSelectedMethodKeyRef.current = null;
      return;
    }

    const selectionKey = [
      prompt.session,
      prompt.traceId ?? 'no-trace',
      prompt.prompt.phase ?? 'no-phase',
      state.step?.id ?? 'no-step',
      prompt.prompt.methods.map((method) => method.id).join(','),
      state.identifier?.trim().toLowerCase() ?? 'no-identifier',
    ].join('|');

    if (autoSelectedMethodKeyRef.current === selectionKey) {
      return;
    }

    const preferredMethodId = resolveV6PreferredMethodId(
      prompt.prompt.methods,
      state.identifier ?? '',
      prompt.prompt.phase,
      state.step?.id,
    );

    if (!preferredMethodId) {
      return;
    }

    autoSelectedMethodKeyRef.current = selectionKey;
    selectMethod(preferredMethodId).catch(() => {
      if (autoSelectedMethodKeyRef.current === selectionKey) {
        autoSelectedMethodKeyRef.current = null;
      }
    });
  }, [
    primaryMethodSelectionPolicy,
    selectMethod,
    state.identifier,
    state.prompt,
    state.status,
    state.step?.id,
  ]);

  const submitCode = useCallback((code: string) => client.submitCode(code), [client]);

  const submitTotp = useCallback((code: string) => client.submitTotp(code), [client]);

  const submitPhone = useCallback((phone: string) => client.submitPhone(phone), [client]);

  const resend = useCallback(() => client.resend(), [client]);
  const poll = useCallback(() => client.poll(), [client]);

  const cancel = useCallback(async () => {
    await client.cancel();
    setState((previous) =>
      createIdentifierHawcxV6AuthState({
        previous,
        identifier: previous.identifier,
      }),
    );
  }, [client]);

  const reset = useCallback(async () => {
    await client.reset();
    setState((previous) =>
      createIdentifierHawcxV6AuthState({
        previous,
        identifier: previous.identifier,
      }),
    );
  }, [client]);

  const changeIdentifier = useCallback(async () => {
    await client.changeIdentifier();
    setState((previous) =>
      createIdentifierHawcxV6AuthState({
        previous,
      }),
    );
  }, [client]);

  const handleRedirectUrl = useCallback((url: string) => client.handleRedirectUrl(url), [client]);

  return {
    state,
    start,
    selectMethod,
    submitCode,
    submitTotp,
    submitPhone,
    resend,
    poll,
    cancel,
    changeIdentifier,
    reset,
    handleRedirectUrl,
    canResend: state.resend.canResend,
    resendAvailability: state.resend,
    secondsUntilResend: state.resend.secondsUntilResend,
  };
}

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
  v6FlowEmitter: v6FlowEventEmitter,
  authEventName: AUTH_EVENT,
  sessionEventName: SESSION_EVENT,
  pushEventName: PUSH_EVENT,
  v6FlowEventName: V6_FLOW_EVENT,
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
