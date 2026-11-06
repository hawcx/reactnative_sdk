import fs from 'fs';
import path from 'path';
import React, { forwardRef, useImperativeHandle } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';
import type {
  HawcxApproverHookResult,
  HawcxV6ApprovalReference,
  HawcxV6AuthHookResult,
  HawcxV6FlowEvent,
} from '../index';
import {
  __INTERNAL_EVENTS__,
  forgetDevice,
  HAWCX_APPROVAL_NOTIFICATION_CATEGORY,
  HawcxServiceError,
  hawcxV6Client,
  resolveApprovalCode,
  useHawcxApprover,
  useHawcxV6Auth,
} from '../index';
import { normalizeV6FlowEvent } from '../v6Normalization';
import { createInitialHawcxV6AuthState, reduceHawcxV6FlowEvent } from '../v6State';

const native = NativeModules.HawcxReactNative as Record<string, jest.Mock>;

const nativeError = (code: string, message: string, userInfo?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, userInfo });

const base = {
  session: 'auth_1',
  traceId: 'trace_1',
  expiresAt: '2099-01-01T00:10:00Z',
};

const awaitQr = (extra: Record<string, unknown> = {}) => ({
  type: 'prompt',
  payload: {
    ...base,
    prompt: {
      type: 'await_approval',
      expiresAt: '2099-01-01T00:02:00Z',
      pollInterval: 2,
      qrData: '{"v":2,"type":"qr_login","project_id":"p","approval_id":"a"}',
      mode: 'qr',
      approvalId: 'appr_1',
      ...extra,
    },
  },
});

const completed = (extra: Record<string, unknown> = {}) => ({
  type: 'completed',
  payload: { session: 's', authCode: 'c', expiresAt: 'e', hasSessionToken: true, ...extra },
});

const reduceAll = (events: unknown[], initial = createInitialHawcxV6AuthState()) =>
  events.reduce(
    (state, raw) =>
      reduceHawcxV6FlowEvent(normalizeV6FlowEvent(raw) as HawcxV6FlowEvent, state as never),
    initial,
  ) as ReturnType<typeof createInitialHawcxV6AuthState>;

const reference: HawcxV6ApprovalReference = {
  kind: 'qr_login',
  projectId: 'proj_x',
  approvalId: 'appr_x',
  expiresAt: '2099-01-01T00:02:00.000Z',
};

afterEach(() => {
  jest.clearAllMocks();
  __INTERNAL_EVENTS__.v6FlowEmitter.removeAllListeners(__INTERNAL_EVENTS__.v6FlowEventName);
});

describe('manualCode on await_approval', () => {
  const promptOf = (raw: unknown) => {
    const event = normalizeV6FlowEvent(raw);
    return event?.type === 'prompt' ? (event.payload.prompt as Record<string, unknown>) : {};
  };

  it('keeps an 8-digit code', () => {
    expect(promptOf(awaitQr({ manualCode: '48217093' }))).toMatchObject({
      type: 'await_approval',
      mode: 'qr',
      manualCode: '48217093',
    });
  });

  it.each([
    ['too short', '4821709'],
    ['too long', '482170931'],
    ['spaced', '4821 7093'],
    ['hyphenated', '4821-7093'],
    ['letters', '4821709a'],
    ['non-ASCII digits', '٤٨٢١٧٠٩٣'],
    ['a number', 48217093],
    ['empty', ''],
  ])('drops a code that is not 8 ASCII digits (%s)', (_label, manualCode) => {
    const prompt = promptOf(awaitQr({ manualCode }));
    expect(prompt.type).toBe('await_approval');
    expect(prompt).not.toHaveProperty('manualCode');
  });

  it('is absent when the server sent none', () => {
    expect(promptOf(awaitQr())).not.toHaveProperty('manualCode');
  });

  it('reaches state.approval and leaves with the prompt', () => {
    const awaiting = reduceAll([awaitQr({ manualCode: '48217093', number: 42 })]);
    expect(awaiting.approval).toEqual({
      mode: 'qr',
      approvalId: 'appr_1',
      number: 42,
      manualCode: '48217093',
    });
    const done = reduceAll([completed()], awaiting);
    expect(done.approval).toBeUndefined();
  });
});

