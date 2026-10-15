import { NativeModules } from 'react-native';
import {
  approveV6Qr,
  clearLastLoggedInUser,
  forgetTrustedDevice,
  HawcxClient,
  hawcxV6Client,
  logoutSession,
  routeWebLoginScan,
} from '../index';

describe('V6 mixed-mode web login helpers', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('routes approvals v2 QR payloads to the approver, never to the legacy PIN', () => {
    const raw = JSON.stringify({
      v: 2,
      type: 'qr_login',
      project_id: 'proj_1234567',
      approval_id: 'appr_7654321',
    });
    expect(routeWebLoginScan(raw)).toEqual({ kind: 'approval_v2', raw });
    expect(
      routeWebLoginScan('{"v":"2","type":"qr_auth","project_id":"p","approval_id":"a"}').kind,
    ).toBe('approval_v2');
    // Unknown JSON is invalid, not a PIN hunt.
    expect(routeWebLoginScan('{"v":9,"approval_id":"1234567"}')).toEqual({ kind: 'invalid' });
  });

  it('routes protocol QR auth payloads', () => {
    expect(
      routeWebLoginScan(
        JSON.stringify({
          type: 'qr_auth',
          session_id: 'auth_123',
          nonce: 'nonce_123',
          phone_action_token: 'token_123',
          project_id: 'project_123',
          v: '1',
        }),
      ),
    ).toEqual({
      kind: 'protocol_qr',
      payload: {
        type: 'qr_auth',
        sessionId: 'auth_123',
        nonce: 'nonce_123',
        phoneActionToken: 'token_123',
        token: undefined,
        projectId: 'project_123',
        version: '1',
        raw: '{"type":"qr_auth","session_id":"auth_123","nonce":"nonce_123","phone_action_token":"token_123","project_id":"project_123","v":"1"}',
      },
    });
  });

  it('routes protocol QR login payloads and legacy 7-digit PINs', () => {
    expect(
      routeWebLoginScan(
        JSON.stringify({
          type: 'qr_login',
          sessionId: 'auth_456',
          nonce: 'nonce_456',
          token: 'bind_456',
        }),
      ),
    ).toMatchObject({
      kind: 'protocol_qr',
      payload: {
        type: 'qr_login',
        sessionId: 'auth_456',
        nonce: 'nonce_456',
        token: 'bind_456',
      },
    });

    expect(routeWebLoginScan('https://hawcx.com/login?pin=1234567')).toEqual({
      kind: 'legacy_pin',
      pin: '1234567',
    });
  });

  it('returns invalid for unsupported scan payloads', () => {
    expect(routeWebLoginScan('')).toEqual({ kind: 'invalid' });
    expect(routeWebLoginScan('not-a-qr')).toEqual({ kind: 'invalid' });
  });

  it('approves QR payloads through the native V6 bridge', async () => {
    (NativeModules.HawcxReactNative.v6ApproveQr as jest.Mock).mockResolvedValueOnce({
      outcome: 'bound',
      payloadType: 'qr_login',
      userId: 'user@example.com',
    });

    await expect(
      approveV6Qr(
        ' {"type":"qr_login","sessionId":"auth_123","nonce":"nonce_123","token":"bind_123"} ',
        ' user@example.com ',
        { rememberDevice: true },
      ),
    ).resolves.toEqual({
      outcome: 'bound',
      payloadType: 'qr_login',
      userId: 'user@example.com',
    });

    expect(NativeModules.HawcxReactNative.v6ApproveQr).toHaveBeenCalledWith(
      '{"type":"qr_login","sessionId":"auth_123","nonce":"nonce_123","token":"bind_123"}',
      'user@example.com',
      true,
    );
  });

  it('rejects QR approval without required inputs', async () => {
    await expect(approveV6Qr('   ', 'user@example.com')).rejects.toThrow('rawPayload is required');
    await expect(approveV6Qr('{"type":"qr_auth"}', '   ')).rejects.toThrow(
      'identifier is required',
    );
  });

  it('exposes explicit session and trusted-device clearing helpers', async () => {
    await logoutSession(' user@example.com ');
    await forgetTrustedDevice(' user@example.com ');
    await clearLastLoggedInUser();

    expect(NativeModules.HawcxReactNative.clearSessionTokens).toHaveBeenCalledWith(
      'user@example.com',
    );
    expect(NativeModules.HawcxReactNative.clearUserKeychainData).toHaveBeenCalledWith(
      'user@example.com',
    );
    expect(NativeModules.HawcxReactNative.clearLastLoggedInUser).toHaveBeenCalled();
  });

  it('exposes the same mixed-mode helpers through the public clients', async () => {
    const client = new HawcxClient();
    (NativeModules.HawcxReactNative.getLastLoggedInUser as jest.Mock).mockResolvedValueOnce(
      'saved@example.com',
    );

    await expect(client.getLastLoggedInUser()).resolves.toBe('saved@example.com');
    await client.logoutSession('user@example.com');
    await client.forgetTrustedDevice('user@example.com');
    await hawcxV6Client.approveQr(
      '{"type":"qr_auth","session_id":"auth_123","nonce":"nonce_123","phone_action_token":"token_123"}',
      'user@example.com',
    );

    expect(NativeModules.HawcxReactNative.clearSessionTokens).toHaveBeenCalledWith(
      'user@example.com',
    );
    expect(NativeModules.HawcxReactNative.clearUserKeychainData).toHaveBeenCalledWith(
      'user@example.com',
    );
    expect(NativeModules.HawcxReactNative.v6ApproveQr).toHaveBeenCalled();
  });
});
