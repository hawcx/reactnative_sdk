import type {
  HawcxV6AuthState,
  HawcxV6CompletedPayload,
  HawcxV6ErrorPayload,
  HawcxV6FlowEvent,
  HawcxV6FlowType,
  HawcxV6PromptPayload,
  HawcxV6ResendAvailability,
} from './v6Types';

const DEFAULT_FLOW_TYPE: HawcxV6FlowType = 'signin';

const EMPTY_RESEND_STATE: HawcxV6ResendAvailability = {
  canResend: false,
};

const isFiniteTimestamp = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isEnterCodePrompt = (
  prompt: HawcxV6PromptPayload | undefined,
): prompt is Extract<HawcxV6PromptPayload, { prompt: { type: 'enter_code' } }> =>
  prompt?.prompt.type === 'enter_code';

export const normalizeHawcxV6FlowType = (value?: HawcxV6FlowType): HawcxV6FlowType => {
  switch (value) {
    case 'signup':
    case 'account_manage':
      return value;
    case 'signin':
    default:
      return DEFAULT_FLOW_TYPE;
  }
};

export const getHawcxV6ResendAvailability = (
  prompt?: HawcxV6PromptPayload,
  nowMs: number = Date.now(),
): HawcxV6ResendAvailability => {
  if (!isEnterCodePrompt(prompt)) {
    return EMPTY_RESEND_STATE;
  }

  const resendAt = prompt.prompt.resendAt;
  const resendTimestamp = isFiniteTimestamp(resendAt);

  if (resendTimestamp === null) {
    return {
      canResend: true,
      resendAt,
      secondsUntilResend: 0,
    };
  }

  const diffMs = resendTimestamp - nowMs;
  if (diffMs <= 0) {
    return {
      canResend: true,
      resendAt,
      secondsUntilResend: 0,
    };
  }

  return {
    canResend: false,
    resendAt,
    secondsUntilResend: Math.ceil(diffMs / 1000),
  };
};

export const canHawcxV6Resend = (
  promptOrState?: HawcxV6PromptPayload | HawcxV6AuthState,
  nowMs: number = Date.now(),
): boolean => {
  if (!promptOrState) {
    return false;
  }

  const prompt = 'status' in promptOrState ? promptOrState.prompt : promptOrState;

  return getHawcxV6ResendAvailability(prompt, nowMs).canResend;
};

export const createInitialHawcxV6AuthState = (flowType?: HawcxV6FlowType): HawcxV6AuthState => ({
  status: 'identifier',
  flowType: normalizeHawcxV6FlowType(flowType),
  resend: EMPTY_RESEND_STATE,
  isLoading: false,
  requiresRedirect: false,
  awaitingApproval: false,
});

export const createIdentifierHawcxV6AuthState = ({
  previous,
  identifier,
  flowType,
}: {
  previous?: HawcxV6AuthState;
  identifier?: string;
  flowType?: HawcxV6FlowType;
} = {}): HawcxV6AuthState => ({
  status: 'identifier',
  flowType: normalizeHawcxV6FlowType(flowType ?? previous?.flowType),
  identifier,
  resend: EMPTY_RESEND_STATE,
  isLoading: false,
  requiresRedirect: false,
  awaitingApproval: false,
});

const reducePromptState = (
  prompt: HawcxV6PromptPayload,
  previous: HawcxV6AuthState,
  nowMs: number,
): HawcxV6AuthState => {
  const resend = getHawcxV6ResendAvailability(prompt, nowMs);

  return {
    status: prompt.prompt.type,
    flowType: previous.flowType,
    identifier: previous.identifier,
    session: prompt.session,
    traceId: prompt.traceId,
    expiresAt: prompt.expiresAt,
    step: prompt.step,
    risk: prompt.risk,
    codeChannel: prompt.codeChannel,
    prompt,
    completed: undefined,
    error: undefined,
    resend,
    isLoading: false,
    requiresRedirect: prompt.prompt.type === 'redirect',
    awaitingApproval: prompt.prompt.type === 'await_approval',
  };
};

const reduceCompletedState = (
  completed: HawcxV6CompletedPayload,
  previous: HawcxV6AuthState,
): HawcxV6AuthState => ({
  status: 'completed',
  flowType: previous.flowType,
  identifier: previous.identifier,
  session: completed.session,
  traceId: completed.traceId,
  expiresAt: completed.expiresAt,
  prompt: undefined,
  completed,
  error: undefined,
  resend: EMPTY_RESEND_STATE,
  isLoading: false,
  requiresRedirect: false,
  awaitingApproval: false,
});

const reduceErrorState = (
  error: HawcxV6ErrorPayload,
  previous: HawcxV6AuthState,
): HawcxV6AuthState => ({
  status: 'error',
  flowType: previous.flowType,
  identifier: previous.identifier,
  session: error.session ?? previous.session,
  traceId: error.traceId ?? previous.traceId,
  expiresAt: previous.expiresAt,
  step: previous.step,
  risk: previous.risk,
  codeChannel: previous.codeChannel,
  prompt: previous.prompt,
  completed: undefined,
  error,
  resend: previous.resend,
  isLoading: false,
  requiresRedirect: false,
  awaitingApproval: false,
});

export const reduceHawcxV6FlowEvent = (
  event: HawcxV6FlowEvent,
  previous: HawcxV6AuthState,
  nowMs: number = Date.now(),
): HawcxV6AuthState => {
  switch (event.type) {
    case 'idle':
      return createIdentifierHawcxV6AuthState({
        previous,
        identifier: previous.identifier,
      });
    case 'loading':
      return {
        ...previous,
        status: 'loading',
        session: event.payload.session ?? previous.session,
        isLoading: true,
        requiresRedirect: false,
        awaitingApproval: false,
        error: undefined,
        completed: undefined,
      };
    case 'prompt':
      return reducePromptState(event.payload, previous, nowMs);
    case 'completed':
      return reduceCompletedState(event.payload, previous);
    case 'error':
      return reduceErrorState(event.payload, previous);
    default:
      return previous;
  }
};

export const refreshHawcxV6AuthState = (
  state: HawcxV6AuthState,
  nowMs: number = Date.now(),
): HawcxV6AuthState => {
  if (!state.prompt) {
    return state;
  }

  const resend = getHawcxV6ResendAvailability(state.prompt, nowMs);
  if (
    resend.canResend === state.resend.canResend &&
    resend.resendAt === state.resend.resendAt &&
    resend.secondsUntilResend === state.resend.secondsUntilResend
  ) {
    return state;
  }

  return {
    ...state,
    resend,
  };
};
