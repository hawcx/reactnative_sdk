import type {
  HawcxV6AwaitApprovalPrompt,
  HawcxV6CompletedPayload,
  HawcxV6EnterCodePrompt,
  HawcxV6ErrorDetails,
  HawcxV6ErrorPayload,
  HawcxV6FlowEvent,
  HawcxV6Method,
  HawcxV6PromptBase,
  HawcxV6PromptPayload,
  HawcxV6RedirectPrompt,
  HawcxV6RiskInfo,
  HawcxV6SelectMethodPrompt,
  HawcxV6SetupSmsPrompt,
  HawcxV6SetupTotpPrompt,
  HawcxV6StepInfo,
} from './v6Types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const asRecordArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const normalizeStep = (value: unknown): HawcxV6StepInfo | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = asString(value.id);
  if (!id) {
    return undefined;
  }
  return {
    id,
    label: asString(value.label),
  };
};

const normalizeMethod = (value: unknown): HawcxV6Method | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = asString(value.id);
  const label = asString(value.label);
  if (!id || !label) {
    return undefined;
  }
  return {
    id,
    label,
    icon: asString(value.icon),
  };
};

const normalizeRisk = (value: unknown): HawcxV6RiskInfo | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const detected = asBoolean(value.detected);
  if (detected === undefined) {
    return undefined;
  }
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.map(asString).filter((item): item is string => Boolean(item))
    : [];
  const location = isRecord(value.location)
    ? {
        city: asString(value.location.city),
        country: asString(value.location.country),
      }
    : undefined;
  return {
    detected,
    reasons,
    message: asString(value.message),
    location:
      location && (location.city !== undefined || location.country !== undefined)
        ? location
        : undefined,
    riskScore: asNumber(value.riskScore),
  };
};

