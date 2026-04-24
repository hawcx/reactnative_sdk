import {
  initialize,
  authenticate,
  submitOtp,
  startV6Flow,
  storeBackendOAuthTokens,
  addV6FlowListener,
  v6HandleRedirectUrl,
  v6Resend,
  webLogin,
  webApprove,
  approvePushRequest,
  declinePushRequest,
  setPushDeviceToken,
  HawcxClient,
  HawcxAuthError,
  addSessionListener,
  __INTERNAL_EVENTS__,
} from '../index';
import { NativeModules, Platform } from 'react-native';

const ORIGINAL_PLATFORM = Platform.OS;

const overridePlatformOS = (os: typeof Platform.OS) => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    get: () => os,
  });
};

describe('Hawcx React Native SDK', () => {
  it('rejects initialize call without api key', async () => {
    await expect(initialize({ projectApiKey: '' })).rejects.toThrow('projectApiKey is required');
  });

  it('rejects initialize call without base url', async () => {
    await expect(initialize({ projectApiKey: 'key' })).rejects.toThrow('baseUrl is required');
  });

  it('passes additive V6 initialize options through to native', async () => {
    await initialize({
      projectApiKey: 'key',
      baseUrl: 'https://stage-api.hawcx.com',
      relyingParty: 'web-demo',
      autoPollApprovals: false,
    });

    expect(NativeModules.HawcxReactNative.initialize).toHaveBeenCalledWith({
      projectApiKey: 'key',
      baseUrl: 'https://stage-api.hawcx.com',
      relyingParty: 'web-demo',
      autoPollApprovals: false,
    });
  });

  it('rejects authenticate call without userId', async () => {
    await expect(authenticate('   ')).rejects.toThrow('userId is required');
  });

  it('rejects submitOtp call without otp', async () => {
    await expect(submitOtp('')).rejects.toThrow('otp is required');
  });

  it('passes normalized V6 start options through to native', async () => {
    await startV6Flow({
      identifier: ' user@example.com ',
      flowType: 'signup',
      startToken: ' start-token ',
      inviteCode: ' invite-code ',
      codeChallenge: ' challenge ',
    });

    expect(NativeModules.HawcxReactNative.v6Start).toHaveBeenCalledWith({
      identifier: 'user@example.com',
      flowType: 'signup',
      startToken: 'start-token',
      inviteCode: 'invite-code',
      codeChallenge: 'challenge',
    });
  });

  it('defaults V6 flow type to signin', async () => {
    await startV6Flow({
      identifier: 'user@example.com',
    });

    expect(NativeModules.HawcxReactNative.v6Start).toHaveBeenCalledWith({
      identifier: 'user@example.com',
      flowType: 'signin',
      startToken: undefined,
      inviteCode: undefined,
      codeChallenge: undefined,
    });
  });

  it('rejects V6 redirect handler without url', async () => {
    await expect(v6HandleRedirectUrl('   ')).rejects.toThrow('url is required');
  });

  it('rejects webLogin call without pin', async () => {
    await expect(webLogin('')).rejects.toThrow('pin is required');
  });

  it('rejects webApprove call without token', async () => {
    await expect(webApprove('')).rejects.toThrow('token is required');
  });

  it('rejects approvePushRequest call without requestId', async () => {
    await expect(approvePushRequest('')).rejects.toThrow('requestId is required');
  });

  it('rejects declinePushRequest call without requestId', async () => {
    await expect(declinePushRequest('')).rejects.toThrow('requestId is required');
  });
});

