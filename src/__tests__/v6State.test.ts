import {
  canHawcxV6Resend,
  createInitialHawcxV6AuthState,
  getHawcxV6ResendAvailability,
  reduceHawcxV6FlowEvent,
  refreshHawcxV6AuthState,
} from '../v6State';

describe('Hawcx V6 state helpers', () => {
  it('creates an identifier-first state and normalizes flow type', () => {
    expect(createInitialHawcxV6AuthState()).toMatchObject({
      status: 'identifier',
      flowType: 'signin',
      isLoading: false,
      requiresRedirect: false,
      awaitingApproval: false,
      resend: { canResend: false },
    });

    expect(createInitialHawcxV6AuthState('signup')).toMatchObject({
      status: 'identifier',
      flowType: 'signup',
    });
  });

  it('computes resend availability for enter_code prompts', () => {
    const prompt = {
      session: 'auth_123',
      traceId: 'trace_123',
      expiresAt: '2026-03-24T10:10:00Z',
      prompt: {
        type: 'enter_code' as const,
        destination: 'u***@example.com',
        resendAt: '2026-03-24T10:00:03Z',
      },
    };

    const resend = getHawcxV6ResendAvailability(prompt, Date.parse('2026-03-24T10:00:00Z'));

    expect(resend).toEqual({
      canResend: false,
      resendAt: '2026-03-24T10:00:03Z',
      secondsUntilResend: 3,
    });
    expect(canHawcxV6Resend(prompt, Date.parse('2026-03-24T10:00:00Z'))).toBe(false);
    expect(canHawcxV6Resend(prompt, Date.parse('2026-03-24T10:00:04Z'))).toBe(true);
  });

  it('refreshes countdown state until resend becomes available', () => {
    const initial = reduceHawcxV6FlowEvent(
      {
        type: 'prompt',
        payload: {
          session: 'auth_123',
          traceId: 'trace_123',
          expiresAt: '2026-03-24T10:10:00Z',
          prompt: {
            type: 'enter_code',
            destination: 'u***@example.com',
            resendAt: '2026-03-24T10:00:03Z',
          },
        },
      },
      createInitialHawcxV6AuthState(),
      Date.parse('2026-03-24T10:00:00Z'),
    );

    expect(initial.resend).toEqual({
      canResend: false,
      resendAt: '2026-03-24T10:00:03Z',
      secondsUntilResend: 3,
    });

    const refreshed = refreshHawcxV6AuthState(initial, Date.parse('2026-03-24T10:00:04Z'));

    expect(refreshed.resend).toEqual({
      canResend: true,
      resendAt: '2026-03-24T10:00:03Z',
      secondsUntilResend: 0,
    });
  });

  it('preserves prompt context when the flow enters an error state', () => {
    const promptState = reduceHawcxV6FlowEvent(
      {
        type: 'prompt',
        payload: {
          session: 'auth_123',
          traceId: 'trace_123',
          expiresAt: '2026-03-24T10:10:00Z',
          step: { id: 'primary', label: 'Primary Verification' },
          risk: {
            detected: true,
            reasons: ['new_location'],
          },
          codeChannel: 'email',
          prompt: {
            type: 'enter_code',
            destination: 'u***@example.com',
          },
        },
      },
      createInitialHawcxV6AuthState(),
    );

    const errorState = reduceHawcxV6FlowEvent(
      {
        type: 'error',
        payload: {
          code: 'validation_error',
          action: 'retry_input',
          message: 'Request validation failed',
          retryable: true,
          traceId: 'trace_456',
        },
      },
      promptState,
    );

    expect(errorState).toMatchObject({
      status: 'error',
      session: 'auth_123',
      traceId: 'trace_456',
      step: { id: 'primary', label: 'Primary Verification' },
      codeChannel: 'email',
      error: {
        code: 'validation_error',
        action: 'retry_input',
      },
      prompt: {
        prompt: {
          type: 'enter_code',
          destination: 'u***@example.com',
        },
      },
    });
  });

  it('advances to completed even when trace ids are missing', () => {
    const state = reduceHawcxV6FlowEvent(
      {
        type: 'completed',
        payload: {
          session: 'auth_returning',
          authCode: 'code_returning',
          expiresAt: '2026-03-24T10:12:00Z',
          codeVerifier: 'verifier_returning',
        },
      },
      createInitialHawcxV6AuthState(),
    );

    expect(state).toMatchObject({
      status: 'completed',
      session: 'auth_returning',
      expiresAt: '2026-03-24T10:12:00Z',
      traceId: undefined,
      completed: {
        session: 'auth_returning',
        authCode: 'code_returning',
        codeVerifier: 'verifier_returning',
      },
    });
    expect(state.completed?.traceId).toBeUndefined();
  });
});