const normalizeErrorDetails = (value: unknown): HawcxV6ErrorDetails | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const errors = asRecordArray(value.errors)
    .map((entry) => {
      const field = asString(entry.field);
      const message = asString(entry.message);
      if (!field || !message) {
        return undefined;
      }
      return { field, message };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const details: HawcxV6ErrorDetails = {
    retryAfterSeconds: asNumber(value.retryAfterSeconds),
    retryAt: asString(value.retryAt),
    attemptsRemaining: asNumber(value.attemptsRemaining),
    errors: errors.length > 0 ? errors : undefined,
  };

  if (
    details.retryAfterSeconds === undefined &&
    details.retryAt === undefined &&
    details.attemptsRemaining === undefined &&
    details.errors === undefined
  ) {
    return undefined;
  }

  return details;
};

const normalizePromptBase = (value: Record<string, unknown>): HawcxV6PromptBase | null => {
  const session = asString(value.session);
  const traceId = asString(value.traceId);
  const expiresAt = asString(value.expiresAt);
  if (!session || !traceId || !expiresAt) {
    return null;
  }

  const step =
    normalizeStep(value.step) ??
    normalizeStep({
      id: value.stepId,
      label: value.stepLabel,
    });

  return {
    session,
    traceId,
    expiresAt,
    step,
    risk: normalizeRisk(value.risk),
    codeChannel: asString(value.codeChannel),
  };
};

const normalizePromptPayload = (value: unknown): HawcxV6PromptPayload | null => {
  if (!isRecord(value)) {
    return null;
  }

  const base = normalizePromptBase(value);
  if (!base) {
    return null;
  }

  const rawPrompt = isRecord(value.prompt) ? value.prompt : undefined;
  const promptType = asString(rawPrompt?.type) ?? asString(value.promptType);
  if (!promptType) {
    return null;
  }

  switch (promptType) {
    case 'select_method': {
      const methodsSource = rawPrompt?.methods ?? value.methods;
      const methods = Array.isArray(methodsSource)
        ? methodsSource.map(normalizeMethod).filter((item): item is HawcxV6Method => Boolean(item))
        : [];
      const payload: HawcxV6SelectMethodPrompt = {
        ...base,
        prompt: {
          type: 'select_method',
          methods,
          phase: asString(rawPrompt?.phase ?? value.phase),
        },
      };
      return payload;
    }
    case 'enter_code': {
      const destination = asString(rawPrompt?.destination ?? value.destination);
      if (!destination) {
        return null;
      }
      const payload: HawcxV6EnterCodePrompt = {
        ...base,
        prompt: {
          type: 'enter_code',
          destination,
          codeLength: asNumber(rawPrompt?.codeLength ?? value.codeLength),
          codeFormat: asString(rawPrompt?.codeFormat ?? value.codeFormat),
          codeExpiresAt: asString(rawPrompt?.codeExpiresAt ?? value.codeExpiresAt),
          resendAt: asString(rawPrompt?.resendAt ?? value.resendAt),
        },
      };
      return payload;
    }
    case 'enter_totp':
      return {
        ...base,
        prompt: { type: 'enter_totp' },
      };
    case 'setup_totp': {
      const secret = asString(rawPrompt?.secret ?? value.secret);
      const otpauthUrl = asString(rawPrompt?.otpauthUrl ?? value.otpauthUrl);
      if (!secret || !otpauthUrl) {
        return null;
      }
      const payload: HawcxV6SetupTotpPrompt = {
        ...base,
        prompt: {
          type: 'setup_totp',
          secret,
          otpauthUrl,
          period: asNumber(rawPrompt?.period ?? value.period),
        },
      };
      return payload;
    }
    case 'setup_sms': {
      const payload: HawcxV6SetupSmsPrompt = {
        ...base,
        prompt: {
          type: 'setup_sms',
          existingPhone: asString(rawPrompt?.existingPhone ?? value.existingPhone),
        },
      };
      return payload;
    }
    case 'redirect': {
      const url = asString(rawPrompt?.url ?? value.url);
      if (!url) {
        return null;
      }
      const payload: HawcxV6RedirectPrompt = {
        ...base,
        prompt: {
          type: 'redirect',
          url,
          returnScheme: asString(rawPrompt?.returnScheme ?? value.returnScheme),
        },
      };
      return payload;
    }
    case 'await_approval': {
      const promptExpiresAt = asString(
        rawPrompt?.expiresAt ?? value.promptExpiresAt ?? value.awaitExpiresAt,
      );
      const pollInterval = asNumber(rawPrompt?.pollInterval ?? value.pollInterval);
      if (!promptExpiresAt || pollInterval === undefined) {
        return null;
      }
      const payload: HawcxV6AwaitApprovalPrompt = {
        ...base,
        prompt: {
          type: 'await_approval',
          qrData: asString(rawPrompt?.qrData ?? value.qrData),
          expiresAt: promptExpiresAt,
          pollInterval,
        },
      };
      return payload;
    }
    default:
      return null;
  }
};

const normalizeCompletedPayload = (value: unknown): HawcxV6CompletedPayload | null => {
  if (!isRecord(value)) {
    return null;
  }
  const session = asString(value.session);
  const authCode = asString(value.authCode);
  const expiresAt = asString(value.expiresAt);
  const traceId = asString(value.traceId);
  if (!session || !authCode || !expiresAt || !traceId) {
    return null;
  }
  return {
    session,
    authCode,
    expiresAt,
    codeVerifier: asString(value.codeVerifier),
    traceId,
  };
};

const normalizeErrorPayload = (value: unknown): HawcxV6ErrorPayload | null => {
  if (!isRecord(value)) {
    return null;
  }
  const code = asString(value.code);
  const message = asString(value.message);
  const retryable = asBoolean(value.retryable);
  if (!code || !message || retryable === undefined) {
    return null;
  }
  return {
    session: asString(value.session),
    code,
    action: asString(value.action),
    message,
    retryable,
    details: normalizeErrorDetails(value.details),
    traceId: asString(value.traceId),
  };
};

export const normalizeV6FlowEvent = (value: unknown): HawcxV6FlowEvent | null => {
  if (!isRecord(value)) {
    return null;
  }

  const type = asString(value.type);
  if (!type) {
    return null;
  }

  switch (type) {
    case 'idle':
      return { type: 'idle' };
    case 'loading': {
      const payload = isRecord(value.payload) ? value.payload : {};
      return {
        type: 'loading',
        payload: {
          session: asString(payload.session),
        },
      };
    }
    case 'prompt': {
      const payload = normalizePromptPayload(value.payload);
      return payload ? { type: 'prompt', payload } : null;
    }
    case 'completed': {
      const payload = normalizeCompletedPayload(value.payload);
      return payload ? { type: 'completed', payload } : null;
    }
    case 'error': {
      const payload = normalizeErrorPayload(value.payload);
      return payload ? { type: 'error', payload } : null;
    }
    default:
      return null;
  }
};
