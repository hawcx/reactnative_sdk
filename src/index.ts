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
  applyHawcxV6MagicLinkRedirect,
  refreshHawcxV6AuthState,
  reduceHawcxV6FlowEvent,
  HAWCX_V6_APPROVAL_OUTCOME_CODES,
  isHawcxV6ApprovalOutcome,
} from './v6State';
import { HawcxServiceError, toHawcxServiceError, withServiceErrors } from './v6Errors';
import {
  apnsTokenHex,
  normalizeApprovalReference,
  normalizeApprovalRequest,
  normalizeApprovalResult,
  normalizeScannedApproval,
  type HawcxV6ApprovalDecision,
  type HawcxV6ApprovalReference,
  type HawcxV6ApprovalRequest,
  type HawcxV6ApprovalResult,
  type HawcxV6PushRegistrationInput,
  type HawcxV6PushRegistrationReport,
  type HawcxV6ScannedApproval,
  type HawcxV6UnregisterPushOptions,
} from './v6Approver';
import type {
  HawcxV6AuthState,
  HawcxV6DeviceSummary,
  HawcxV6FlowEvent,
  HawcxV6FlowType,
  HawcxV6MagicLinkRedirectOutcome,
  HawcxV6RedirectLaunch,
  HawcxV6StartOptions,
} from './v6Types';
import { routeWebLoginScan, type HawcxV6QrApprovalResult } from './v6WebLogin';

export type {
  HawcxV6ApprovalDisplay,
  HawcxV6ApprovalOutcomeCode,
  HawcxV6AwaitApprovalPrompt,
  HawcxV6DeviceSummary,
  HawcxV6LockedPrompt,
  HawcxV6Notice,
  HawcxV6RedirectLaunch,
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
  HawcxV6MagicLinkRedirectOutcome,
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
  HawcxV6UnknownPrompt,
} from './v6Types';
export type {
  HawcxV6ApprovalDecision,
  HawcxV6ApprovalKind,
  HawcxV6ApprovalReference,
  HawcxV6ApprovalRequest,
  HawcxV6ApprovalRequester,
  HawcxV6ApprovalResult,
  HawcxV6PushRegistrationInput,
  HawcxV6PushRegistrationReport,
  HawcxV6ScannedApproval,
  HawcxV6UnregisterPushOptions,
} from './v6Approver';
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
   * V6 magic link: https URL the server redirects a confirmed link to (must match
   * a landing URL registered on the project exactly; no query, no fragment). The
   * app opens it as a Universal Link / App Link and passes it to
   * `completeMagicLinkRedirect`. When set, the in-progress flow is saved in the
   * Keychain/Keystore while the code screen shows, so the link can resume it
   * even after the app was killed.
   */
  magicLinkLandingUrl?: string;
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

export { HawcxServiceError, toHawcxServiceError };
export { HAWCX_V6_APPROVAL_OUTCOME_CODES, isHawcxV6ApprovalOutcome };

/**
 * Error codes the flow can report (error events) that apps commonly branch on.
 * Not exhaustive: unknown codes pass through as strings.
 */
export const HawcxV6ErrorCodes = {
  sdkOutdated: 'sdk_outdated',
  rateLimited: 'rate_limited',
  accountLocked: 'account_locked',
  unauthorizedDevice: 'unauthorized_device',
  approvalDenied: 'approval_denied',
  approvalWrongNumber: 'approval_wrong_number',
  approvalSuperseded: 'approval_superseded',
  approvalBlocked: 'approval_blocked',
  pushRateLimited: 'push_rate_limited',
  pushUnavailable: 'push_unavailable',
  qrLoginNotAllowed: 'qr_login_not_allowed',
} as const;

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
  /** Holds background polling on the waiting screen (see `HawcxV6Client.pausePolling`). */
  pausePolling: () => Promise<void>;
  /** Resumes polling held by `pausePolling`. */
  resumePolling: () => Promise<void>;
  cancel: () => Promise<void>;
  changeIdentifier: () => Promise<void>;
  reset: () => Promise<void>;
  handleRedirectUrl: (url: string) => Promise<void>;
  completeMagicLinkRedirect: (url: string) => Promise<HawcxV6MagicLinkRedirectOutcome>;
  /**
   * Shows the last method list again without a request (e.g. after an error
   * whose action is `select_method`, like `push_rate_limited`). Resolves false
   * when no method list was shown in this flow.
   */
  backToMethodSelection: () => Promise<boolean>;
  /** Anonymous QR sign-in (`startQrLogin` on the client). */
  startQrLogin: (options?: { codeChallenge?: string }) => Promise<void>;
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
  v6PausePolling(): Promise<void>;
  v6ResumePolling(): Promise<void>;
  v6Cancel(): Promise<void>;
  v6Reset(): Promise<void>;
  v6ApproveQr(
    rawPayload: string,
    identifier: string,
    rememberDevice: boolean,
  ): Promise<Record<string, unknown>>;
  v6HandleRedirectUrl(url: string): Promise<void>;
  v6CompleteMagicLinkRedirect(url: string): Promise<Record<string, unknown>>;
  v6BackToMethodSelection(): Promise<boolean>;
  v6GetSessionToken(): Promise<string | null>;
  v6ListDevices(sessionToken: string | null): Promise<unknown>;
  v6RevokeDevice(
    sessionToken: string | null,
    deviceId: string,
    reason: string | null,
  ): Promise<void>;
  v6LogoutEverywhere(sessionToken: string | null): Promise<Record<string, unknown>>;
  v6LaunchRedirect(url: string, returnScheme: string | null): Promise<Record<string, unknown>>;
  v6RegisterPushToken(
    registration: Record<string, unknown>,
    force: boolean,
  ): Promise<Record<string, unknown>>;
  v6UnregisterPushToken(identifier: string | null, appId: string | null): Promise<void>;
  v6ApprovalReferenceFromPush(payload: Record<string, unknown>): Promise<unknown>;
  v6ScanApproval(raw: string): Promise<unknown>;
  v6FetchApprovalContext(
    reference: HawcxV6ApprovalReference,
    identifier: string | null,
  ): Promise<unknown>;
  v6DecideApproval(
    handle: string,
    decision: HawcxV6ApprovalDecision,
    numberChoice: number | null,
    rememberDevice: boolean,
  ): Promise<unknown>;
  v6DiscardApproval(handle: string): Promise<void>;
  v6EnrolledIdentifiers(): Promise<unknown>;
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