describe('completion identifier', () => {
  it('reads identifier on completed, dropping a blank one', () => {
    expect(normalizeV6FlowEvent(completed({ identifier: ' user@example.com ' }))).toMatchObject({
      type: 'completed',
      payload: { identifier: 'user@example.com' },
    });
    const blank = normalizeV6FlowEvent(completed({ identifier: '  ' }));
    expect(blank?.type === 'completed' && blank.payload).not.toHaveProperty('identifier');
    const missing = normalizeV6FlowEvent(completed());
    expect(missing?.type === 'completed' && missing.payload).not.toHaveProperty('identifier');
  });

  it('names the account of an anonymous QR sign-in on the state', () => {
    const state = reduceAll([
      awaitQr({ manualCode: '48217093' }),
      completed({ identifier: 'picked@example.com' }),
    ]);
    expect(state).toMatchObject({
      status: 'completed',
      identifier: 'picked@example.com',
      completed: { identifier: 'picked@example.com' },
    });
  });

  it('keeps the typed identifier when the completion names none', () => {
    const typed = { ...createInitialHawcxV6AuthState(), identifier: 'typed@example.com' };
    expect(reduceAll([completed()], typed).identifier).toBe('typed@example.com');
  });
});

describe('resolveApprovalCode', () => {
  it('sends the 8 digits without spaces or hyphens and returns the scan shape', async () => {
    native.v6ResolveApprovalCode.mockResolvedValueOnce({ version: 2, reference });
    await expect(resolveApprovalCode(' 4821 7093 ')).resolves.toEqual({ version: 2, reference });
    expect(native.v6ResolveApprovalCode).toHaveBeenLastCalledWith('48217093');

    native.v6ResolveApprovalCode.mockResolvedValueOnce({ version: 1, payloadType: 'qr_auth' });
    await expect(resolveApprovalCode('4821-7093')).resolves.toEqual({
      version: 1,
      payloadType: 'qr_auth',
    });
    expect(native.v6ResolveApprovalCode).toHaveBeenLastCalledWith('48217093');
  });

  it.each(['', '1234567', '123456789', '1234-567a', '١٢٣٤٥٦٧٨'])(
    'refuses %p locally with invalid_code_format',
    async (code) => {
      const error = await resolveApprovalCode(code).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HawcxServiceError);
      expect(error).toMatchObject({ code: 'invalid_code_format', retryable: false });
      expect(native.v6ResolveApprovalCode).not.toHaveBeenCalled();
    },
  );

  it('maps the native code errors to HawcxServiceError', async () => {
    native.v6ResolveApprovalCode.mockRejectedValueOnce(
      nativeError('code_not_found', 'No sign-in request has this code.', {
        status: 404,
        retryable: false,
      }),
    );
    await expect(resolveApprovalCode('48217093')).rejects.toMatchObject({
      code: 'code_not_found',
      status: 404,
      retryable: false,
    });

    native.v6ResolveApprovalCode.mockRejectedValueOnce(
      nativeError('too_many_attempts', 'Too many attempts.', {
        status: 429,
        retryable: true,
        retryAfterSeconds: 30,
      }),
    );
    await expect(resolveApprovalCode('48217093')).rejects.toMatchObject({
      code: 'too_many_attempts',
      status: 429,
      retryable: true,
      retryAfterSeconds: 30,
    });

    native.v6ResolveApprovalCode.mockRejectedValueOnce(
      nativeError('service_unavailable', 'Try again shortly.', {
        status: 503,
        retryable: true,
        serverCode: 'approval_store_unavailable',
      }),
    );
    const unavailable = await resolveApprovalCode('48217093').catch((e: unknown) => e);
    expect(unavailable).toBeInstanceOf(HawcxServiceError);
    expect(unavailable).toMatchObject({
      code: 'service_unavailable',
      status: 503,
      retryable: true,
      serverCode: 'approval_store_unavailable',
    });

    native.v6ResolveApprovalCode.mockRejectedValueOnce(
      nativeError('http_error', 'Not found', { status: 404, retryable: false }),
    );
    await expect(resolveApprovalCode('48217093')).rejects.toMatchObject({
      code: 'http_error',
      status: 404,
    });
  });

  it('rejects an unreadable native answer instead of resolving null', async () => {
    native.v6ResolveApprovalCode.mockResolvedValueOnce(null);
    await expect(resolveApprovalCode('48217093')).rejects.toMatchObject({
      code: 'response_decoding_failed',
    });
  });
});

