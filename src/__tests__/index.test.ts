import {
  initialize,
  authenticate,
  submitOtp,
  webLogin,
  webApprove,
  approvePushRequest,
  declinePushRequest,
  setPushDeviceToken,
  HawcxClient,
  HawcxAuthError,
  __INTERNAL_EVENTS__,
} from '../index';
import { Platform } from 'react-native';

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

  it('rejects authenticate call without userId', async () => {
    await expect(authenticate('   ')).rejects.toThrow('userId is required');
  });

  it('rejects submitOtp call without otp', async () => {
    await expect(submitOtp('')).rejects.toThrow('otp is required');
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

  afterEach(() => {
    __INTERNAL_EVENTS__.authEmitter.removeAllListeners(__INTERNAL_EVENTS__.authEventName);
    __INTERNAL_EVENTS__.sessionEmitter.removeAllListeners(__INTERNAL_EVENTS__.sessionEventName);
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
});

describe('push token helpers', () => {
  afterEach(() => {
    overridePlatformOS(ORIGINAL_PLATFORM);
    jest.restoreAllMocks();
  });

  it('rejects APNs string tokens on iOS', async () => {
    overridePlatformOS('ios');
    await expect(setPushDeviceToken('abc')).rejects.toThrow('APNs tokens must be provided as byte arrays or Uint8Arrays');
  });

  it('rejects non-string tokens on Android', async () => {
    overridePlatformOS('android');
    await expect(setPushDeviceToken([1, 2, 3])).rejects.toThrow('FCM token must be a string on Android');
  });
});
