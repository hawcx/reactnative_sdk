import fs from 'fs';
import path from 'path';
import React, { forwardRef, useImperativeHandle } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';
import type { HawcxV6AuthHookResult, HawcxV6FlowEvent } from '../index';
import {
  __INTERNAL_EVENTS__,
  addV6FlowListener,
  HawcxServiceError,
  hawcxV6Client,
  isHawcxV6ApprovalOutcome,
  startV6Flow,
  startV6QrLogin,
  useHawcxV6Auth,
  v6BackToMethodSelection,
  v6GetSessionToken,
  v6LaunchRedirect,
  v6ListDevices,
  v6LogoutEverywhere,
  v6RevokeDevice,
} from '../index';
import { normalizeV6FlowEvent } from '../v6Normalization';
import { createInitialHawcxV6AuthState, reduceHawcxV6FlowEvent } from '../v6State';

const native = NativeModules.HawcxReactNative as Record<string, jest.Mock>;

const base = {
  session: 'auth_1',
  traceId: 'trace_1',
  expiresAt: '2099-01-01T00:10:00Z',
};

const prompt = (p: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'prompt',
  payload: { ...base, ...extra, prompt: p },
});

const reduceAll = (events: unknown[]) =>
  events.reduce(
    (state, raw) =>
      reduceHawcxV6FlowEvent(normalizeV6FlowEvent(raw) as HawcxV6FlowEvent, state as never),
    createInitialHawcxV6AuthState(),
  ) as ReturnType<typeof createInitialHawcxV6AuthState>;

const nativeError = (code: string, message: string, userInfo?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, userInfo });

afterEach(() => {
  jest.clearAllMocks();
  __INTERNAL_EVENTS__.v6FlowEmitter.removeAllListeners(__INTERNAL_EVENTS__.v6FlowEventName);
});

describe('normalization of the 6.2 fields', () => {
  it('reads the locked step', () => {
    const event = normalizeV6FlowEvent(
      prompt({ type: 'locked', retryAfterSeconds: 300, lockedUntil: '2099-01-01T00:05:00Z' }),
    );
    expect(event?.type === 'prompt' && event.payload.prompt).toEqual({
      type: 'locked',
      retryAfterSeconds: 300,
      lockedUntil: '2099-01-01T00:05:00Z',
    });
  });

  it('surfaces a locked step without lockedUntil as unknown, never drops it', () => {
    const event = normalizeV6FlowEvent(prompt({ type: 'locked', retryAfterSeconds: 3 }));
    expect(event?.type === 'prompt' && event.payload.prompt).toEqual({
      type: 'unknown',
      rawType: 'locked',
    });
  });

  it('reads the approvals v2 fields of await_approval', () => {
    const event = normalizeV6FlowEvent(
      prompt({
        type: 'await_approval',
        expiresAt: '2099-01-01T00:02:00Z',
        pollInterval: 2,
        mode: 'push',
        approvalId: 'appr_1',
        number: 42,
      }),
    );
    expect(event?.type === 'prompt' && event.payload.prompt).toEqual({
      type: 'await_approval',
      qrData: undefined,
      expiresAt: '2099-01-01T00:02:00Z',
      pollInterval: 2,
      mode: 'push',
      approvalId: 'appr_1',
      number: 42,
    });
  });

  it('ignores a bogus mode or a non-integer number', () => {
    const event = normalizeV6FlowEvent(
      prompt({
        type: 'await_approval',
        expiresAt: '2099-01-01T00:02:00Z',
        pollInterval: 2,
        mode: 'carrier_pigeon',
        number: 4.2,
      }),
    );
    const p = event?.type === 'prompt' ? (event.payload.prompt as Record<string, unknown>) : {};
    expect(p.mode).toBeUndefined();
    expect(p.number).toBeUndefined();
  });

  it('reads setup_totp backup codes and the step notice', () => {
    const event = normalizeV6FlowEvent(
      prompt(
        {
          type: 'setup_totp',
          secret: 'S',
          otpauthUrl: 'otpauth://totp/x',
          backupCodes: ['AAAA-BBBB', 7, 'CCCC-DDDD'],
        },
        { notice: { code: 'device_revoked', message: 'This device was revoked' } },
      ),
    );
    expect(event?.type).toBe('prompt');
    if (event?.type !== 'prompt') return;
    expect(event.payload.notice).toEqual({
      code: 'device_revoked',
      message: 'This device was revoked',
    });
    expect(event.payload.prompt).toMatchObject({ backupCodes: ['AAAA-BBBB', 'CCCC-DDDD'] });
  });

  it('reads hasSessionToken on completed, never a token', () => {
    const event = normalizeV6FlowEvent({
      type: 'completed',
      payload: {
        session: 's',
        authCode: 'c',
        expiresAt: 'e',
        hasSessionToken: true,
        sessionToken: 'should-not-pass',
      },
    });
    expect(event).toEqual({
      type: 'completed',
      payload: {
        session: 's',
        authCode: 'c',
        expiresAt: 'e',
        codeVerifier: undefined,
        traceId: undefined,
        hasSessionToken: true,
      },
    });
  });

  it('reads approval outcome details on errors', () => {
    const event = normalizeV6FlowEvent({
      type: 'error',
      payload: {
        code: 'approval_resolved',
        message: 'Already handled',
        retryable: false,
        action: 'abort',
        details: { retryAfterSeconds: 1, outcome: 'superseded', decidedByThisDevice: false },
      },
    });
    expect(event?.type === 'error' && event.payload.details).toEqual({
      retryAfterSeconds: 1,
      retryAt: undefined,
      attemptsRemaining: undefined,
      errors: undefined,
      outcome: 'superseded',
      decidedByThisDevice: false,
    });
  });

  it('reads a notice event', () => {
    expect(
      normalizeV6FlowEvent({
        type: 'notice',
        payload: { code: 'unauthorized_device', message: 'm' },
      }),
    ).toEqual({ type: 'notice', payload: { code: 'unauthorized_device', message: 'm' } });
    expect(normalizeV6FlowEvent({ type: 'notice', payload: { code: 'x' } })).toBeNull();
  });
});

