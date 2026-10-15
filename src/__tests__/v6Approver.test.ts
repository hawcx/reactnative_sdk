import fs from 'fs';
import path from 'path';
import React, { forwardRef, useImperativeHandle } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { NativeModules, Platform } from 'react-native';
import type { HawcxApproverHookResult, HawcxV6ApprovalReference } from '../index';
import {
  approvalReferenceFromPush,
  approveV6Qr,
  decideApproval,
  discardApproval,
  enrolledIdentifiers,
  fetchApprovalContext,
  HawcxServiceError,
  registerPushToken,
  registerPushTokenWithReport,
  scanApproval,
  setFcmToken,
  unregisterPushToken,
  useHawcxApprover,
  useHawcxV6Auth,
  __resetDeprecationWarningsForTests,
} from '../index';

const native = NativeModules.HawcxReactNative as Record<string, jest.Mock>;
const ORIGINAL_PLATFORM = Platform.OS;
const setPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

const nativeError = (code: string, message: string, userInfo?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, userInfo });

const reference: HawcxV6ApprovalReference = {
  kind: 'push_approval',
  projectId: 'proj_x',
  approvalId: 'appr_x',
  expiresAt: '2099-01-01T00:02:00.000Z',
};

const nativeRequest = {
  handle: 'h-1',
  reference,
  identifier: 'user@example.com',
  mode: 'push',
  requester: {
    appName: 'Web',
    origin: 'https://app.example.com',
    browser: 'Chrome on macOS',
    ip: '203.0.113.4',
    location: 'Austin, US',
    requestedAt: '2099-01-01T00:00:00.000Z',
  },
  numberRequired: true,
  expiresAt: '2099-01-01T00:02:00.000Z',
};

afterEach(() => {
  jest.clearAllMocks();
  setPlatform(ORIGINAL_PLATFORM);
});

describe('push-token registration', () => {
  it('registers an APNs token on iOS with the native shape', async () => {
    setPlatform('ios');
    native.v6RegisterPushToken.mockResolvedValueOnce({ registered: 2, orphanedIdentifiers: [] });
    await expect(
      registerPushToken({ provider: 'apns', token: ' ABCDEF01 ', apnsEnv: 'development' }),
    ).resolves.toEqual({ registered: 2 });
    expect(native.v6RegisterPushToken).toHaveBeenCalledWith(
      { provider: 'apns', token: 'abcdef01', apnsEnv: 'development' },
      false,
    );
  });

  it('turns APNs token bytes into lowercase hex', async () => {
    setPlatform('ios');
    native.v6RegisterPushToken.mockResolvedValueOnce({ registered: 1 });
    await registerPushToken(
      {
        provider: 'apns',
        token: new Uint8Array([0, 171, 255]),
        apnsEnv: 'production',
        appId: 'com.x',
      },
      true,
    );
    expect(native.v6RegisterPushToken).toHaveBeenCalledWith(
      { provider: 'apns', token: '00abff', apnsEnv: 'production', appId: 'com.x' },
      true,
    );
  });

  it('registers an FCM token on Android exactly as given', async () => {
    setPlatform('android');
    native.v6RegisterPushToken.mockResolvedValueOnce({
      registered: 1,
      orphanedIdentifiers: ['old@example.com'],
    });
    await expect(
      registerPushTokenWithReport({ provider: 'fcm', token: 'AbC:dEf-123' }),
    ).resolves.toEqual({ registered: 1, orphanedIdentifiers: ['old@example.com'] });
    expect(native.v6RegisterPushToken).toHaveBeenCalledWith(
      { provider: 'fcm', token: 'AbC:dEf-123' },
      false,
    );
  });

  it('refuses a provider that does not match the platform, without a native call', async () => {
    setPlatform('android');
    await expect(
      registerPushToken({ provider: 'apns', token: 'ab', apnsEnv: 'development' }),
    ).rejects.toMatchObject({ code: 'invalid_registration' });
    setPlatform('ios');
    await expect(registerPushToken({ provider: 'fcm', token: 'x' })).rejects.toMatchObject({
      code: 'invalid_registration',
    });
    expect(native.v6RegisterPushToken).not.toHaveBeenCalled();
  });

  it('unregisters by stored record, by identifier, or explicitly by app id', async () => {
    await unregisterPushToken();
    expect(native.v6UnregisterPushToken).toHaveBeenLastCalledWith(null, null);
    await unregisterPushToken(' user@example.com ');
    expect(native.v6UnregisterPushToken).toHaveBeenLastCalledWith('user@example.com', null);
    await unregisterPushToken({ identifier: 'user@example.com', appId: 'com.example.app' });
    expect(native.v6UnregisterPushToken).toHaveBeenLastCalledWith(
      'user@example.com',
      'com.example.app',
    );
    await expect(unregisterPushToken({ appId: 'com.example.app' } as never)).rejects.toThrow(
      'identifier is required with appId',
    );
  });

  it('surfaces push_not_registered as a typed error', async () => {
    native.v6UnregisterPushToken.mockRejectedValueOnce(
      nativeError('push_not_registered', 'Nothing registered', { retryable: false }),
    );
    const error = await unregisterPushToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HawcxServiceError);
    expect(error).toMatchObject({ code: 'push_not_registered', retryable: false });
  });
});