const MAGIC_LINK_LANDING_URL_ERROR =
  'magicLinkLandingUrl must be an https URL without query or fragment';

type ParsedUrl = {
  scheme: string;
  userInfo?: string;
  host: string;
  port?: string;
  path: string;
  query?: string;
  fragment?: string;
};

// Small RFC 3986 split; RN 0.73's URL polyfill lacks most accessors.
const parseUrl = (value: string): ParsedUrl | undefined => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]*)([^?#\s]*)(?:\?([^#\s]*))?(?:#(\S*))?$/i.exec(
    value,
  );
  if (!match) {
    return undefined;
  }
  const [, scheme, authority, path, query, fragment] = match;
  const at = authority.lastIndexOf('@');
  const hostPort = at < 0 ? authority : authority.slice(at + 1);
  const portMatch = /^(.*):(\d*)$/.exec(hostPort);
  return {
    scheme: scheme.toLowerCase(),
    userInfo: at < 0 ? undefined : authority.slice(0, at),
    host: (portMatch ? portMatch[1] : hostPort).toLowerCase(),
    port: portMatch && portMatch[2] ? portMatch[2] : undefined,
    path: path || '/',
    query,
    fragment,
  };
};

const normalizeMagicLinkLandingUrl = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = parseUrl(trimmed);
  if (
    !parsed ||
    parsed.scheme !== 'https' ||
    !parsed.host ||
    parsed.userInfo !== undefined ||
    parsed.query !== undefined ||
    parsed.fragment !== undefined
  ) {
    throw new Error(MAGIC_LINK_LANDING_URL_ERROR);
  }
  return trimmed;
};

const isOnMagicLinkLandingPage = (url: string, landingUrl: string): boolean => {
  const candidate = parseUrl(url.trim());
  const landing = parseUrl(landingUrl);
  return (
    candidate !== undefined &&
    landing !== undefined &&
    candidate.scheme === landing.scheme &&
    candidate.host === landing.host &&
    candidate.port === landing.port &&
    candidate.path === landing.path
  );
};

const MAGIC_LINK_TOKEN_PARAM = 'hawcx_magic_link';
const MAGIC_LINK_PROJECT_PARAM = 'hawcx_project';