describe('reducer', () => {
  it('enters locked without loading, polling or retry flags', () => {
    const state = reduceAll([
      prompt({ type: 'locked', retryAfterSeconds: 60, lockedUntil: '2099-01-01T00:01:00Z' }),
    ]);
    expect(state).toMatchObject({
      status: 'locked',
      locked: { retryAfterSeconds: 60, lockedUntil: '2099-01-01T00:01:00Z' },
      isLoading: false,
      awaitingApproval: false,
    });
  });

  it('exposes the approval display while awaiting, and the outcome after it ends', () => {
    const awaiting = reduceAll([
      prompt({
        type: 'await_approval',
        expiresAt: '2099-01-01T00:02:00Z',
        pollInterval: 2,
        mode: 'push',
        approvalId: 'appr_1',
        number: 42,
      }),
    ]);
    expect(awaiting).toMatchObject({
      status: 'await_approval',
      awaitingApproval: true,
      approval: { mode: 'push', approvalId: 'appr_1', number: 42 },
    });

    const denied = reduceHawcxV6FlowEvent(
      {
        type: 'error',
        payload: { code: 'approval_wrong_number', message: 'x', retryable: false, action: 'abort' },
      },
      awaiting,
    );
    expect(denied).toMatchObject({
      status: 'error',
      awaitingApproval: false,
      approvalOutcome: 'approval_wrong_number',
    });
  });

  it('has no approval display for a v1 await_approval', () => {
    const state = reduceAll([
      prompt({
        type: 'await_approval',
        expiresAt: '2099-01-01T00:02:00Z',
        pollInterval: 2,
        qrData: 'q',
      }),
    ]);
    expect(state.approval).toBeUndefined();
  });

  it('keeps a notice until a new flow starts', () => {
    const state = reduceAll([
      { type: 'notice', payload: { code: 'unauthorized_device', message: 'Signed out' } },
      prompt({ type: 'select_method', methods: [{ id: 'email', label: 'Email' }] }),
    ]);
    expect(state.notice).toEqual({ code: 'unauthorized_device', message: 'Signed out' });
    expect(state.status).toBe('select_method');
  });

  it('flags approval outcome codes only', () => {
    expect(isHawcxV6ApprovalOutcome('approval_denied')).toBe(true);
    expect(isHawcxV6ApprovalOutcome('approval_blocked')).toBe(true);
    expect(isHawcxV6ApprovalOutcome('push_rate_limited')).toBe(false);
  });
});