describe('forgetDevice', () => {
  it('forgets the v6 device keys of one identifier', async () => {
    native.v6ForgetDevice.mockResolvedValueOnce(true);
    await expect(forgetDevice(' user@example.com ')).resolves.toBe(true);
    expect(native.v6ForgetDevice).toHaveBeenLastCalledWith('user@example.com');

    native.v6ForgetDevice.mockResolvedValueOnce(false);
    await expect(hawcxV6Client.forgetDevice('user@example.com')).resolves.toBe(false);

    native.v6ForgetDevice.mockResolvedValueOnce('yes');
    await expect(forgetDevice('user@example.com')).resolves.toBe(false);
  });

  it('requires an identifier and never calls the legacy clear', async () => {
    await expect(forgetDevice('  ')).rejects.toThrow('identifier is required');
    expect(native.v6ForgetDevice).not.toHaveBeenCalled();
    expect(native.clearUserKeychainData).not.toHaveBeenCalled();
  });

  it('maps a native rejection to HawcxServiceError', async () => {
    native.v6ForgetDevice.mockRejectedValueOnce(nativeError('hawcx.sdk', 'Not initialized'));
    const error = await forgetDevice('user@example.com').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HawcxServiceError);
    expect(error).toMatchObject({ code: 'hawcx.sdk' });
  });
});

describe('approval notification category', () => {
  it('is HAWCX_APPROVAL', () => {
    expect(HAWCX_APPROVAL_NOTIFICATION_CATEGORY).toBe('HAWCX_APPROVAL');
  });

  it('comes from the native SDK when the bridge exports it', () => {
    const original = native.approvalNotificationCategory;
    (native as Record<string, unknown>).approvalNotificationCategory = 'FROM_NATIVE';
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const isolated = require('../index');
        expect(isolated.HAWCX_APPROVAL_NOTIFICATION_CATEGORY).toBe('FROM_NATIVE');
      });
    } finally {
      (native as Record<string, unknown>).approvalNotificationCategory = original;
    }
  });
});

describe('useHawcxApprover().resolveCode', () => {
  const Harness = forwardRef<HawcxApproverHookResult>((_, ref) => {
    const value = useHawcxApprover();
    useImperativeHandle(ref, () => value, [value]);
    return null;
  });

  let renderer: TestRenderer.ReactTestRenderer | undefined;
  let ref: React.RefObject<HawcxApproverHookResult>;

  beforeEach(async () => {
    ref = React.createRef<HawcxApproverHookResult>();
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Harness, { ref }));
    });
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
  });

  it('resolves a code to the same reference a scan gives, then fetches it', async () => {
    native.v6ResolveApprovalCode.mockResolvedValueOnce({ version: 2, reference });
    native.v6FetchApprovalContext.mockResolvedValueOnce({
      handle: 'h-1',
      reference,
      identifier: 'user@example.com',
      mode: 'qr',
      requester: { requestedAt: '2099-01-01T00:00:00.000Z' },
      numberRequired: false,
      expiresAt: '2099-01-01T00:02:00.000Z',
    });
    let scanned: unknown;
    await act(async () => {
      scanned = await ref.current!.resolveCode('4821 7093');
    });
    expect(scanned).toEqual({ version: 2, reference });
    await act(async () => {
      await ref.current!.fetch(reference, 'user@example.com');
    });
    expect(native.v6FetchApprovalContext).toHaveBeenCalledWith(reference, 'user@example.com');
    expect(ref.current!.request?.handle).toBe('h-1');
  });

  it('records the error of a failed lookup', async () => {
    native.v6ResolveApprovalCode.mockRejectedValueOnce(
      nativeError('code_not_found', 'No sign-in request has this code.', {
        status: 404,
        retryable: false,
      }),
    );
    await act(async () => {
      await ref.current!.resolveCode('48217093').catch(() => undefined);
    });
    expect(ref.current!.error).toMatchObject({ code: 'code_not_found', status: 404 });
    expect(ref.current!.loading).toBe(false);
  });

  it('records a locally refused format too', async () => {
    await act(async () => {
      await ref.current!.resolveCode('123').catch(() => undefined);
    });
    expect(ref.current!.error).toMatchObject({ code: 'invalid_code_format' });
    expect(native.v6ResolveApprovalCode).not.toHaveBeenCalled();
  });
});