describe('HawcxClient helpers', () => {
  const client = new HawcxClient();
  const emitAuth = (event: unknown) => {
    __INTERNAL_EVENTS__.authEmitter.emit(__INTERNAL_EVENTS__.authEventName, event as never);
  };
  const emitSession = (event: unknown) => {
    __INTERNAL_EVENTS__.sessionEmitter.emit(__INTERNAL_EVENTS__.sessionEventName, event as never);
  };
  const emitV6 = (event: unknown) => {
    __INTERNAL_EVENTS__.v6FlowEmitter.emit(__INTERNAL_EVENTS__.v6FlowEventName, event as never);
  };

  afterEach(() => {
    __INTERNAL_EVENTS__.authEmitter.removeAllListeners(__INTERNAL_EVENTS__.authEventName);
    __INTERNAL_EVENTS__.sessionEmitter.removeAllListeners(__INTERNAL_EVENTS__.sessionEventName);
    __INTERNAL_EVENTS__.v6FlowEmitter.removeAllListeners(__INTERNAL_EVENTS__.v6FlowEventName);
  });

  it('resolves authenticate promise on success event', async () => {
    const invocation = client.authenticate('user@example.com');
    emitAuth({
      type: 'auth_success',
      payload: { isLoginFlow: true, accessToken: 'a', refreshToken: 'r' },
    });
    await expect(invocation.promise).resolves.toEqual({
      isLoginFlow: true,
      accessToken: 'a',
      refreshToken: 'r',
    });
  });

  it('rejects authenticate promise on error event', async () => {
    const invocation = client.authenticate('user@example.com');
    emitAuth({
      type: 'auth_error',
      payload: { code: 'otp_invalid', message: 'Invalid OTP' },
    });
    await expect(invocation.promise).rejects.toBeInstanceOf(HawcxAuthError);
  });

  it('rejects authenticate promise when cancelled', async () => {
    const invocation = client.authenticate('user@example.com');
    invocation.cancel();
    await expect(invocation.promise).rejects.toBeInstanceOf(HawcxAuthError);
  });

  it('invokes web login session event handler', async () => {
    const handler = jest.fn();
    await client.webLogin('1234', { onEvent: handler });
    emitSession({ type: 'session_success' });
    expect(handler).toHaveBeenCalledWith({ type: 'session_success' });
  });

  it('invokes web approve session event handler', async () => {
    const handler = jest.fn();
    await client.webApprove('token', { onEvent: handler });
    emitSession({
      type: 'session_error',
      payload: { code: 'failedApprove', message: 'Failed' },
    });
    expect(handler).toHaveBeenCalledWith({
      type: 'session_error',
      payload: { code: 'failedApprove', message: 'Failed' },
    });
  });

  it('invokes authorization code callback', async () => {
    const onAuthorizationCode = jest.fn();
    client.authenticate('user@example.com', { onAuthorizationCode });
    const payload = { code: 'abc', expiresIn: 30 };
    emitAuth({ type: 'authorization_code', payload });
    expect(onAuthorizationCode).toHaveBeenCalledWith(payload);
  });

  it('invokes additional verification callback', async () => {
    const onAdditionalVerificationRequired = jest.fn();
    client.authenticate('user@example.com', { onAdditionalVerificationRequired });
    const payload = { sessionId: 'sid', detail: 'extra' };
    emitAuth({ type: 'additional_verification_required', payload });
    expect(onAdditionalVerificationRequired).toHaveBeenCalledWith(payload);
  });

  it('invokes push event handlers', async () => {
    const handler = jest.fn();
    const subscription = client.addPushListener(handler);
    __INTERNAL_EVENTS__.pushEmitter.emit(__INTERNAL_EVENTS__.pushEventName, {
      type: 'push_login_request',
      payload: {
        requestId: 'req',
        ipAddress: '1.1.1.1',
        deviceInfo: 'Safari on Mac',
        location: 'SF',
        timestamp: '2025-01-01T00:00:00Z',
      },
    });
    expect(handler).toHaveBeenCalledWith({
      type: 'push_login_request',
      payload: {
        requestId: 'req',
        ipAddress: '1.1.1.1',
        deviceInfo: 'Safari on Mac',
        location: 'SF',
        timestamp: '2025-01-01T00:00:00Z',
      },
    });
    subscription.remove();
  });

  it('does not deliver V6 flow events to V5 auth listeners', async () => {
    const handler = jest.fn();
    const subscription = client.addListener(handler);

    emitV6({
      type: 'prompt',
      payload: { session: 'sid', promptType: 'enter_code' },
    });

    expect(handler).not.toHaveBeenCalled();
    subscription.remove();
  });

  it('does not deliver V6 flow events to V5 session listeners', async () => {
    const handler = jest.fn();
    const subscription = addSessionListener(handler);

    emitV6({
      type: 'loading',
      payload: { session: 'sid' },
    });

    expect(handler).not.toHaveBeenCalled();
    subscription.remove();
  });
});

