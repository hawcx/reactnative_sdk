import React, { forwardRef, useImperativeHandle } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';
import type { HawcxV6AuthHookResult } from '../index';
import {
  __INTERNAL_EVENTS__,
  addV6FlowListener,
  completeHawcxMagicLinkRedirect,
  hawcxV6Client,
  initialize,
  isHawcxMagicLinkUrl,
  startV6Flow,
  useHawcxV6Auth,
} from '../index';
import { createInitialHawcxV6AuthState, reduceHawcxV6FlowEvent } from '../v6State';
import type { HawcxV6FlowEvent } from '../v6Types';

const native = NativeModules.HawcxReactNative as Record<string, jest.Mock>;

const emitV6 = (event: unknown) => {
  __INTERNAL_EVENTS__.v6FlowEmitter.emit(__INTERNAL_EVENTS__.v6FlowEventName, event as never);
};

const MAGIC_URL =
  'https://login.example.com/app/magic-link/?hawcx_magic_link=tok_abc&hawcx_project=proj_1';

const enterCodeEvent = (pollInterval?: number) => ({
  type: 'prompt',
  payload: {
    session: 'auth_ml',
    traceId: 'trace_ml',
    expiresAt: '2026-10-13T10:10:00Z',
    codeChannel: 'email',
    prompt: {
      type: 'enter_code',
      destination: 'u***@example.com',
      codeLength: 8,
      codeExpiresAt: '2026-10-13T10:05:00Z',
      ...(pollInterval === undefined ? {} : { pollInterval }),
    },
  },
});

const completedEvent = {
  type: 'completed',
  payload: {
    session: 'auth_ml',
    authCode: 'code_ml',
    expiresAt: '2026-10-13T10:12:00Z',
    codeVerifier: 'verifier_ml',
    traceId: 'trace_done',
  },
};

afterEach(() => {
  jest.clearAllMocks();
  __INTERNAL_EVENTS__.v6FlowEmitter.removeAllListeners(__INTERNAL_EVENTS__.v6FlowEventName);
});

describe('magic-link code screen polling', () => {
  it('normalizes pollInterval on the enter_code prompt', () => {
    const received: HawcxV6FlowEvent[] = [];
    const subscription = addV6FlowListener((event) => received.push(event));
    emitV6(enterCodeEvent(3));
    subscription.remove();

    expect(received).toHaveLength(1);
    const event = received[0];
    expect(event.type).toBe('prompt');
    if (event.type === 'prompt' && event.payload.prompt.type === 'enter_code') {
      expect(event.payload.prompt.pollInterval).toBe(3);
      expect(event.payload.prompt.codeLength).toBe(8);
    } else {
      throw new Error('expected an enter_code prompt');
    }
  });

  it('marks the state as polling only when the code prompt carries pollInterval', () => {
    const initial = createInitialHawcxV6AuthState();
    const polling = reduceHawcxV6FlowEvent(enterCodeEvent(3) as HawcxV6FlowEvent, initial);
    const plain = reduceHawcxV6FlowEvent(enterCodeEvent() as HawcxV6FlowEvent, initial);

    expect(initial.magicLinkPolling).toBe(false);
    expect(polling.magicLinkPolling).toBe(true);
    expect(polling.status).toBe('enter_code');
    expect(plain.magicLinkPolling).toBe(false);
  });

  it('ignores a non-positive pollInterval', () => {
    const state = reduceHawcxV6FlowEvent(
      enterCodeEvent(0) as HawcxV6FlowEvent,
      createInitialHawcxV6AuthState(),
    );
    expect(state.magicLinkPolling).toBe(false);
  });

  it('stops reporting polling once the flow completes or errors', () => {
    const polling = reduceHawcxV6FlowEvent(
      enterCodeEvent(3) as HawcxV6FlowEvent,
      createInitialHawcxV6AuthState(),
    );
    const completed = reduceHawcxV6FlowEvent(completedEvent as HawcxV6FlowEvent, polling);
    const errored = reduceHawcxV6FlowEvent(
      {
        type: 'error',
        payload: { code: 'session_expired', message: 'Expired', retryable: false },
      },
      polling,
    );
    const loading = reduceHawcxV6FlowEvent({ type: 'loading', payload: {} }, polling);

    expect(completed.magicLinkPolling).toBe(false);
    expect(errored.magicLinkPolling).toBe(false);
    expect(loading.magicLinkPolling).toBe(false);
  });
});

