/**
 * Typed error for the native service calls (device APIs, approver, push-token
 * registration). `code` is the server's code (e.g. `approval_resolved`,
 * `device_not_found`, `rate_limited`) or a local one from the native SDK
 * (`number_required`, `push_not_registered`, `keychain_unavailable`, ...).
 * `hawcx.input` / `hawcx.sdk` are bridge-level input and setup errors.
 */
export class HawcxServiceError extends Error {
  public readonly code: string;
  /** HTTP status; undefined when no response arrived or the error is local. */
  public readonly status?: number;
  public readonly retryable: boolean;
  public readonly retryAfterSeconds?: number;
  /** `approval_resolved`: approved, denied, expired, wrong_number, superseded or blocked. */
  public readonly outcome?: string;
  /** `approval_resolved`: whether this device made the decision. */
  public readonly decidedByThisDevice?: boolean;
  /**
   * `service_unavailable` from `resolveApprovalCode`: the server's own code
   * (`approval_store_unavailable`, `rate_limit_unavailable`, or
   * `service_unavailable` when it sent none).
   */
  public readonly serverCode?: string;

  constructor(init: {
    code: string;
    message: string;
    status?: number;
    retryable?: boolean;
    retryAfterSeconds?: number;
    outcome?: string;
    decidedByThisDevice?: boolean;
    serverCode?: string;
  }) {
    super(init.message);
    this.name = 'HawcxServiceError';
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable ?? false;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.outcome = init.outcome;
    this.decidedByThisDevice = init.decidedByThisDevice;
    this.serverCode = init.serverCode;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Maps a native promise rejection (`{code, message, userInfo}`; iOS NSError
 * userInfo and Android WritableMap carry the same keys) to `HawcxServiceError`.
 */
export const toHawcxServiceError = (error: unknown): HawcxServiceError => {
  if (error instanceof HawcxServiceError) {
    return error;
  }
  const record = isRecord(error) ? error : {};
  const userInfo = isRecord(record.userInfo) ? record.userInfo : {};
  const code = typeof record.code === 'string' && record.code ? record.code : 'unknown_error';
  const message =
    error instanceof Error
      ? error.message
      : typeof record.message === 'string'
      ? record.message
      : 'Unknown error';
  return new HawcxServiceError({
    code,
    message,
    status: num(userInfo.status),
    retryable: userInfo.retryable === true,
    retryAfterSeconds: num(userInfo.retryAfterSeconds),
    outcome: typeof userInfo.outcome === 'string' ? userInfo.outcome : undefined,
    decidedByThisDevice:
      typeof userInfo.decidedByThisDevice === 'boolean' ? userInfo.decidedByThisDevice : undefined,
    serverCode:
      typeof userInfo.serverCode === 'string' && userInfo.serverCode
        ? userInfo.serverCode
        : undefined,
  });
};

/** Runs a native call and rejects with `HawcxServiceError`. */
export const withServiceErrors = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    throw toHawcxServiceError(error);
  }
};
