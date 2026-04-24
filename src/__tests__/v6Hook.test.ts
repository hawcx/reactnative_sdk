import React, { forwardRef, useImperativeHandle } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';
import type { HawcxV6AuthHookResult } from '../index';
import { __INTERNAL_EVENTS__, hawcxV6Client, useHawcxV6Auth } from '../index';

type HookHarnessProps = {
  options?: Parameters<typeof useHawcxV6Auth>[1];
};

const HookHarness = forwardRef<HawcxV6AuthHookResult, HookHarnessProps>(({ options }, ref) => {
  const value = useHawcxV6Auth(hawcxV6Client, options);
  useImperativeHandle(ref, () => value, [value]);
  return null;
});

const emitV6 = (event: unknown) => {
  __INTERNAL_EVENTS__.v6FlowEmitter.emit(__INTERNAL_EVENTS__.v6FlowEventName, event as never);
};

describe('useHawcxV6Auth', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  let ref: React.RefObject<HawcxV6AuthHookResult>;

  const renderHook = async (options?: HookHarnessProps['options']) => {
    ref = React.createRef<HawcxV6AuthHookResult>();
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHarness, { ref, options }));
    });
  };

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    __INTERNAL_EVENTS__.v6FlowEmitter.removeAllListeners(__INTERNAL_EVENTS__.v6FlowEventName);
    if (renderer) {
      const currentRenderer = renderer;
      currentRenderer.unmount();
      renderer = undefined;
    }
  });

  it('starts a flow with normalized options and keeps identifier state locally', async () => {
    await renderHook({ flowType: 'signup' });

    await act(async () => {
      await ref.current!.start({ identifier: ' user@example.com ' });
    });

    expect(NativeModules.HawcxReactNative.v6Start).toHaveBeenCalledWith({
      identifier: 'user@example.com',
      flowType: 'signup',
      startToken: undefined,
      inviteCode: undefined,
      codeChallenge: undefined,
    });
    expect(ref.current!.state).toMatchObject({
      status: 'identifier',
      flowType: 'signup',
      identifier: 'user@example.com',
    });
  });

  it('tracks prompt transitions and resend countdown without raw event handling in user code', async () => {
    jest.useFakeTimers();
    let nowMs = Date.parse('2026-03-24T10:00:00Z');

    await renderHook({
      now: () => nowMs,
      resendTickMs: 500,
    });

    await act(async () => {
      emitV6({ type: 'loading', payload: { session: 'auth_123' } });
      emitV6({
        type: 'prompt',
        payload: {
          session: 'auth_123',
          traceId: 'trace_123',
          expiresAt: '2026-03-24T10:10:00Z',
          codeChannel: 'email',
          prompt: {
            type: 'enter_code',
            destination: 'u***@example.com',
            resendAt: '2026-03-24T10:00:03Z',
          },
        },
      });
    });

    expect(ref.current!.state).toMatchObject({
      status: 'enter_code',
      session: 'auth_123',
      codeChannel: 'email',
    });
    expect(ref.current!.canResend).toBe(false);
    expect(ref.current!.secondsUntilResend).toBe(3);

    nowMs += 3000;
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(ref.current!.state.status).toBe('enter_code');
    expect(ref.current!.canResend).toBe(true);
    expect(ref.current!.secondsUntilResend).toBe(0);
  });

  it('can auto-select the primary method from the identifier when opted in', async () => {
    const selectMethodMock = NativeModules.HawcxReactNative.v6SelectMethod as jest.Mock;
    selectMethodMock.mockClear();

    await renderHook({
      flowType: 'signin',
      primaryMethodSelectionPolicy: 'automatic_from_identifier',
    });

    await act(async () => {
      await ref.current!.start({ identifier: 'user@example.com' });
    });

    await act(async () => {
      emitV6({
        type: 'prompt',
        payload: {
          session: 'auth_primary',
          traceId: 'trace_primary',
          expiresAt: '2026-03-24T10:10:00Z',
          step: {
            id: 'primary',
          },
          prompt: {
            type: 'select_method',
            phase: 'primary',
            methods: [
              { id: 'sms_otp', label: 'Text message' },
              { id: 'email_otp', label: 'Email code' },
            ],
          },
        },
      });
    });

    expect(selectMethodMock).toHaveBeenCalledWith('email_otp');
  });

  it('can auto-select the primary method when trace ids are missing', async () => {
    const selectMethodMock = NativeModules.HawcxReactNative.v6SelectMethod as jest.Mock;
    selectMethodMock.mockClear();

    await renderHook({
      flowType: 'signin',
      primaryMethodSelectionPolicy: 'automatic_from_identifier',
    });

    await act(async () => {
      await ref.current!.start({ identifier: 'user@example.com' });
    });

    await act(async () => {
      emitV6({
        type: 'prompt',
        payload: {
          session: 'auth_primary_no_trace',
          expiresAt: '2026-03-24T10:10:00Z',
          step: {
            id: 'primary',
          },
          prompt: {
            type: 'select_method',
            phase: 'primary',
            methods: [
              { id: 'sms_otp', label: 'Text message' },
              { id: 'email_otp', label: 'Email code' },
            ],
          },
        },
      });
    });

    expect(selectMethodMock).toHaveBeenCalledWith('email_otp');
  });

  it('keeps method selection manual by default for backward compatibility', async () => {
    const selectMethodMock = NativeModules.HawcxReactNative.v6SelectMethod as jest.Mock;
    selectMethodMock.mockClear();

    await renderHook({
      flowType: 'signin',
    });

    await act(async () => {
      await ref.current!.start({ identifier: 'user@example.com' });
    });

    await act(async () => {
      emitV6({
        type: 'prompt',
        payload: {
          session: 'auth_manual',
          traceId: 'trace_manual',
          expiresAt: '2026-03-24T10:10:00Z',
          step: {
            id: 'primary',
          },
          prompt: {
            type: 'select_method',
            phase: 'primary',
            methods: [
              { id: 'sms_otp', label: 'Text message' },
              { id: 'email_otp', label: 'Email code' },
            ],
          },
        },
      });
    });

    expect(selectMethodMock).not.toHaveBeenCalled();
  });

  it('does not auto-select MFA methods even when opted in', async () => {
    const selectMethodMock = NativeModules.HawcxReactNative.v6SelectMethod as jest.Mock;
    selectMethodMock.mockClear();

    await renderHook({
      flowType: 'signin',
      primaryMethodSelectionPolicy: 'automatic_from_identifier',
    });

    await act(async () => {
      await ref.current!.start({ identifier: 'user@example.com' });
    });

    await act(async () => {
      emitV6({
        type: 'prompt',
        payload: {
          session: 'auth_mfa',
          traceId: 'trace_mfa',
          expiresAt: '2026-03-24T10:10:00Z',
          step: {
            id: 'mfa',
          },
          prompt: {
            type: 'select_method',
            phase: 'mfa',
            methods: [
              { id: 'sms_otp', label: 'Text message' },
              { id: 'email_otp', label: 'Email code' },
            ],
          },
        },
      });
    });

    expect(selectMethodMock).not.toHaveBeenCalled();
  });

  it('supports reset and changeIdentifier helpers with the expected local semantics', async () => {
    await renderHook();

    await act(async () => {
      await ref.current!.start({ identifier: 'user@example.com' });
    });

    const resetMock = NativeModules.HawcxReactNative.v6Reset as jest.Mock;
    resetMock.mockClear();

    await act(async () => {
      await ref.current!.reset();
    });

    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(ref.current!.state).toMatchObject({
      status: 'identifier',
      identifier: 'user@example.com',
    });

    resetMock.mockClear();

    await act(async () => {
      await ref.current!.changeIdentifier();
    });

    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(ref.current!.state).toMatchObject({
      status: 'identifier',
      identifier: undefined,
    });
  });

  it('delegates redirect handling and surfaces completed flow state', async () => {
    await renderHook();

    await act(async () => {
      emitV6({
        type: 'prompt',
        payload: {
          session: 'auth_123',
          traceId: 'trace_123',
          expiresAt: '2026-03-24T10:10:00Z',
          prompt: {
            type: 'redirect',
            url: 'https://example.com/callback',
            returnScheme: 'hawcxdemo',
          },
        },
      });
    });

    expect(ref.current!.state).toMatchObject({
      status: 'redirect',
      requiresRedirect: true,
    });

    await act(async () => {
      await ref.current!.handleRedirectUrl(' hawcxdemo://callback?code=abc ');
    });

    expect(NativeModules.HawcxReactNative.v6HandleRedirectUrl).toHaveBeenCalledWith(
      'hawcxdemo://callback?code=abc',
    );

    await act(async () => {
      emitV6({
        type: 'completed',
        payload: {
          session: 'auth_123',
          authCode: 'code_123',
          expiresAt: '2026-03-24T10:12:00Z',
          codeVerifier: 'verifier_123',
          traceId: 'trace_456',
        },
      });
    });

    expect(ref.current!.state).toMatchObject({
      status: 'completed',
      completed: {
        session: 'auth_123',
        authCode: 'code_123',
        codeVerifier: 'verifier_123',
        traceId: 'trace_456',
      },
    });
  });

  it('surfaces immediate completion events when trace ids are missing', async () => {
    await renderHook();

    await act(async () => {
      await ref.current!.start({ identifier: 'returning@example.com' });
    });

    await act(async () => {
      emitV6({
        type: 'completed',
        payload: {
          session: 'auth_returning',
          authCode: 'code_returning',
          expiresAt: '2026-03-24T10:12:00Z',
          codeVerifier: 'verifier_returning',
        },
      });
    });

    expect(ref.current!.state).toMatchObject({
      status: 'completed',
      session: 'auth_returning',
      identifier: 'returning@example.com',
      traceId: undefined,
      completed: {
        session: 'auth_returning',
        authCode: 'code_returning',
        codeVerifier: 'verifier_returning',
        traceId: undefined,
      },
    });
  });
});