describe('magic-link landing URL', () => {
  it('passes a landing URL from initialize through to native', async () => {
    await initialize({
      projectApiKey: 'key',
      baseUrl: 'https://stage-api.hawcx.com',
      magicLinkLandingUrl: ' https://login.example.com/app/magic-link/ ',
    });

    expect(native.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        magicLinkLandingUrl: 'https://login.example.com/app/magic-link/',
      }),
    );
  });

  it('does not send a landing URL on start (the native SDK takes it at initialize)', async () => {
    await startV6Flow({ identifier: 'user@example.com' });
    expect(native.v6Start.mock.calls[0][0]).not.toHaveProperty('magicLinkLandingUrl');
  });

  it.each([
    ['http://login.example.com/landing/'],
    ['https://login.example.com/landing/?a=1'],
    ['https://login.example.com/landing/#frag'],
    ['hawcxdemo://landing'],
    ['https://user:pw@login.example.com/landing/'],
    ['https:///landing/'],
    ['not a url'],
  ])('rejects an invalid landing URL %s', async (landingUrl) => {
    await expect(
      initialize({
        projectApiKey: 'key',
        baseUrl: 'https://stage-api.hawcx.com',
        magicLinkLandingUrl: landingUrl,
      }),
    ).rejects.toThrow('magicLinkLandingUrl must be an https URL without query or fragment');
    expect(native.initialize).not.toHaveBeenCalled();
  });

  it('omits a blank landing URL', async () => {
    await initialize({
      projectApiKey: 'key',
      baseUrl: 'https://stage-api.hawcx.com',
      magicLinkLandingUrl: '   ',
    });
    expect(native.initialize.mock.calls[0][0].magicLinkLandingUrl).toBeUndefined();
  });
});

describe('isHawcxMagicLinkUrl', () => {
  it.each([
    [MAGIC_URL, true],
    ['hawcxdemo://magic?hawcx_project=p&hawcx_magic_link=t', true],
    ['https://example.com/landing?hawcx_magic_link=&hawcx_project=p', false],
    ['https://example.com/landing?hawcx_magic_link=t', false],
    ['hawcxdemo://oauth/callback?code=abc&state=xyz', false],
    ['https://example.com/landing#hawcx_magic_link=t&hawcx_project=p', false],
    ['', false],
  ])('%s -> %s', (url, expected) => {
    expect(isHawcxMagicLinkUrl(url)).toBe(expected);
  });

  describe('with a landing URL (same rule as the native parsers)', () => {
    const LANDING = 'https://login.example.com/app/magic-link/';
    const QUERY = '?hawcx_magic_link=tok_abc&hawcx_project=proj_1';

    it.each([
      [`${LANDING}${QUERY}`, true],
      [`HTTPS://LOGIN.EXAMPLE.COM/app/magic-link/${QUERY}`, true],
      [`${LANDING}${QUERY}#frag`, true],
      [`http://login.example.com/app/magic-link/${QUERY}`, false],
      [`https://evil.example.com/app/magic-link/${QUERY}`, false],
      [`https://login.example.com:8443/app/magic-link/${QUERY}`, false],
      [`https://login.example.com/app/magic-link${QUERY}`, false],
      [`https://login.example.com/app/MAGIC-LINK/${QUERY}`, false],
      [`https://login.example.com/app/magic-link/other${QUERY}`, false],
      [`hawcxdemo://magic${QUERY}`, false],
      [LANDING, false],
    ])('%s -> %s', (url, expected) => {
      expect(isHawcxMagicLinkUrl(url, LANDING)).toBe(expected);
    });

    it('treats an empty path as "/"', () => {
      expect(isHawcxMagicLinkUrl(`https://h.example.com${QUERY}`, 'https://h.example.com')).toBe(
        true,
      );
      expect(isHawcxMagicLinkUrl(`https://h.example.com/${QUERY}`, 'https://h.example.com')).toBe(
        true,
      );
    });

    it('ignores a blank landing URL', () => {
      expect(isHawcxMagicLinkUrl(`hawcxdemo://magic${QUERY}`, '  ')).toBe(true);
    });
  });
});

