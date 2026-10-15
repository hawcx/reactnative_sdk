/**
 * Approver (the signed-in phone) for approvals v2: push and QR approvals.
 *
 * Phone action tokens, signatures and device keys never reach JavaScript: a
 * fetched approval is cached natively and JS gets an opaque `handle` to decide
 * with. The native cache drops a handle at the approval's expiry, after a final
 * decision, or on `discardApproval`.
 */

export type HawcxV6ApprovalKind = 'push_approval' | 'qr_auth' | 'qr_login';

/** What a push or a scanned QR points at. Use only to fetch the context. */
export type HawcxV6ApprovalReference = {
  kind: HawcxV6ApprovalKind;
  projectId: string;
  approvalId: string;
  /** ISO 8601 (UTC, milliseconds). Expired references are refused natively. */
  expiresAt?: string;
};

/** Who is asking, from `/v1/approvals/context` (all but `requestedAt` may be absent). */
export type HawcxV6ApprovalRequester = {
  appName?: string;
  origin?: string;
  browser?: string;
  ip?: string;
  location?: string;
  requestedAt: string;
};

export type HawcxV6ApprovalRequest = {
  /** Opaque native cache key; pass it to `decideApproval`. Not a credential outside this app process. */
  handle: string;
  reference: HawcxV6ApprovalReference;
  /** The enrolled identifier whose device key answered. */
  identifier: string;
  mode: 'push' | 'qr';
  requester: HawcxV6ApprovalRequester;
  /** Approve needs the number the user types (10-99); the SDK never fills it in. */
  numberRequired: boolean;
  /** ISO 8601 (UTC, milliseconds). */
  expiresAt: string;
  /** `qr_login` only: the requester and this phone are in different countries. */
  locationMismatch?: boolean;
};

export type HawcxV6ApprovalDecision = 'approve' | 'deny';

export type HawcxV6ApprovalResult =
  | { outcome: 'approved' | 'denied' | 'wrong_number' }
  | {
      outcome: 'resolved';
      /** approved, denied, expired, wrong_number, superseded or blocked. */
      resolvedOutcome: string;
      decidedByThisDevice: boolean;
    };

export type HawcxV6ScannedApproval =
  | { version: 2; reference: HawcxV6ApprovalReference }
  /** A 6.0.x QR: approve with `approveV6Qr(raw, identifier)` after confirming with the user. */
  | { version: 1; payloadType: 'qr_auth' | 'qr_login' };

export type HawcxV6PushRegistrationInput =
  | {
      /** iOS only. */
      provider: 'apns';
      /** The APNs device token: hex string, or the raw bytes. Sent lowercase. */
      token: string | Uint8Array | number[];
      /** The app's `aps-environment` entitlement. */
      apnsEnv: 'development' | 'production';
      /** Defaults to the bundle id. */
      appId?: string;
    }
  | {
      /** Android only. */
      provider: 'fcm';
      /** The FCM registration token, exactly as FCM gave it (case-sensitive). */
      token: string;
      /** Defaults to the application id. */
      appId?: string;
    };

export type HawcxV6PushRegistrationReport = {
  registered: number;
  /**
   * Identifiers registered earlier from this install that are no longer
   * enrolled here (keys cleared before unregistering); their server
   * registrations can't be removed from this device. Reported once.
   */
  orphanedIdentifiers: string[];
};

export type HawcxV6UnregisterPushOptions = {
  identifier: string;
  /** Unregister for this app id even without a local registration record. */
  appId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const KINDS: readonly HawcxV6ApprovalKind[] = ['push_approval', 'qr_auth', 'qr_login'];

export const normalizeApprovalReference = (value: unknown): HawcxV6ApprovalReference | null => {
  if (!isRecord(value)) {
    return null;
  }
  const kind = value.kind as HawcxV6ApprovalKind;
  const projectId = str(value.projectId);
  const approvalId = str(value.approvalId);
  if (!KINDS.includes(kind) || !projectId || !approvalId) {
    return null;
  }
  const expiresAt = str(value.expiresAt);
  return expiresAt ? { kind, projectId, approvalId, expiresAt } : { kind, projectId, approvalId };
};

export const normalizeScannedApproval = (value: unknown): HawcxV6ScannedApproval | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (value.version === 2) {
    const reference = normalizeApprovalReference(value.reference);
    return reference ? { version: 2, reference } : null;
  }
  if (
    value.version === 1 &&
    (value.payloadType === 'qr_auth' || value.payloadType === 'qr_login')
  ) {
    return { version: 1, payloadType: value.payloadType };
  }
  return null;
};

export const normalizeApprovalRequest = (value: unknown): HawcxV6ApprovalRequest => {
  const fail = () => new Error('Invalid approval context from native bridge');
  if (!isRecord(value)) {
    throw fail();
  }
  const handle = str(value.handle);
  const reference = normalizeApprovalReference(value.reference);
  const identifier = str(value.identifier);
  const mode = value.mode === 'push' || value.mode === 'qr' ? value.mode : undefined;
  const expiresAt = str(value.expiresAt);
  const requester = isRecord(value.requester) ? value.requester : undefined;
  const requestedAt = str(requester?.requestedAt);
  if (!handle || !reference || !identifier || !mode || !expiresAt || !requester || !requestedAt) {
    throw fail();
  }
  return {
    handle,
    reference,
    identifier,
    mode,
    requester: {
      appName: str(requester.appName),
      origin: str(requester.origin),
      browser: str(requester.browser),
      ip: str(requester.ip),
      location: str(requester.location),
      requestedAt,
    },
    numberRequired: value.numberRequired === true,
    expiresAt,
    locationMismatch:
      typeof value.locationMismatch === 'boolean' ? value.locationMismatch : undefined,
  };
};

export const normalizeApprovalResult = (value: unknown): HawcxV6ApprovalResult => {
  if (isRecord(value)) {
    switch (value.outcome) {
      case 'approved':
      case 'denied':
      case 'wrong_number':
        return { outcome: value.outcome };
      case 'resolved':
        return {
          outcome: 'resolved',
          resolvedOutcome: str(value.resolvedOutcome) ?? 'unknown',
          decidedByThisDevice: value.decidedByThisDevice === true,
        };
      default:
        break;
    }
  }
  throw new Error('Invalid approval result from native bridge');
};

/** Lowercase hex of an APNs token given as hex or bytes. */
export const apnsTokenHex = (token: string | Uint8Array | number[]): string => {
  if (typeof token === 'string') {
    return token.trim().toLowerCase();
  }
  return Array.from(token, (byte) => {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error('APNs token bytes must be integers between 0 and 255');
    }
    return byte.toString(16).padStart(2, '0');
  }).join('');
};