describe('start options', () => {
  it('passes scope and samlReqId through', async () => {
    await startV6Flow({
      identifier: 'user@example.com',
      scope: ' openid profile ',
      samlReqId: ' samlreq_abc123 ',
    });
    expect(native.v6Start).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'user@example.com',
        flowType: 'signin',
        scope: 'openid profile',
        samlReqId: 'samlreq_abc123',
      }),
    );
  });

  it('starts an anonymous qr_login without an identifier', async () => {
    await startV6Flow({ method: 'qr_login' });
    expect(native.v6Start).toHaveBeenCalledWith({ method: 'qr_login', flowType: 'signin' });

    await startV6QrLogin({ codeChallenge: ' abc ' });
    expect(native.v6Start).toHaveBeenLastCalledWith({
      method: 'qr_login',
      flowType: 'signin',
      codeChallenge: 'abc',
    });
  });

  it('rejects qr_login with an identifier or a non-signin flow', async () => {
    await expect(
      startV6Flow({ method: 'qr_login', identifier: 'user@example.com' }),
    ).rejects.toThrow('identifier must be omitted for qr_login');
    await expect(startV6Flow({ method: 'qr_login', flowType: 'signup' })).rejects.toThrow(
      'qr_login is a signin flow',
    );
    await expect(startV6Flow({ method: 'qr_login', scope: 'openid' })).rejects.toThrow(
      'scope, samlReqId, startToken and inviteCode are not supported with qr_login',
    );
    expect(native.v6Start).not.toHaveBeenCalled();
  });

  it('still requires an identifier otherwise', async () => {
    await expect(startV6Flow({})).rejects.toThrow('identifier is required');
  });
});

describe('flow and account methods', () => {
  it('goes back to the method list', async () => {
    native.v6BackToMethodSelection.mockResolvedValueOnce(true);
    await expect(v6BackToMethodSelection()).resolves.toBe(true);
    await expect(hawcxV6Client.backToMethodSelection()).resolves.toBe(false);
  });

  it('reads the session token on demand only', async () => {
    native.v6GetSessionToken.mockResolvedValueOnce('jwt');
    await expect(v6GetSessionToken()).resolves.toBe('jwt');
    native.v6GetSessionToken.mockResolvedValueOnce(null);
    await expect(hawcxV6Client.getSessionToken()).resolves.toBeNull();
  });

  it('lists devices with the given token or the flow token', async () => {
    native.v6ListDevices.mockResolvedValueOnce([
      {
        deviceId: 'd1',
        h2index: 'ab',
        createdAt: '2026-01-01T00:00:00Z',
        revoked: false,
        deviceInfo: { os: 'iOS' },
      },
      { bogus: true },
    ]);
    await expect(v6ListDevices('jwt')).resolves.toEqual([
      {
        deviceId: 'd1',
        h2index: 'ab',
        createdAt: '2026-01-01T00:00:00Z',
        revoked: false,
        revokedAt: undefined,
        deviceInfo: { os: 'iOS' },
      },
    ]);
    expect(native.v6ListDevices).toHaveBeenCalledWith('jwt');

    await hawcxV6Client.listDevices();
    expect(native.v6ListDevices).toHaveBeenLastCalledWith(null);
  });

  it('revokes a device and logs out everywhere', async () => {
    await v6RevokeDevice(null, ' d1 ', ' lost ');
    expect(native.v6RevokeDevice).toHaveBeenCalledWith(null, 'd1', 'lost');
    await expect(v6RevokeDevice('jwt', ' ')).rejects.toThrow('deviceId is required');

    native.v6LogoutEverywhere.mockResolvedValueOnce({ sessionsEnded: 3 });
    await expect(v6LogoutEverywhere('jwt')).resolves.toEqual({ sessionsEnded: 3 });
  });

  it('maps native rejections to HawcxServiceError', async () => {
    native.v6RevokeDevice.mockRejectedValueOnce(
      nativeError('cannot_revoke_current_device', 'Not this one', {
        status: 403,
        retryable: false,
      }),
    );
    const error = await v6RevokeDevice('jwt', 'd1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HawcxServiceError);
    expect(error).toMatchObject({
      code: 'cannot_revoke_current_device',
      message: 'Not this one',
      status: 403,
      retryable: false,
    });

    native.v6ListDevices.mockRejectedValueOnce(
      nativeError('rate_limited', 'Slow down', {
        status: 429,
        retryable: true,
        retryAfterSeconds: 7,
      }),
    );
    await expect(v6ListDevices()).rejects.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      retryAfterSeconds: 7,
    });
  });

  it('launches a redirect step', async () => {
    native.v6LaunchRedirect.mockResolvedValueOnce({ launchedWith: 'custom_tab' });
    await expect(v6LaunchRedirect(' https://idp.example.com/x ', 'myapp')).resolves.toEqual({
      launchedWith: 'custom_tab',
    });
    expect(native.v6LaunchRedirect).toHaveBeenCalledWith('https://idp.example.com/x', 'myapp');
    await expect(v6LaunchRedirect('')).rejects.toThrow('url is required');
  });

  it('delivers notice events to flow listeners', () => {
    const handler = jest.fn();
    addV6FlowListener(handler);
    __INTERNAL_EVENTS__.v6FlowEmitter.emit(__INTERNAL_EVENTS__.v6FlowEventName, {
      type: 'notice',
      payload: { code: 'device_revoked', message: 'm' },
    } as never);
    expect(handler).toHaveBeenCalledWith({
      type: 'notice',
      payload: { code: 'device_revoked', message: 'm' },
    });
  });
});