describe('completeHawcxMagicLinkRedirect', () => {
  it('forwards the trimmed url and returns the resumed outcome', async () => {
    native.v6CompleteMagicLinkRedirect.mockResolvedValueOnce({ outcome: 'resumed' });

    await expect(completeHawcxMagicLinkRedirect(` ${MAGIC_URL} `)).resolves.toEqual({
      outcome: 'resumed',
    });
    expect(native.v6CompleteMagicLinkRedirect).toHaveBeenCalledWith(MAGIC_URL);
  });

  it('normalizes hand-off and not-a-magic-link outcomes', async () => {
    native.v6CompleteMagicLinkRedirect
      .mockResolvedValueOnce({ outcome: 'handed_off' })
      .mockResolvedValueOnce({ outcome: 'not_magic_link' });

    await expect(completeHawcxMagicLinkRedirect(MAGIC_URL)).resolves.toEqual({
      outcome: 'handed_off',
    });
    await expect(
      completeHawcxMagicLinkRedirect('hawcxdemo://oauth/callback?code=a&state=b'),
    ).resolves.toEqual({ outcome: 'not_magic_link' });
  });

  it('normalizes failed outcomes with code, message and retryable', async () => {
    native.v6CompleteMagicLinkRedirect
      .mockResolvedValueOnce({
        outcome: 'failed',
        code: 'invalid_or_expired',
        message: 'This sign-in link has expired or was already used.',
        retryable: false,
      })
      .mockResolvedValueOnce({ outcome: 'failed', code: 'http_error', message: 'Unavailable' });

    await expect(completeHawcxMagicLinkRedirect(MAGIC_URL)).resolves.toEqual({
      outcome: 'failed',
      code: 'invalid_or_expired',
      message: 'This sign-in link has expired or was already used.',
      retryable: false,
    });
    await expect(completeHawcxMagicLinkRedirect(MAGIC_URL)).resolves.toEqual({
      outcome: 'failed',
      code: 'http_error',
      message: 'Unavailable',
      retryable: false,
    });
  });

  it('rejects an empty url without calling native', async () => {
    await expect(completeHawcxMagicLinkRedirect('  ')).rejects.toThrow('url is required');
    expect(native.v6CompleteMagicLinkRedirect).not.toHaveBeenCalled();
  });

  it('rejects an unknown native response', async () => {
    native.v6CompleteMagicLinkRedirect.mockResolvedValueOnce({ outcome: 'surprise' });
    await expect(completeHawcxMagicLinkRedirect(MAGIC_URL)).rejects.toThrow(
      'Invalid V6 magic-link redirect response from native bridge',
    );
  });

  it('is exposed on HawcxV6Client', async () => {
    native.v6CompleteMagicLinkRedirect.mockResolvedValueOnce({ outcome: 'handed_off' });
    await expect(hawcxV6Client.completeMagicLinkRedirect(MAGIC_URL)).resolves.toEqual({
      outcome: 'handed_off',
    });
  });
});

describe('useHawcxV6Auth magic link', () => {
  const HookHarness = forwardRef<HawcxV6AuthHookResult>((_, ref) => {
    const value = useHawcxV6Auth(hawcxV6Client);
    useImperativeHandle(ref, () => value, [value]);
    return null;
  });

  let renderer: TestRenderer.ReactTestRenderer | undefined;
  let ref: React.RefObject<HawcxV6AuthHookResult>;

  const renderHook = async () => {
    ref = React.createRef<HawcxV6AuthHookResult>();
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHarness, { ref }));
    });
  };

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
  });

  it('completes from a background poll without a typed code', async () => {
    await renderHook();

    await act(async () => {
      emitV6(enterCodeEvent(3));
    });
    expect(ref.current!.state).toMatchObject({ status: 'enter_code', magicLinkPolling: true });

    await act(async () => {
      emitV6(completedEvent);
    });
    expect(ref.current!.state).toMatchObject({
      status: 'completed',
      magicLinkPolling: false,
      completed: { authCode: 'code_ml', codeVerifier: 'verifier_ml' },
    });
    expect(native.v6SubmitCode).not.toHaveBeenCalled();
  });

  it('records the redirect outcome and keeps it through the resumed completion', async () => {
    native.v6CompleteMagicLinkRedirect.mockResolvedValueOnce({ outcome: 'resumed' });
    await renderHook();

    let outcome: unknown;
    await act(async () => {
      outcome = await ref.current!.completeMagicLinkRedirect(MAGIC_URL);
    });
    expect(outcome).toEqual({ outcome: 'resumed' });
    expect(ref.current!.state.magicLinkRedirect).toEqual({ outcome: 'resumed' });

    await act(async () => {
      emitV6(completedEvent);
    });
    expect(ref.current!.state).toMatchObject({
      status: 'completed',
      magicLinkRedirect: { outcome: 'resumed' },
    });

    await act(async () => {
      await ref.current!.start({ identifier: 'user@example.com' });
    });
    expect(ref.current!.state.magicLinkRedirect).toBeUndefined();
  });

  it('records a hand-off without touching the flow state', async () => {
    native.v6CompleteMagicLinkRedirect.mockResolvedValueOnce({ outcome: 'handed_off' });
    await renderHook();

    await act(async () => {
      await ref.current!.completeMagicLinkRedirect(MAGIC_URL);
    });
    expect(ref.current!.state).toMatchObject({
      status: 'identifier',
      magicLinkRedirect: { outcome: 'handed_off' },
    });
  });

  it('does not record unrelated urls', async () => {
    native.v6CompleteMagicLinkRedirect.mockResolvedValueOnce({ outcome: 'not_magic_link' });
    await renderHook();

    await act(async () => {
      await ref.current!.completeMagicLinkRedirect('hawcxdemo://oauth/callback?code=a&state=b');
    });
    expect(ref.current!.state.magicLinkRedirect).toBeUndefined();
  });
});