describe('V6 flow bridge helpers', () => {
  const emitV6 = (event: unknown) => {
    __INTERNAL_EVENTS__.v6FlowEmitter.emit(__INTERNAL_EVENTS__.v6FlowEventName, event as never);
  };

  afterEach(() => {
    __INTERNAL_EVENTS__.v6FlowEmitter.removeAllListeners(__INTERNAL_EVENTS__.v6FlowEventName);
  });

  it('normalizes select method prompt events', async () => {
    const handler = jest.fn();
    const subscription = addV6FlowListener(handler);

    emitV6({
      type: 'prompt',
      payload: {
        session: 'auth_123',
        traceId: 'trace_123',
        expiresAt: '2026-03-24T10:00:00Z',
        step: {
          id: 'primary',
          label: 'Verify Identity',
        },
        risk: {
          detected: true,
          reasons: ['new_location'],
          message: 'Risk detected',
          location: {
            city: 'Los Angeles',
            country: 'US',
          },
          riskScore: 0.42,
        },
        codeChannel: 'email',
        prompt: {
          type: 'select_method',
          phase: 'primary',
          methods: [
            { id: 'email_otp', label: 'Email OTP', icon: 'mail' },
            { id: 'totp', label: 'Authenticator App' },
          ],
        },
      },
    });

    expect(handler).toHaveBeenCalledWith({
      type: 'prompt',
      payload: {
        session: 'auth_123',
        traceId: 'trace_123',
        expiresAt: '2026-03-24T10:00:00Z',
        step: {
          id: 'primary',
          label: 'Verify Identity',
        },
        risk: {
          detected: true,
          reasons: ['new_location'],
          message: 'Risk detected',
          location: {
            city: 'Los Angeles',
            country: 'US',
          },
          riskScore: 0.42,
        },
        codeChannel: 'email',
        prompt: {
          type: 'select_method',
          phase: 'primary',
          methods: [
            { id: 'email_otp', label: 'Email OTP', icon: 'mail' },
            { id: 'totp', label: 'Authenticator App', icon: undefined },
          ],
        },
      },
    });

    subscription.remove();
  });

  it('normalizes completed events', async () => {
    const handler = jest.fn();
    const subscription = addV6FlowListener(handler);

    emitV6({
      type: 'completed',
      payload: {
        session: 'auth_123',
        authCode: 'code_123',
        expiresAt: '2026-03-24T10:00:00Z',
        codeVerifier: 'verifier_123',
        traceId: 'trace_123',
      },
    });

    expect(handler).toHaveBeenCalledWith({
      type: 'completed',
      payload: {
        session: 'auth_123',
        authCode: 'code_123',
        expiresAt: '2026-03-24T10:00:00Z',
        codeVerifier: 'verifier_123',
        traceId: 'trace_123',
      },
    });

    subscription.remove();
  });

  it('normalizes prompt events when trace ids are missing', async () => {
    const handler = jest.fn();
    const subscription = addV6FlowListener(handler);

    emitV6({
      type: 'prompt',
      payload: {
        session: 'auth_trace_optional',
        expiresAt: '2026-03-24T10:00:00Z',
        prompt: {
          type: 'enter_code',
          destination: 'u***@example.com',
        },
      },
    });

    expect(handler).toHaveBeenCalledWith({
      type: 'prompt',
      payload: {
        session: 'auth_trace_optional',
        traceId: undefined,
        expiresAt: '2026-03-24T10:00:00Z',
        step: undefined,
        risk: undefined,
        codeChannel: undefined,
        prompt: {
          type: 'enter_code',
          destination: 'u***@example.com',
          codeLength: undefined,
          codeFormat: undefined,
          codeExpiresAt: undefined,
          resendAt: undefined,
        },
      },
    });

    subscription.remove();
  });

  it('normalizes completed events when trace ids are missing', async () => {
    const handler = jest.fn();
    const subscription = addV6FlowListener(handler);

    emitV6({
      type: 'completed',
      payload: {
        session: 'auth_trace_optional',
        authCode: 'code_123',
        expiresAt: '2026-03-24T10:00:00Z',
        codeVerifier: 'verifier_123',
      },
    });

    expect(handler).toHaveBeenCalledWith({
      type: 'completed',
      payload: {
        session: 'auth_trace_optional',
        authCode: 'code_123',
        expiresAt: '2026-03-24T10:00:00Z',
        codeVerifier: 'verifier_123',
        traceId: undefined,
      },
    });

    subscription.remove();
  });

  it('normalizes error events with field details', async () => {
    const handler = jest.fn();
    const subscription = addV6FlowListener(handler);

    emitV6({
      type: 'error',
      payload: {
        session: 'auth_123',
        code: 'validation_error',
        action: 'retry_input',
        message: 'Request validation failed',
        retryable: true,
        traceId: 'trace_123',
        details: {
          retryAfterSeconds: 30,
          retryAt: '2026-03-24T10:01:00Z',
          attemptsRemaining: 2,
          errors: [
            {
              field: 'identifier',
              message: 'Identifier is invalid',
            },
          ],
        },
      },
    });

    expect(handler).toHaveBeenCalledWith({
      type: 'error',
      payload: {
        session: 'auth_123',
        code: 'validation_error',
        action: 'retry_input',
        message: 'Request validation failed',
        retryable: true,
        traceId: 'trace_123',
        details: {
          retryAfterSeconds: 30,
          retryAt: '2026-03-24T10:01:00Z',
          attemptsRemaining: 2,
          errors: [
            {
              field: 'identifier',
              message: 'Identifier is invalid',
            },
          ],
        },
      },
    });

    subscription.remove();
  });

  it('returns the native resend result', async () => {
    (NativeModules.HawcxReactNative.v6Resend as jest.Mock).mockResolvedValueOnce(false);
    await expect(v6Resend()).resolves.toBe(false);
  });
});