describe('useHawcxV6Auth', () => {
  const Harness = forwardRef<HawcxV6AuthHookResult>((_, ref) => {
    const value = useHawcxV6Auth(hawcxV6Client);
    useImperativeHandle(ref, () => value, [value]);
    return null;
  });

  let renderer: TestRenderer.ReactTestRenderer | undefined;
  let ref: React.RefObject<HawcxV6AuthHookResult>;

  beforeEach(async () => {
    ref = React.createRef<HawcxV6AuthHookResult>();
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Harness, { ref }));
    });
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
  });

  it('exposes startQrLogin and backToMethodSelection', async () => {
    await act(async () => {
      await ref.current!.startQrLogin();
    });
    expect(native.v6Start).toHaveBeenCalledWith({ method: 'qr_login', flowType: 'signin' });
    expect(ref.current!.state.identifier).toBeUndefined();

    native.v6BackToMethodSelection.mockResolvedValueOnce(true);
    let went = false;
    await act(async () => {
      went = await ref.current!.backToMethodSelection();
    });
    expect(went).toBe(true);
  });

  it('clears a notice when a new flow starts', async () => {
    await act(async () => {
      __INTERNAL_EVENTS__.v6FlowEmitter.emit(__INTERNAL_EVENTS__.v6FlowEventName, {
        type: 'notice',
        payload: { code: 'device_revoked', message: 'm' },
      } as never);
    });
    expect(ref.current!.state.notice?.code).toBe('device_revoked');
    await act(async () => {
      await ref.current!.start({ identifier: 'user@example.com' });
    });
    expect(ref.current!.state.notice).toBeUndefined();
  });
});

describe('native bridges', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
  const kotlinBridge = () =>
    read('android/src/main/java/com/hawcx/reactnative/v6/HawcxV6Bridge.kt');
  const kotlinModule = () =>
    read('android/src/main/java/com/hawcx/reactnative/HawcxReactNativeModule.kt');
  const swift = () => read('ios/HawcxV6BridgeSupport.swift');

  it('encode locked, approval display, notice and backup codes on both platforms', () => {
    for (const source of [swift(), kotlinBridge()]) {
      expect(source).toContain('"locked"');
      expect(source).toContain('"lockedUntil"');
      expect(source).toContain('"approvalId"');
      expect(source).toContain('"backupCodes"');
      expect(source).toContain('"notice"');
      expect(source).toContain('"hasSessionToken"');
      expect(source).toContain('"decidedByThisDevice"');
    }
  });

  it('never put the session token on a flow event', () => {
    for (const source of [swift(), kotlinBridge()]) {
      expect(source).not.toMatch(/"sessionToken"/);
    }
  });

  it('expose the new methods on Android', () => {
    const module = kotlinModule();
    for (const name of [
      'v6BackToMethodSelection(promise: Promise)',
      'v6GetSessionToken(promise: Promise)',
      'v6ListDevices(sessionToken: String?, promise: Promise)',
      'v6RevokeDevice(sessionToken: String?, deviceId: String?, reason: String?, promise: Promise)',
      'v6LogoutEverywhere(sessionToken: String?, promise: Promise)',
      'v6LaunchRedirect(url: String?, returnScheme: String?, promise: Promise)',
    ]) {
      expect(module).toMatch(new RegExp(`@ReactMethod\\s+fun ${name.replace(/[()?]/g, '\\$&')}`));
    }
  });
});