const readQueryParam = (url: string, name: string): string | undefined => {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) {
    return undefined;
  }
  const fragmentStart = url.indexOf('#', queryStart);
  const query = url.slice(queryStart + 1, fragmentStart < 0 ? undefined : fragmentStart);
  for (const pair of query.split('&')) {
    const separator = pair.indexOf('=');
    const key = separator < 0 ? pair : pair.slice(0, separator);
    if (key === name) {
      const raw = separator < 0 ? '' : pair.slice(separator + 1);
      try {
        return decodeURIComponent(raw.replace(/\+/g, ' ')).trim() || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
};

/**
 * True when `url` is a Hawcx magic-link landing URL (carries both
 * `hawcx_magic_link` and `hawcx_project`). Use it to route incoming links:
 * anything else (OAuth callbacks, other deep links) keeps its existing handler.
 *
 * Pass the `magicLinkLandingUrl` given to `initialize` as `landingUrl` to apply
 * the native SDKs' rule (`HawcxV1MagicLinkRedirectParser.parse(url, landingUrl)`):
 * only a URL on that page counts (same scheme and host, case-insensitive; same
 * port; exact path). `completeMagicLinkRedirect` applies the same rule natively.
 */
export function isHawcxMagicLinkUrl(url: string, landingUrl?: string): boolean {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return false;
  }
  const landing = landingUrl?.trim();
  if (landing && !isOnMagicLinkLandingPage(url, landing)) {
    return false;
  }
  return (
    readQueryParam(url, MAGIC_LINK_TOKEN_PARAM) !== undefined &&
    readQueryParam(url, MAGIC_LINK_PROJECT_PARAM) !== undefined
  );
}

const resolveBaseUrl = (config: HawcxInitializeConfig): string => {
  const candidate = config.baseUrl ?? config.endpoints?.authBaseUrl ?? '';
  return ensureNonEmpty(candidate, 'baseUrl');
};

export function initialize(config: HawcxInitializeConfig): Promise<void> {
  try {
    const apiKey = ensureNonEmpty(config.projectApiKey, 'projectApiKey');
    const baseUrl = resolveBaseUrl(config);
    const magicLinkLandingUrl = normalizeMagicLinkLandingUrl(config.magicLinkLandingUrl);
    return HawcxReactNative.initialize({
      ...config,
      projectApiKey: apiKey,
      baseUrl,
      magicLinkLandingUrl,
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

const trimmedOrUndefined = (value?: string): string | undefined => value?.trim() || undefined;

/** Drops undefined values so the native side sees absent keys. */
const compact = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

const buildV6StartOptions = (options: HawcxV6StartOptions): HawcxV6StartOptions => {
  if (options.method === 'qr_login') {
    if (options.identifier?.trim()) {
      throw new Error('identifier must be omitted for qr_login');
    }
    if (options.flowType && options.flowType !== 'signin') {
      throw new Error('qr_login is a signin flow');
    }
    if (options.scope || options.samlReqId || options.startToken || options.inviteCode) {
      throw new Error(
        'scope, samlReqId, startToken and inviteCode are not supported with qr_login',
      );
    }
    return compact({
      method: 'qr_login',
      flowType: 'signin',
      codeChallenge: trimmedOrUndefined(options.codeChallenge),
    });
  }
  const identifier = ensureNonEmpty(options.identifier ?? '', 'identifier');
  return compact({
    ...options,
    identifier,
    flowType: normalizeHawcxV6FlowType(options.flowType),
    startToken: trimmedOrUndefined(options.startToken),
    inviteCode: trimmedOrUndefined(options.inviteCode),
    codeChallenge: trimmedOrUndefined(options.codeChallenge),
    scope: trimmedOrUndefined(options.scope),
    samlReqId: trimmedOrUndefined(options.samlReqId),
  });
};

export function startV6Flow(options: HawcxV6StartOptions): Promise<void> {
  try {
    return HawcxReactNative.v6Start(buildV6StartOptions(options));
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Anonymous QR sign-in: a signin with no identifier. The flow emits an
 * `await_approval` step whose `qrData` the app shows as a QR code; a signed-in
 * phone scans it and picks the account. The tenant must allow `qr_login`
 * (otherwise an error event `qr_login_not_allowed`).
 */
export function startV6QrLogin(options: { codeChallenge?: string } = {}): Promise<void> {
  return startV6Flow({ method: 'qr_login', codeChallenge: options.codeChallenge });
}

/** See `HawcxV6AuthHookResult.backToMethodSelection`. */
export function v6BackToMethodSelection(): Promise<boolean> {
  return HawcxReactNative.v6BackToMethodSelection().then((value) => value === true);
}

/**
 * The session token (JWT) of the last completed flow, or null. It is a secret
 * bearer credential: never log it. The SDK keeps it native and never puts it on
 * a flow event; the device APIs below use it when passed `null`. Cleared by a
 * new start and reset; not persisted across app launches.
 */
export function v6GetSessionToken(): Promise<string | null> {
  return HawcxReactNative.v6GetSessionToken().then((value) =>
    typeof value === 'string' && value.length > 0 ? value : null,
  );
}

const normalizeSessionTokenArg = (sessionToken?: string | null): string | null =>
  sessionToken?.trim() || null;

const normalizeDeviceSummary = (value: unknown): HawcxV6DeviceSummary | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const str = (item: unknown) => (typeof item === 'string' && item ? item : undefined);
  const deviceId = str(record.deviceId);
  const h2index = str(record.h2index);
  if (!deviceId || !h2index) {
    return undefined;
  }
  const deviceInfo =
    typeof record.deviceInfo === 'object' &&
    record.deviceInfo !== null &&
    !Array.isArray(record.deviceInfo)
      ? (record.deviceInfo as Record<string, unknown>)
      : undefined;
  return {
    deviceId,
    h2index,
    createdAt: str(record.createdAt),
    revoked: record.revoked === true,
    revokedAt: str(record.revokedAt),
    deviceInfo,
  };
};

/**
 * Lists the signed-in user's devices. `sessionToken`: the bearer, or `null`
 * to use the last completed flow's token (kept native). Rejects with
 * `HawcxServiceError` (`session_required`, `session_expired`, `rate_limited`, ...).
 */
export function v6ListDevices(sessionToken?: string | null): Promise<HawcxV6DeviceSummary[]> {
  return withServiceErrors(() =>
    HawcxReactNative.v6ListDevices(normalizeSessionTokenArg(sessionToken)),
  ).then((value) =>
    Array.isArray(value)
      ? value
          .map(normalizeDeviceSummary)
          .filter((item): item is HawcxV6DeviceSummary => Boolean(item))
      : [],
  );
}

/**
 * Revokes one of the user's devices (`cannot_revoke_current_device` for this
 * one). `sessionToken` as in `v6ListDevices`.
 */
export function v6RevokeDevice(
  sessionToken: string | null | undefined,
  deviceId: string,
  reason?: string,
): Promise<void> {
  try {
    const id = ensureNonEmpty(deviceId, 'deviceId');
    return withServiceErrors(() =>
      HawcxReactNative.v6RevokeDevice(
        normalizeSessionTokenArg(sessionToken),
        id,
        reason?.trim() || null,
      ),
    ).then(() => undefined);
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Ends every session of the user, including this one. `sessionToken` as in `v6ListDevices`. */
export function v6LogoutEverywhere(
  sessionToken?: string | null,
): Promise<{ sessionsEnded: number }> {
  return withServiceErrors(() =>
    HawcxReactNative.v6LogoutEverywhere(normalizeSessionTokenArg(sessionToken)),
  ).then((value) => ({
    sessionsEnded: typeof value?.sessionsEnded === 'number' ? value.sessionsEnded : 0,
  }));
}

/**
 * Opens a `redirect` step's URL (social / external IdP, hosted login). iOS:
 * ASWebAuthenticationSession with `returnScheme` (required there), whose
 * callback is handed to the flow before this resolves. Android: Custom Tabs
 * (browser fallback); resolves once the page is open, and the callback comes
 * back through the app's intent filter: pass it to `v6HandleRedirectUrl`.
 * Rejects with `HawcxServiceError` (`redirect_cancelled`, `invalid_callback`,
 * `invalid_url`, `no_browser`, `redirect_failed`).
 */
export function v6LaunchRedirect(
  url: string,
  returnScheme?: string,
): Promise<HawcxV6RedirectLaunch> {
  try {
    const target = ensureNonEmpty(url, 'url');
    return withServiceErrors(() =>
      HawcxReactNative.v6LaunchRedirect(target, returnScheme?.trim() || null),
    ).then((value) => {
      const launchedWith = value?.launchedWith;
      if (
        launchedWith === 'auth_session' ||
        launchedWith === 'custom_tab' ||
        launchedWith === 'browser'
      ) {
        return { launchedWith };
      }
      throw new Error('Invalid V6 redirect launch response from native bridge');
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

/**
 * Holds background polling on the current waiting screen (`await_approval`, or
 * the magic-link code screen). The native SDKs already pause by themselves when
 * the app goes to the background and resume when it returns; this is for manual
 * control (e.g. while a modal covers the waiting screen). A poll already in
 * flight still completes. Idempotent; resolves without effect before
 * `initialize`.
 */
export function v6PausePolling(): Promise<void> {
  return HawcxReactNative.v6PausePolling();
}

/**
 * Resumes polling held by `v6PausePolling`. A poll that fell due meanwhile goes
 * out straight away. Idempotent; resolves without effect before `initialize`.
 */
export function v6ResumePolling(): Promise<void> {
  return HawcxReactNative.v6ResumePolling();
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
  const result = await withServiceErrors(() =>
    HawcxReactNative.v6ApproveQr(
      trimmedPayload,
      trimmedIdentifier,
      options.rememberDevice ?? false,
    ),
  );
  return normalizeV6QrApprovalResult(result);
}

// MARK: - Approver (approvals v2)

const localServiceError = (code: string, message: string) =>
  new HawcxServiceError({ code, message, retryable: false });

const buildPushRegistration = (input: HawcxV6PushRegistrationInput): Record<string, unknown> => {
  if (!input || typeof input !== 'object') {
    throw localServiceError('invalid_registration', 'registration is required');
  }
  const appId = typeof input.appId === 'string' ? input.appId.trim() || undefined : undefined;
  if (input.provider === 'fcm' && typeof input.token !== 'string') {
    throw localServiceError('invalid_registration', 'FCM token must be a string');
  }
  if (
    input.provider === 'apns' &&
    typeof input.token !== 'string' &&
    !(input.token instanceof Uint8Array) &&
    !Array.isArray(input.token)
  ) {
    throw localServiceError('invalid_registration', 'APNs token must be a hex string or bytes');
  }
  if (input.provider === 'apns') {
    if (!isIOS()) {
      throw localServiceError('invalid_registration', 'APNs tokens are registered on iOS only');
    }
    return compact({
      provider: 'apns',
      token: (() => {
        try {
          return apnsTokenHex(input.token);
        } catch (error) {
          throw localServiceError('invalid_registration', (error as Error).message);
        }
      })(),
      apnsEnv: input.apnsEnv,
      appId,
    });
  }
  if (input.provider === 'fcm') {
    if (!isAndroid()) {
      throw localServiceError('invalid_registration', 'FCM tokens are registered on Android only');
    }
    return compact({ provider: 'fcm', token: input.token.trim(), appId });
  }
  throw localServiceError('invalid_registration', 'provider must be apns or fcm');
};

/**
 * Registers this device's push token (device-signed) for every enrolled
 * identifier of this project, so approvals reach it. Call after each sign-in and
 * whenever the token changes. Identifiers already registered with the same
 * token are skipped unless `force`. Rejects with `HawcxServiceError`
 * (`invalid_registration`, `unknown_app`, `device_not_found`, `keychain_unavailable`, ...).
 */
export function registerPushTokenWithReport(
  input: HawcxV6PushRegistrationInput,
  force = false,
): Promise<HawcxV6PushRegistrationReport> {
  try {
    const registration = buildPushRegistration(input);
    return withServiceErrors(() => HawcxReactNative.v6RegisterPushToken(registration, force)).then(
      (value) => ({
        registered: typeof value?.registered === 'number' ? value.registered : 0,
        orphanedIdentifiers: Array.isArray(value?.orphanedIdentifiers)
          ? value.orphanedIdentifiers.filter((item): item is string => typeof item === 'string')
          : [],
      }),
    );
  } catch (error) {
    return Promise.reject(error);
  }
}

/** `registerPushTokenWithReport` without the orphan report. */
export function registerPushToken(
  input: HawcxV6PushRegistrationInput,
  force = false,
): Promise<{ registered: number }> {
  return registerPushTokenWithReport(input, force).then(({ registered }) => ({ registered }));
}

/**
 * Removes this app's push registration: for every identifier registered from
 * this install, for one `identifier`, or (with `appId`) for that identifier and
 * app even without a local record. Call it BEFORE signing out or clearing device
 * keys: it is signed with the device key. Rejects with `push_not_registered`
 * when nothing was registered from here (treat as "nothing to do"),
 * `device_not_enrolled`, or `keychain_unavailable` (retryable).
 */
export function unregisterPushToken(target?: string | HawcxV6UnregisterPushOptions): Promise<void> {
  try {
    let identifier: string | null = null;
    let appId: string | null = null;
    if (typeof target === 'string') {
      identifier = target.trim() || null;
    } else if (target) {
      identifier = target.identifier?.trim() || null;
      appId = target.appId?.trim() || null;
      if (appId && !identifier) {
        throw new Error('identifier is required with appId');
      }
    }
    return withServiceErrors(() => HawcxReactNative.v6UnregisterPushToken(identifier, appId)).then(
      () => undefined,
    );
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * The approval a push points at, or null (not a Hawcx v2 push, or already
 * expired). Pass the APNs `userInfo` / notification data (iOS) or the FCM data
 * map (Android); an FCM message `{data: {hawcx}}` is unwrapped. No network call.
 * Show nothing from the push itself: fetch the context.
 */
export function approvalReferenceFromPush(
  payload: Record<string, unknown>,
): Promise<HawcxV6ApprovalReference | null> {
  const data =
    payload && payload.hawcx === undefined && typeof payload.data === 'object' && payload.data
      ? (payload.data as Record<string, unknown>)
      : payload;
  if (!data || typeof data !== 'object') {
    return Promise.resolve(null);
  }
  return withServiceErrors(() => HawcxReactNative.v6ApprovalReferenceFromPush(data)).then(
    normalizeApprovalReference,
  );
}

/**
 * Reads a scanned QR: `{version: 2, reference}` for approvals v2 (fetch the
 * context next), `{version: 1, payloadType}` for a 6.0.x QR (confirm with the
 * user, then `approveV6Qr`), null for anything else. No network call.
 */
export function scanApproval(raw: string): Promise<HawcxV6ScannedApproval | null> {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return Promise.resolve(null);
  }
  return withServiceErrors(() => HawcxReactNative.v6ScanApproval(trimmed)).then(
    normalizeScannedApproval,
  );
}

/**
 * Fetches what to show for an approval (who is asking, whether a number is
 * required). push / qr_auth try the enrolled identifiers (most recently used
 * first) unless `identifier` is given; qr_login needs the `identifier` the user
 * picked from `enrolledIdentifiers()`. Rejects with `HawcxServiceError`
 * (`approval_expired`, `identifier_required`, `device_not_enrolled`,
 * `project_mismatch`, `approval_not_found`, `approval_resolved` with
 * `outcome`, `unsupported_approval_version`, `account_locked`, `rate_limited`, ...).
 */
export function fetchApprovalContext(
  reference: HawcxV6ApprovalReference,
  identifier?: string,
): Promise<HawcxV6ApprovalRequest> {
  return withServiceErrors(() =>
    HawcxReactNative.v6FetchApprovalContext(reference, identifier?.trim() || null),
  ).then(normalizeApprovalRequest);
}

/**
 * Approves or denies a fetched approval. Approve needs the number the user typed
 * when `numberRequired` (never fill it in); deny ignores it. Gate approve
 * behind the device owner (biometrics / passcode) in the app. Resolves
 * `approved`, `denied`, `wrong_number`, or `resolved` (already over). Rejects
 * with `number_required`, `invalid_number`, `approval_expired`,
 * `approval_handle_unknown`, or a retryable server error.
 */
export function decideApproval(
  handle: string,
  decision: HawcxV6ApprovalDecision,
  options: { numberChoice?: number; rememberDevice?: boolean } = {},
): Promise<HawcxV6ApprovalResult> {
  try {
    const key = ensureNonEmpty(handle, 'handle');
    if (decision !== 'approve' && decision !== 'deny') {
      throw new Error('decision must be approve or deny');
    }
    let numberChoice: number | null = null;
    if (decision === 'approve' && options.numberChoice !== undefined) {
      if (!Number.isInteger(options.numberChoice)) {
        throw localServiceError('invalid_number', 'The number has two digits');
      }
      numberChoice = options.numberChoice;
    }
    return withServiceErrors(() =>
      HawcxReactNative.v6DecideApproval(
        key,
        decision,
        numberChoice,
        options.rememberDevice ?? false,
      ),
    ).then(normalizeApprovalResult);
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Drops a fetched approval from the native cache (e.g. the user dismissed it). */
export function discardApproval(handle: string): Promise<void> {
  if (typeof handle !== 'string' || !handle) {
    return Promise.resolve();
  }
  return withServiceErrors(() => HawcxReactNative.v6DiscardApproval(handle)).then(() => undefined);
}

/**
 * Identifiers enrolled on this device for this project, most recently used first.
 * Rejects with retryable `keychain_unavailable` (both platforms) while the device
 * keys can't be read, e.g. the device is locked: that is not "not enrolled".
 */
export function enrolledIdentifiers(): Promise<string[]> {
  return withServiceErrors(() => HawcxReactNative.v6EnrolledIdentifiers()).then((value) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
  );
}

export function v6HandleRedirectUrl(url: string): Promise<void> {
  try {
    return HawcxReactNative.v6HandleRedirectUrl(ensureNonEmpty(url, 'url'));
  } catch (error) {
    return Promise.reject(error);
  }
}

const normalizeV6MagicLinkRedirectOutcome = (value: unknown): HawcxV6MagicLinkRedirectOutcome => {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    switch (record.outcome) {
      case 'not_magic_link':
      case 'resumed':
      case 'handed_off':
        return { outcome: record.outcome };
      case 'failed':
        return {
          outcome: 'failed',
          code: typeof record.code === 'string' && record.code ? record.code : 'unknown_error',
          message: typeof record.message === 'string' ? record.message : '',
          retryable: record.retryable === true,
        };
      default:
        break;
    }
  }
  throw new Error('Invalid V6 magic-link redirect response from native bridge');
};

/**
 * Finishes a magic-link sign-in from the landing URL the app was opened with
 * (Universal Link / App Link). Pass every incoming URL; non-magic-link URLs
 * resolve `{ outcome: 'not_magic_link' }` without a network call. Call
 * `initialize` first (after a cold start too): the saved flow is keyed by the
 * project. On `resumed` the flow continues through the V6 flow events.
 */
export async function completeHawcxMagicLinkRedirect(
  url: string,
): Promise<HawcxV6MagicLinkRedirectOutcome> {
  const result = await HawcxReactNative.v6CompleteMagicLinkRedirect(ensureNonEmpty(url, 'url'));
  return normalizeV6MagicLinkRedirectOutcome(result);
}

export const v6CompleteMagicLinkRedirect = completeHawcxMagicLinkRedirect;

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

const warnedDeprecations = new Set<string>();

const warnDeprecated = (name: string, replacement: string) => {
  if (warnedDeprecations.has(name)) {
    return;
  }
  warnedDeprecations.add(name);

  console.warn(`[Hawcx] ${name} is deprecated: use ${replacement} (approvals v2).`);
};

/** @internal */
export const __resetDeprecationWarningsForTests = () => warnedDeprecations.clear();

/** @deprecated Legacy v4 push. Use `registerPushToken({provider: 'apns', ...})`. */
export function setApnsDeviceToken(tokenData: Uint8Array | number[]): Promise<void> {
  warnDeprecated('setApnsDeviceToken', 'registerPushToken');
  if (!isIOS()) {
    return Promise.resolve();
  }
  try {
    return HawcxReactNative.setApnsDeviceToken(bytesToBase64(tokenData, 'tokenData'));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** @deprecated Legacy v4 push. Use `registerPushToken({provider: 'fcm', ...})`. */
export function setFcmToken(token: string): Promise<void> {
  warnDeprecated('setFcmToken', 'registerPushToken');
  if (!isAndroid()) {
    return Promise.resolve();
  }
  try {
    return HawcxReactNative.setFcmToken(ensureNonEmpty(token, 'token'));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** @deprecated Legacy v4 push. Use `registerPushToken`. */
export function setPushDeviceToken(token: Uint8Array | number[] | string): Promise<void> {
  warnDeprecated('setPushDeviceToken', 'registerPushToken');
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

/** @deprecated Legacy v4 push. Use `approvalReferenceFromPush` + `fetchApprovalContext`. */
export function handlePushNotification(payload: Record<string, unknown>): Promise<boolean> {
  warnDeprecated('handlePushNotification', 'approvalReferenceFromPush');
  return HawcxReactNative.handlePushNotification(payload);
}

/** @deprecated Legacy v4 push. Use `decideApproval(handle, 'approve', ...)`. */
export function approvePushRequest(requestId: string): Promise<void> {
  warnDeprecated('approvePushRequest', 'decideApproval');
  try {
    return HawcxReactNative.approvePushRequest(ensureNonEmpty(requestId, 'requestId'));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** @deprecated Legacy v4 push. Use `decideApproval(handle, 'deny')`. */
export function declinePushRequest(requestId: string): Promise<void> {
  warnDeprecated('declinePushRequest', 'decideApproval');
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

  /** See `v6PausePolling`. */
  pausePolling(): Promise<void> {
    return v6PausePolling();
  }

  /** See `v6ResumePolling`. */
  resumePolling(): Promise<void> {
    return v6ResumePolling();
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

  completeMagicLinkRedirect(url: string): Promise<HawcxV6MagicLinkRedirectOutcome> {
    return completeHawcxMagicLinkRedirect(url);
  }

  /** See `startV6QrLogin`. */
  startQrLogin(options?: { codeChallenge?: string }): Promise<void> {
    return startV6QrLogin(options);
  }

  /** See `v6BackToMethodSelection`. */
  backToMethodSelection(): Promise<boolean> {
    return v6BackToMethodSelection();
  }

  /** See `v6GetSessionToken` (a secret: never log it). */
  getSessionToken(): Promise<string | null> {
    return v6GetSessionToken();
  }

  /** See `v6ListDevices`. */
  listDevices(sessionToken?: string | null): Promise<HawcxV6DeviceSummary[]> {
    return v6ListDevices(sessionToken);
  }

  /** See `v6RevokeDevice`. */
  revokeDevice(
    sessionToken: string | null | undefined,
    deviceId: string,
    reason?: string,
  ): Promise<void> {
    return v6RevokeDevice(sessionToken, deviceId, reason);
  }

  /** See `v6LogoutEverywhere`. */
  logoutEverywhere(sessionToken?: string | null): Promise<{ sessionsEnded: number }> {
    return v6LogoutEverywhere(sessionToken);
  }

  /** See `v6LaunchRedirect`. */
  launchRedirect(url: string, returnScheme?: string): Promise<HawcxV6RedirectLaunch> {
    return v6LaunchRedirect(url, returnScheme);
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
      if (startOptions.method === 'qr_login') {
        setState((previous) => createIdentifierHawcxV6AuthState({ previous, flowType: 'signin' }));
        return client.start(startOptions);
      }
      const identifier = ensureNonEmpty(startOptions.identifier ?? '', 'identifier');
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

  const startQrLogin = useCallback(
    (qrOptions: { codeChallenge?: string } = {}) =>
      start({ method: 'qr_login', codeChallenge: qrOptions.codeChallenge }),
    [start],
  );

  const backToMethodSelection = useCallback(() => client.backToMethodSelection(), [client]);

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
  const pausePolling = useCallback(() => client.pausePolling(), [client]);
  const resumePolling = useCallback(() => client.resumePolling(), [client]);

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

  const completeMagicLinkRedirect = useCallback(
    async (url: string) => {
      const outcome = await client.completeMagicLinkRedirect(url);
      setState((previous) => applyHawcxV6MagicLinkRedirect(previous, outcome));
      return outcome;
    },
    [client],
  );

  return {
    state,
    start,
    selectMethod,
    submitCode,
    submitTotp,
    submitPhone,
    resend,
    poll,
    pausePolling,
    resumePolling,
    cancel,
    changeIdentifier,
    reset,
    handleRedirectUrl,
    completeMagicLinkRedirect,
    backToMethodSelection,
    startQrLogin,
    canResend: state.resend.canResend,
    resendAvailability: state.resend,
    secondsUntilResend: state.resend.secondsUntilResend,
  };
}

export type HawcxApproverHookResult = {
  /** The fetched approval being shown, if any. */
  request?: HawcxV6ApprovalRequest;
  /** Result of the last decision. */
  result?: HawcxV6ApprovalResult;
  /** Last error of fetch / approve / deny. */
  error?: HawcxServiceError;
  loading: boolean;
  /** Fetches the context for a reference (from a push or a scan). */
  fetch: (
    reference: HawcxV6ApprovalReference,
    identifier?: string,
  ) => Promise<HawcxV6ApprovalRequest>;
  /**
   * Approves the request with `handle`: pass the handle of the request the user
   * saw and confirmed (capture `request.handle` before any confirm dialog).
   * Rejects with `approval_handle_unknown`, without sending anything, when the
   * current request is no longer that one (e.g. a newer push replaced it while
   * the dialog was open). `numberChoice` is the number the user typed (when
   * `request.numberRequired`).
   */
  approve: (
    handle: string,
    numberChoice?: number,
    options?: { rememberDevice?: boolean },
  ) => Promise<HawcxV6ApprovalResult>;
  /** Denies the request with `handle`; same handle check as `approve`. */
  deny: (handle: string) => Promise<HawcxV6ApprovalResult>;
  /** Clears the hook and discards the native cache entry. */
  reset: () => Promise<void>;
};

/**
 * Approver screen state (separate from the requester's `useHawcxV6Auth`).
 * Approve / deny reject (and set `error`) on failure; the request stays so a
 * retryable error can be retried.
 */
export function useHawcxApprover(): HawcxApproverHookResult {
  const [request, setRequest] = useState<HawcxV6ApprovalRequest | undefined>();
  const [result, setResult] = useState<HawcxV6ApprovalResult | undefined>();
  const [error, setError] = useState<HawcxServiceError | undefined>();
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<HawcxV6ApprovalRequest | undefined>();

  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T> => {
    setLoading(true);
    setError(undefined);
    try {
      return await work();
    } catch (caught) {
      const mapped = toHawcxServiceError(caught);
      setError(mapped);
      throw mapped;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetch = useCallback(
    (reference: HawcxV6ApprovalReference, identifier?: string) =>
      run(async () => {
        setResult(undefined);
        // The previous request is replaced: drop it now, so a decision for it
        // can't be sent and its native cache entry doesn't wait for expiry.
        const previous = requestRef.current;
        requestRef.current = undefined;
        setRequest(undefined);
        if (previous) {
          await discardApproval(previous.handle).catch(() => undefined);
        }
        const fetched = await fetchApprovalContext(reference, identifier);
        requestRef.current = fetched;
        setRequest(fetched);
        return fetched;
      }),
    [run],
  );

  const decide = useCallback(
    (
      handle: string,
      decision: HawcxV6ApprovalDecision,
      numberChoice?: number,
      rememberDevice?: boolean,
    ) =>
      run(async () => {
        const current = requestRef.current;
        if (!current) {
          throw new HawcxServiceError({
            code: 'approval_handle_unknown',
            message: 'Fetch an approval first',
          });
        }
        if (typeof handle !== 'string' || !handle || current.handle !== handle) {
          // Bound to what the user confirmed: never decide a request that
          // replaced it in the meantime.
          throw new HawcxServiceError({
            code: 'approval_handle_unknown',
            message: 'The approval changed; show the current one and confirm again',
          });
        }
        const decided = await decideApproval(current.handle, decision, {
          numberChoice,
          rememberDevice,
        });
        setResult(decided);
        return decided;
      }),
    [run],
  );

  const approve = useCallback(
    (handle: string, numberChoice?: number, options?: { rememberDevice?: boolean }) =>
      decide(handle, 'approve', numberChoice, options?.rememberDevice),
    [decide],
  );

  const deny = useCallback((handle: string) => decide(handle, 'deny'), [decide]);

  const reset = useCallback(async () => {
    const current = requestRef.current;
    requestRef.current = undefined;
    setRequest(undefined);
    setResult(undefined);
    setError(undefined);
    setLoading(false);
    if (current) {
      await discardApproval(current.handle);
    }
  }, []);

  // Don't leave the fetched request in the native cache after the screen goes.
  useEffect(
    () => () => {
      const current = requestRef.current;
      requestRef.current = undefined;
      if (current) {
        discardApproval(current.handle).catch(() => undefined);
      }
    },
    [],
  );

  return { request, result, error, loading, fetch, approve, deny, reset };
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