describe('push token helpers', () => {
  afterEach(() => {
    overridePlatformOS(ORIGINAL_PLATFORM);
    jest.restoreAllMocks();
  });

  it('rejects APNs string tokens on iOS', async () => {
    overridePlatformOS('ios');
    await expect(setPushDeviceToken('abc')).rejects.toThrow(
      'APNs tokens must be provided as byte arrays or Uint8Arrays',
    );
  });

  it('rejects non-string tokens on Android', async () => {
    overridePlatformOS('android');
    await expect(setPushDeviceToken([1, 2, 3])).rejects.toThrow(
      'FCM token must be a string on Android',
    );
  });
});

describe('storeBackendOAuthTokens helper', () => {
  const bridge = NativeModules.HawcxReactNative.storeBackendOAuthTokens as jest.Mock;

  beforeEach(() => {
    bridge.mockResolvedValue(true);
  });

  it('calls native bridge with trimmed values', async () => {
    await storeBackendOAuthTokens(' user@example.com ', ' token ', ' refresh ');
    expect(bridge).toHaveBeenCalledWith('user@example.com', 'token', 'refresh');
  });

  it('passes null refresh token when omitted', async () => {
    await storeBackendOAuthTokens('user@example.com', 'token');
    expect(bridge).toHaveBeenCalledWith('user@example.com', 'token', null);
  });

  it('rejects when userId empty', async () => {
    await expect(storeBackendOAuthTokens('   ', 'token')).rejects.toThrow('userId is required');
  });
});
