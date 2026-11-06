export type HawcxV6FlowType = 'signin' | 'signup' | 'account_manage';

export type HawcxV6AuthStatus =
  | 'identifier'
  | 'loading'
  | 'select_method'
  | 'enter_code'
  | 'setup_sms'
  | 'setup_totp'
  | 'enter_totp'
  | 'redirect'
  | 'await_approval'
  | 'locked'
  | 'unknown'
  | 'completed'
  | 'error';

export type HawcxV6Method = {
  id: string;
  label: string;
  icon?: string;
};

export type HawcxV6StepInfo = {
  id: string;
  label?: string;
};

export type HawcxV6RiskLocation = {
  city?: string;
  country?: string;
};

export type HawcxV6RiskInfo = {
  detected: boolean;
  reasons: string[];
  message?: string;
  location?: HawcxV6RiskLocation;
  riskScore?: number;
};

export type HawcxV6FieldError = {
  field: string;
  message: string;
};

export type HawcxV6ErrorDetails = {
  /** From the step or the `Retry-After` header (425, 429, gateway 429 `rate_limited`). */
  retryAfterSeconds?: number;
  retryAt?: string;
  attemptsRemaining?: number;
  errors?: HawcxV6FieldError[];
  /** `approval_resolved`: approved, denied, expired, wrong_number, superseded or blocked. */
  outcome?: string;
  /** `approval_resolved`: whether this device made the decision. */
  decidedByThisDevice?: boolean;
};

/**
 * A non-fatal notice riding along with a step, e.g. `device_revoked`, or
 * `unauthorized_device` after the native SDK cleared this device's revoked
 * keys and restarted the flow once.
 */
export type HawcxV6Notice = {
  code: string;
  message: string;
};

/** Requester outcomes that end an `await_approval` (they arrive as error events). */
export type HawcxV6ApprovalOutcomeCode =
  | 'approval_denied'
  | 'approval_wrong_number'
  | 'approval_superseded'
  | 'approval_blocked';

/** Approvals v2 fields of an `await_approval` step (absent for v1 approvals). */
export type HawcxV6ApprovalDisplay = {
  mode?: 'push' | 'qr';
  approvalId?: string;
  /** Number-matching code (10-99) to show large; the user types it on the approving phone. */
  number?: number;
  /**
   * QR mode only: the 8-digit type-in code (e.g. `48217093`) to show under the
   * QR for a phone that can't scan it; that phone sends it to
   * `resolveApprovalCode`. Absent for push, on servers that don't send it, and
   * when the value isn't exactly 8 ASCII digits. Show it, never log it.
   */
  manualCode?: string;
};

export type HawcxV6PromptBase = {
  session: string;
  traceId?: string;
  expiresAt: string;
  step?: HawcxV6StepInfo;
  risk?: HawcxV6RiskInfo;
  codeChannel?: string;
  /**
   * Poll route the server advertised on a waiting step (`await_approval`, or a
   * magic-link `enter_code` should a server send it), relative to the API base,
   * e.g. `/v1/auth/poll`. Absent on older servers. Informational only: the
   * native SDK polls by itself (2s for 30s, then 5s to 2 min, then 10s; it
   * honours Retry-After and keeps the flow on a 429) and pauses while the app
   * is in the background.
   */
  pollPath?: string;
  /** Top-level notice that came with this step (see `HawcxV6Notice`). */
  notice?: HawcxV6Notice;
};

export type HawcxV6SelectMethodPrompt = HawcxV6PromptBase & {
  prompt: {
    type: 'select_method';
    methods: HawcxV6Method[];
    phase?: string;
  };
};

export type HawcxV6EnterCodePrompt = HawcxV6PromptBase & {
  prompt: {
    type: 'enter_code';
    destination: string;
    codeLength?: number;
    codeFormat?: string;
    codeExpiresAt?: string;
    resendAt?: string;
    /**
     * Seconds between background polls. Present on the magic-link code screen:
     * the native SDK polls while this prompt shows, so the flow can complete
     * (a `completed` event) when the link is confirmed on another device.
     */
    pollInterval?: number;
  };
};