describe('references', () => {
  it('reads a push payload, unwrapping an FCM data envelope', async () => {
    native.v6ApprovalReferenceFromPush.mockResolvedValueOnce(reference);
    const payload = { data: { hawcx: '{"v":2}' } };
    await expect(approvalReferenceFromPush(payload)).resolves.toEqual(reference);
    expect(native.v6ApprovalReferenceFromPush).toHaveBeenCalledWith({ hawcx: '{"v":2}' });
  });

  it('passes an APNs userInfo through and resolves null for non-Hawcx pushes', async () => {
    native.v6ApprovalReferenceFromPush.mockResolvedValueOnce(null);
    const userInfo = { aps: { alert: 'x' }, hawcx: { v: 2 } };
    await expect(approvalReferenceFromPush(userInfo)).resolves.toBeNull();
    expect(native.v6ApprovalReferenceFromPush).toHaveBeenCalledWith(userInfo);
  });

  it('drops malformed native references', async () => {
    native.v6ApprovalReferenceFromPush.mockResolvedValueOnce({ kind: 'nope', projectId: 'p' });
    await expect(approvalReferenceFromPush({ hawcx: {} })).resolves.toBeNull();
  });

  it('scans v2 and v1 QR codes', async () => {
    native.v6ScanApproval.mockResolvedValueOnce({
      version: 2,
      reference: { ...reference, kind: 'qr_login', expiresAt: undefined },
    });
    await expect(scanApproval(' {"v":2} ')).resolves.toEqual({
      version: 2,
      reference: { kind: 'qr_login', projectId: 'proj_x', approvalId: 'appr_x' },
    });
    expect(native.v6ScanApproval).toHaveBeenCalledWith('{"v":2}');

    native.v6ScanApproval.mockResolvedValueOnce({ version: 1, payloadType: 'qr_auth' });
    await expect(scanApproval('{"v":"1"}')).resolves.toEqual({
      version: 1,
      payloadType: 'qr_auth',
    });

    native.v6ScanApproval.mockResolvedValueOnce(null);
    await expect(scanApproval('hello')).resolves.toBeNull();
  });

  it('routes v1 approvals to approveV6Qr (the facade v1 path)', async () => {
    native.v6ApproveQr.mockResolvedValueOnce({ outcome: 'approved', payloadType: 'qr_auth' });
    await expect(approveV6Qr('{"v":"1"}', 'user@example.com')).resolves.toEqual({
      outcome: 'approved',
      payloadType: 'qr_auth',
    });
    native.v6ApproveQr.mockRejectedValueOnce(
      nativeError('approval_outcome_unknown', 'May have succeeded', { retryable: false }),
    );
    await expect(approveV6Qr('{"v":"1"}', 'user@example.com')).rejects.toMatchObject({
      code: 'approval_outcome_unknown',
    });
  });
});

describe('context and decisions', () => {
  it('fetches a context and returns a handle, never a token', async () => {
    native.v6FetchApprovalContext.mockResolvedValueOnce({
      ...nativeRequest,
      phoneActionToken: 'must-not-cross',
    });
    const request = await fetchApprovalContext(reference);
    expect(native.v6FetchApprovalContext).toHaveBeenCalledWith(reference, null);
    expect(request).toEqual({ ...nativeRequest, locationMismatch: undefined });
    expect(JSON.stringify(request)).not.toContain('must-not-cross');
  });

  it('passes the chosen identifier for qr_login', async () => {
    native.v6FetchApprovalContext.mockResolvedValueOnce({ ...nativeRequest, mode: 'qr' });
    await fetchApprovalContext({ ...reference, kind: 'qr_login' }, ' user@example.com ');
    expect(native.v6FetchApprovalContext).toHaveBeenCalledWith(
      { ...reference, kind: 'qr_login' },
      'user@example.com',
    );
  });

  it('maps context errors with resolved details', async () => {
    native.v6FetchApprovalContext.mockRejectedValueOnce(
      nativeError('approval_resolved', 'Already handled', {
        status: 409,
        retryable: false,
        outcome: 'superseded',
        decidedByThisDevice: false,
      }),
    );
    await expect(fetchApprovalContext(reference)).rejects.toMatchObject({
      code: 'approval_resolved',
      status: 409,
      outcome: 'superseded',
      decidedByThisDevice: false,
    });
  });

  it('approves with the typed number and denies without one', async () => {
    native.v6DecideApproval.mockResolvedValueOnce({ outcome: 'approved' });
    await expect(decideApproval('h-1', 'approve', { numberChoice: 42 })).resolves.toEqual({
      outcome: 'approved',
    });
    expect(native.v6DecideApproval).toHaveBeenLastCalledWith('h-1', 'approve', 42, false);

    native.v6DecideApproval.mockResolvedValueOnce({ outcome: 'denied' });
    await expect(decideApproval('h-1', 'deny', { numberChoice: 42 })).resolves.toEqual({
      outcome: 'denied',
    });
    expect(native.v6DecideApproval).toHaveBeenLastCalledWith('h-1', 'deny', null, false);
  });

  it('maps resolved results', async () => {
    native.v6DecideApproval.mockResolvedValueOnce({
      outcome: 'resolved',
      resolvedOutcome: 'blocked',
      decidedByThisDevice: true,
    });
    await expect(decideApproval('h-1', 'approve', { numberChoice: 10 })).resolves.toEqual({
      outcome: 'resolved',
      resolvedOutcome: 'blocked',
      decidedByThisDevice: true,
    });
  });

  it('rejects a non-integer number locally and leaves range checks to native', async () => {
    await expect(decideApproval('h-1', 'approve', { numberChoice: 4.2 })).rejects.toMatchObject({
      code: 'invalid_number',
    });
    native.v6DecideApproval.mockRejectedValueOnce(
      nativeError('number_required', 'Enter the number', { retryable: false }),
    );
    await expect(decideApproval('h-1', 'approve')).rejects.toMatchObject({
      code: 'number_required',
    });
    expect(native.v6DecideApproval).toHaveBeenLastCalledWith('h-1', 'approve', null, false);
  });

  it('lists enrolled identifiers and discards handles', async () => {
    native.v6EnrolledIdentifiers.mockResolvedValueOnce(['a@example.com', 3, 'b@example.com']);
    await expect(enrolledIdentifiers()).resolves.toEqual(['a@example.com', 'b@example.com']);
    await discardApproval('h-1');
    expect(native.v6DiscardApproval).toHaveBeenCalledWith('h-1');
  });
});

