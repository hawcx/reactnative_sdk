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
  retryAfterSeconds?: number;
  retryAt?: string;
  attemptsRemaining?: number;
  errors?: HawcxV6FieldError[];
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
  };
};

/**
 * A step this SDK version doesn't model (a newer server, or a native prompt the
 * bridge doesn't map yet). `rawType` is the server step type in snake_case.
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
  | HawcxV6UnknownPrompt;

export type HawcxV6CompletedPayload = {
  session: string;
  authCode: string;
  expiresAt: string;
  codeVerifier?: string;
  traceId?: string;
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
  | { type: 'error'; payload: HawcxV6ErrorPayload };

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
};

export type HawcxV6StartOptions = {
  identifier: string;
  flowType?: HawcxV6FlowType;
  startToken?: string;
  inviteCode?: string;
  codeChallenge?: string;
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