export type HawcxV6EnterTotpPrompt = HawcxV6PromptBase & {
  prompt: {
    type: 'enter_totp';
  };
};

export type HawcxV6SetupTotpPrompt = HawcxV6PromptBase & {
  prompt: {
    type: 'setup_totp';
    secret: string;
    otpauthUrl: string;
    period?: number;
    /** Recovery codes (`XXXX-XXXX`) to show once. Secret: never log them. */
    backupCodes?: string[];
  };
};

export type HawcxV6SetupSmsPrompt = HawcxV6PromptBase & {
  prompt: {
    type: 'setup_sms';
    existingPhone?: string;
  };
};

export type HawcxV6RedirectPrompt = HawcxV6PromptBase & {
  prompt: {
    type: 'redirect';
    url: string;
    returnScheme?: string;
  };
};

export type HawcxV6AwaitApprovalPrompt = HawcxV6PromptBase & {
  prompt: {
    type: 'await_approval';
    qrData?: string;
    expiresAt: string;
    pollInterval: number;
  } & HawcxV6ApprovalDisplay;
};

/**
 * Too many failed attempts. Show the wait; nothing is polled or retried. Start
 * again after `lockedUntil`.
 */
export type HawcxV6LockedPrompt = HawcxV6PromptBase & {
  prompt: {
    type: 'locked';
    retryAfterSeconds: number;
    lockedUntil: string;
  };
};

/**
 * A step this SDK version doesn't model (a newer server, or a native prompt the
 * bridge doesn't map yet), or a known step that arrived malformed (e.g. an
 * `await_approval` without `expiresAt`). `rawType` is the step type in
 * snake_case, for display and logs only: on iOS it comes from the native case
 * name, on Android from the native prompt class name (kept under R8 by the
 * consumer rules). Don't branch on it.
 * Show a generic "update the app" or restart screen; never auto-retry.
 */
export type HawcxV6UnknownPrompt = HawcxV6PromptBase & {
  prompt: {
    type: 'unknown';
    rawType: string;
  };
};

export type HawcxV6PromptPayload =
  | HawcxV6SelectMethodPrompt
  | HawcxV6EnterCodePrompt
  | HawcxV6EnterTotpPrompt
  | HawcxV6SetupTotpPrompt
  | HawcxV6SetupSmsPrompt
  | HawcxV6RedirectPrompt
  | HawcxV6AwaitApprovalPrompt
  | HawcxV6LockedPrompt
  | HawcxV6UnknownPrompt;

export type HawcxV6CompletedPayload = {
  session: string;
  authCode: string;
  expiresAt: string;
  codeVerifier?: string;
  traceId?: string;
  /**
   * The flow returned a session token (the bearer for the device APIs). The
   * token itself stays native: pass `null` to `listDevices` / `revokeDevice` /
   * `logoutEverywhere`, or read it with `getSessionToken()`.
   */
  hasSessionToken?: boolean;
  /**
   * Who the flow signed in as: the identifier passed to `start` (trimmed), or,
   * for an anonymous QR sign-in (`startQrLogin`), the account the approving
   * phone chose, which this device is now enrolled under. Absent when the
   * server completed a QR sign-in without naming the user. `state.identifier`
   * takes this value on completion.
   */
  identifier?: string;
};

export type HawcxV6ErrorAction =
  | 'retry_input'
  | 'restart_flow'
  | 'wait'
  | 'retry_request'
  | 'abort'
  | 'resend_code'
  | 'select_method'
  | string;

export type HawcxV6ErrorPayload = {
  session?: string;
  code: string;
  action?: HawcxV6ErrorAction;
  message: string;
  retryable: boolean;
  details?: HawcxV6ErrorDetails;
  traceId?: string;
};