describe('legacy push APIs', () => {
  it('warn once that they are deprecated', async () => {
    __resetDeprecationWarningsForTests();
    setPlatform('android');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await setFcmToken('tok');
    await setFcmToken('tok');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('setFcmToken is deprecated');
    expect(warn.mock.calls[0][0]).not.toContain('tok');
    warn.mockRestore();
  });
});

describe('useHawcxApprover', () => {
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

  it('fetches, approves and records the result', async () => {
    native.v6FetchApprovalContext.mockResolvedValueOnce(nativeRequest);
    native.v6DecideApproval.mockResolvedValueOnce({ outcome: 'approved' });
    await act(async () => {
      await ref.current!.fetch(reference);
    });
    expect(ref.current!.request?.handle).toBe('h-1');
    await act(async () => {
      await ref.current!.approve(42);
    });
    expect(native.v6DecideApproval).toHaveBeenCalledWith('h-1', 'approve', 42, false);
    expect(ref.current!.result).toEqual({ outcome: 'approved' });
    expect(ref.current!.error).toBeUndefined();
  });

  it('keeps the error and the request on a failed decision, and resets', async () => {
    native.v6FetchApprovalContext.mockResolvedValueOnce(nativeRequest);
    native.v6DecideApproval.mockRejectedValueOnce(
      nativeError('approval_not_ready', 'Try again', { retryable: true, retryAfterSeconds: 1 }),
    );
    await act(async () => {
      await ref.current!.fetch(reference);
    });
    await act(async () => {
      await ref.current!.deny().catch(() => undefined);
    });
    expect(ref.current!.error).toMatchObject({ code: 'approval_not_ready', retryable: true });
    expect(ref.current!.request?.handle).toBe('h-1');
    await act(async () => {
      await ref.current!.reset();
    });
    expect(native.v6DiscardApproval).toHaveBeenCalledWith('h-1');
    expect(ref.current!.request).toBeUndefined();
  });
});

describe('requester hook', () => {
  const Harness = forwardRef<Record<string, unknown>>((_, ref) => {
    const value = useHawcxV6Auth();
    useImperativeHandle(ref, () => value as unknown as Record<string, unknown>, [value]);
    return null;
  });

  it('exposes nothing of the approver', async () => {
    const ref = React.createRef<Record<string, unknown>>();
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Harness, { ref }));
    });
    for (const key of ['fetch', 'approve', 'deny', 'decideApproval', 'registerPushToken']) {
      expect(ref.current).not.toHaveProperty(key);
    }
    renderer?.unmount();
  });
});

describe('native bridges', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

  it('keep the phone action token native on both platforms', () => {
    const sources = [
      read('ios/HawcxV6ApproverBridge.swift'),
      read('android/src/main/java/com/hawcx/reactnative/v6/HawcxV6ApproverBridge.kt'),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/phoneActionToken/);
      expect(source).toContain('"handle"');
      expect(source).toContain('"resolvedOutcome"');
      expect(source).toContain('approveV1');
    }
  });

  it('expose the approver methods on Android', () => {
    const module = read('android/src/main/java/com/hawcx/reactnative/HawcxReactNativeModule.kt');
    for (const name of [
      'v6RegisterPushToken',
      'v6UnregisterPushToken',
      'v6ApprovalReferenceFromPush',
      'v6ScanApproval',
      'v6FetchApprovalContext',
      'v6DecideApproval',
      'v6DiscardApproval',
      'v6EnrolledIdentifiers',
    ]) {
      expect(module).toMatch(new RegExp(`@ReactMethod\\s+fun ${name}\\(`));
    }
  });
});
