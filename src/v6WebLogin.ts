export type HawcxV6QrPayloadType = 'qr_auth' | 'qr_login';

export type HawcxV6QrPayload = {
  type: HawcxV6QrPayloadType;
  sessionId: string;
  nonce: string;
  phoneActionToken?: string;
  token?: string;
  projectId?: string;
  version?: string;
  raw: string;
};

export type HawcxV6QrApprovalResult =
  | {
      outcome: 'approved';
      payloadType: HawcxV6QrPayloadType;
    }
  | {
      outcome: 'bound';
      payloadType: HawcxV6QrPayloadType;
      userId?: string;
    };

export type HawcxWebLoginScanRoute =
  | {
      kind: 'protocol_qr';
      payload: HawcxV6QrPayload;
    }
  | {
      kind: 'legacy_pin';
      pin: string;
    }
  | {
      kind: 'invalid';
    };

const LEGACY_PIN_PATTERNS = [
  /pin=([0-9]{7})/,
  /PIN=([0-9]{7})/,
  /code=([0-9]{7})/,
  /CODE=([0-9]{7})/,
  /token=([0-9]{7})/,
  /TOKEN=([0-9]{7})/,
  /\b([0-9]{7})\b/,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const parseHawcxV6QrPayload = (raw: string): HawcxV6QrPayload | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const sessionId = asString(parsed.session_id) ?? asString(parsed.sessionId);
    const nonce = asString(parsed.nonce);
    if (!sessionId || !nonce) {
      return null;
    }

    const typeValue = asString(parsed.type)?.toLowerCase();
    const phoneActionToken =
      asString(parsed.phone_action_token) ?? asString(parsed.phoneActionToken);
    const token = asString(parsed.token);
    const projectId = asString(parsed.project_id) ?? asString(parsed.projectId);
    const version = asString(parsed.v) ?? asString(parsed.version);

    let type: HawcxV6QrPayloadType | undefined;
    if (typeValue === 'qr_login') {
      type = 'qr_login';
    } else if (typeValue === 'qr_auth') {
      type = 'qr_auth';
    } else if (phoneActionToken) {
      type = 'qr_auth';
    } else if (token) {
      type = 'qr_login';
    }

    if (!type) {
      return null;
    }

    return {
      type,
      sessionId,
      nonce,
      phoneActionToken,
      token,
      projectId,
      version,
      raw: trimmed,
    };
  } catch {
    return null;
  }
};

export const extractLegacyWebLoginPin = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length === 7 && /^[0-9]{7}$/.test(trimmed)) {
    return trimmed;
  }

  for (const pattern of LEGACY_PIN_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
};

export const routeWebLoginScan = (raw: string): HawcxWebLoginScanRoute => {
  const protocolPayload = parseHawcxV6QrPayload(raw);
  if (protocolPayload) {
    return {
      kind: 'protocol_qr',
      payload: protocolPayload,
    };
  }

  const pin = extractLegacyWebLoginPin(raw);
  if (pin) {
    return {
      kind: 'legacy_pin',
      pin,
    };
  }

  return {
    kind: 'invalid',
  };
};