export type HawcxV6FlowEvent =
  | { type: 'idle' }
  | { type: 'loading'; payload: { session?: string } }
  | { type: 'prompt'; payload: HawcxV6PromptPayload }
  | { type: 'completed'; payload: HawcxV6CompletedPayload }
  | { type: 'error'; payload: HawcxV6ErrorPayload }
  | { type: 'notice'; payload: HawcxV6Notice };

export type HawcxV6ResendAvailability = {
  canResend: boolean;
  resendAt?: string;
  secondsUntilResend?: number;
};

export type HawcxV6AuthState = {
  status: HawcxV6AuthStatus;
  flowType: HawcxV6FlowType;
  identifier?: string;
  session?: string;
  traceId?: string;
  expiresAt?: string;
  step?: HawcxV6StepInfo;
  risk?: HawcxV6RiskInfo;
  codeChannel?: string;
  prompt?: HawcxV6PromptPayload;
  completed?: HawcxV6CompletedPayload;
  error?: HawcxV6ErrorPayload;
  resend: HawcxV6ResendAvailability;
  isLoading: boolean;
  requiresRedirect: boolean;
  awaitingApproval: boolean;
  /**
   * True while the code screen is up and the native SDK polls in the background
   * for a magic-link confirmation (enter_code with `pollInterval`).
   */
  magicLinkPolling: boolean;
  /** Last result of `completeMagicLinkRedirect` (cleared on a new start/reset). */
  magicLinkRedirect?: HawcxV6MagicLinkRedirectOutcome;
  /** Set while the `locked` step shows. */
  locked?: { retryAfterSeconds: number; lockedUntil: string };
  /** Last notice of this flow (cleared by a new start / reset). */
  notice?: HawcxV6Notice;
  /** Approvals v2 display of the current or last `await_approval`. */
  approval?: HawcxV6ApprovalDisplay;
  /** Set on an error event whose code ends an approval. */
  approvalOutcome?: HawcxV6ApprovalOutcomeCode;
};

export type HawcxV6StartOptions = {
  /** Required, except with `method: 'qr_login'` (which must omit it). */
  identifier?: string;
  flowType?: HawcxV6FlowType;
  startToken?: string;
  inviteCode?: string;
  codeChallenge?: string;
  /** OIDC scope the relying party requests. */
  scope?: string;
  /** Internal hosted-login surfaces: `samlreq_<lowercase hex>` (validated natively). */
  samlReqId?: string;
  /**
   * `qr_login`: anonymous QR sign-in (signin, no identifier). Show the
   * `await_approval` step's `qrData` as a QR code for a signed-in phone.
   */
  method?: 'qr_login';
};

/** One of the signed-in user's devices (`POST /v1/users/me/devices/list`). */
export type HawcxV6DeviceSummary = {
  deviceId: string;
  h2index: string;
  createdAt?: string;
  revoked: boolean;
  revokedAt?: string;
  deviceInfo?: Record<string, unknown>;
};

/**
 * How `launchRedirect` opened the URL. `auth_session` (iOS): the
 * ASWebAuthenticationSession finished and its callback was handed to the flow.
 * `custom_tab` / `browser` (Android): the page is open; the callback comes back
 * through the app's intent filter, so pass it to `handleRedirectUrl`.
 */
export type HawcxV6RedirectLaunch = {
  launchedWith: 'auth_session' | 'custom_tab' | 'browser';
};

/**
 * Result of `completeMagicLinkRedirect(url)`:
 * - `not_magic_link`: the URL has no `hawcx_magic_link` param; route it elsewhere.
 * - `resumed`: this app started the sign-in; it continues through the flow events.
 * - `handed_off`: the sign-in was started elsewhere; that window finishes it.
 * - `failed`: expired or already used, or (when `retryable`) temporarily unavailable.
 */
export type HawcxV6MagicLinkRedirectOutcome =
  | { outcome: 'not_magic_link' }
  | { outcome: 'resumed' }
  | { outcome: 'handed_off' }
  | { outcome: 'failed'; code: string; message: string; retryable: boolean };