describe('QR sign-in through the hook', () => {
  const Harness = forwardRef<HawcxV6AuthHookResult>((_, ref) => {
    const value = useHawcxV6Auth(hawcxV6Client);
    useImperativeHandle(ref, () => value, [value]);
    return null;
  });

  it('shows the QR and its code, then completes as the account the phone chose', async () => {
    const ref = React.createRef<HawcxV6AuthHookResult>();
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Harness, { ref }));
    });
    await act(async () => {
      await ref.current!.startQrLogin();
    });
    expect(ref.current!.state.identifier).toBeUndefined();

    const emit = (event: unknown) =>
      __INTERNAL_EVENTS__.v6FlowEmitter.emit(__INTERNAL_EVENTS__.v6FlowEventName, event as never);
    await act(async () => {
      emit(awaitQr({ manualCode: '48217093' }));
    });
    expect(ref.current!.state.status).toBe('await_approval');
    expect(ref.current!.state.approval?.manualCode).toBe('48217093');

    await act(async () => {
      emit(completed({ identifier: 'picked@example.com' }));
    });
    expect(ref.current!.state).toMatchObject({
      status: 'completed',
      identifier: 'picked@example.com',
      completed: { authCode: 'c', identifier: 'picked@example.com' },
    });
    renderer?.unmount();
  });
});

describe('native bridges', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
  const swiftFlow = () => read('ios/HawcxV6BridgeSupport.swift');
  const swiftModule = () => read('ios/HawcxReactNative.swift');
  const swiftApprover = () => read('ios/HawcxV6ApproverBridge.swift');
  const kotlinFlow = () => read('android/src/main/java/com/hawcx/reactnative/v6/HawcxV6Bridge.kt');
  const kotlinApprover = () =>
    read('android/src/main/java/com/hawcx/reactnative/v6/HawcxV6ApproverBridge.kt');
  const kotlinModule = () =>
    read('android/src/main/java/com/hawcx/reactnative/HawcxReactNativeModule.kt');

  it('encode manualCode and the completion identifier on both platforms', () => {
    for (const source of [swiftFlow(), kotlinFlow()]) {
      expect(source).toContain('"manualCode"');
      expect(source).toMatch(/"identifier"/);
    }
  });

  it('resolve codes through the native approvals service on both platforms', () => {
    expect(swiftApprover()).toContain('approvals.resolveCode(');
    expect(kotlinApprover()).toContain('approvals.resolveCode(');
    expect(swiftModule()).toContain('"serverCode"');
    expect(kotlinFlow()).toContain('"serverCode"');
  });

  it('forget v6 device keys through HawcxV1SDK.forgetDevice on both platforms', () => {
    expect(swiftFlow()).toContain('sdk.forgetDevice(identifier:');
    expect(kotlinFlow()).toContain('sdk.forgetDevice(');
  });

  it('export the notification category from the native SDKs', () => {
    expect(swiftModule()).toContain('HawcxV1ApprovalService.notificationCategory');
    expect(kotlinModule()).toContain('HawcxV1ApprovalService.NOTIFICATION_CATEGORY');
  });

  it('expose the new methods on Android', () => {
    const module = kotlinModule();
    for (const name of [
      'v6ResolveApprovalCode(code: String?, promise: Promise)',
      'v6ForgetDevice(identifier: String?, promise: Promise)',
    ]) {
      expect(module).toMatch(new RegExp(`@ReactMethod\\s+fun ${name.replace(/[()?]/g, '\\$&')}`));
    }
  });
});
