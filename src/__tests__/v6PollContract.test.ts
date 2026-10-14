import fs from 'fs';
import path from 'path';
import React, { forwardRef, useImperativeHandle } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';
import type { HawcxV6AuthHookResult } from '../index';
import {
  __INTERNAL_EVENTS__,
  hawcxV6Client,
  useHawcxV6Auth,
  v6PausePolling,
  v6ResumePolling,
} from '../index';
import { normalizeV6FlowEvent } from '../v6Normalization';
import { createInitialHawcxV6AuthState, reduceHawcxV6FlowEvent } from '../v6State';
import type { HawcxV6FlowEvent } from '../v6Types';

/** What the event listener does with a raw native event. */
const reduceRaw = (raw: unknown) =>
  reduceHawcxV6FlowEvent(
    normalizeV6FlowEvent(raw) as HawcxV6FlowEvent,
    createInitialHawcxV6AuthState(),
  );

const native = NativeModules.HawcxReactNative as Record<string, jest.Mock>;

const emitV6 = (event: unknown) => {
  __INTERNAL_EVENTS__.v6FlowEmitter.emit(__INTERNAL_EVENTS__.v6FlowEventName, event as never);
};

const awaitEvent = (pollPath?: string) => ({
  type: 'prompt',
  payload: {
    session: 'auth_await',
    traceId: 'trace_await',
    expiresAt: '2099-01-01T00:10:00Z',
    ...(pollPath === undefined ? {} : { pollPath }),
    prompt: {
      type: 'await_approval',
      expiresAt: '2099-01-01T00:05:00Z',
      pollInterval: 2,
    },
  },
});

const enterCodeEvent = (pollPath?: string) => ({
  type: 'prompt',
  payload: {
    session: 'auth_ml',
    expiresAt: '2099-01-01T00:10:00Z',
    ...(pollPath === undefined ? {} : { pollPath }),
    prompt: { type: 'enter_code', destination: 'u***@example.com', pollInterval: 2 },
  },
});

afterEach(() => {
  jest.clearAllMocks();
  __INTERNAL_EVENTS__.v6FlowEmitter.removeAllListeners(__INTERNAL_EVENTS__.v6FlowEventName);
});

describe('pollPath on the prompt metadata', () => {
  it('carries the advertised pollPath on await_approval', () => {
    const state = reduceRaw(awaitEvent('/v1/auth/poll'));
    expect(state.status).toBe('await_approval');
    expect(state.prompt?.pollPath).toBe('/v1/auth/poll');
  });

  it('carries pollPath on the magic-link code screen when a server sends it', () => {
    const state = reduceRaw(enterCodeEvent('/v1/auth/poll'));
    expect(state.prompt?.pollPath).toBe('/v1/auth/poll');
  });

  it('leaves pollPath undefined on older servers or a non-string value', () => {
    const absent = reduceRaw(awaitEvent());
    expect(absent.status).toBe('await_approval');
    expect(absent.prompt?.pollPath).toBeUndefined();

    const bogus = awaitEvent();
    (bogus.payload as Record<string, unknown>).pollPath = 42;
    const ignored = reduceRaw(bogus);
    expect(ignored.prompt?.pollPath).toBeUndefined();
  });
});

describe('pausePolling / resumePolling', () => {
  it('forwards the module functions to the native bridge', async () => {
    await v6PausePolling();
    await v6ResumePolling();
    expect(native.v6PausePolling).toHaveBeenCalledTimes(1);
    expect(native.v6ResumePolling).toHaveBeenCalledTimes(1);
  });

  it('is exposed on HawcxV6Client', async () => {
    await hawcxV6Client.pausePolling();
    await hawcxV6Client.resumePolling();
    expect(native.v6PausePolling).toHaveBeenCalledTimes(1);
    expect(native.v6ResumePolling).toHaveBeenCalledTimes(1);
  });
});

describe('useHawcxV6Auth polling', () => {
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
    jest.useRealTimers();
  });

  it('exposes pausePolling and resumePolling', async () => {
    await renderHook();
    await act(async () => {
      await ref.current!.pausePolling();
      await ref.current!.resumePolling();
    });
    expect(native.v6PausePolling).toHaveBeenCalledTimes(1);
    expect(native.v6ResumePolling).toHaveBeenCalledTimes(1);
  });

  it('never runs a JS poll loop on top of the native poller', async () => {
    jest.useFakeTimers();
    await renderHook();
    await act(async () => {
      emitV6(awaitEvent('/v1/auth/poll'));
    });
    expect(ref.current!.state).toMatchObject({ status: 'await_approval', awaitingApproval: true });

    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000);
    });
    expect(native.v6Poll).not.toHaveBeenCalled();
    // A waiting screen is not a loading screen.
    expect(ref.current!.state.isLoading).toBe(false);
  });
});

describe('native bridges', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

  it('encode pollPath from the native prompt context', () => {
    expect(read('ios/HawcxV6BridgeSupport.swift')).toContain('payload["pollPath"] = pollPath');
    expect(read('android/src/main/java/com/hawcx/reactnative/v6/HawcxV6Bridge.kt')).toContain(
      'putString("pollPath", it)',
    );
  });

  it('expose pause/resume on Android', () => {
    const module = read('android/src/main/java/com/hawcx/reactnative/HawcxReactNativeModule.kt');
    expect(module).toMatch(/@ReactMethod\s+fun v6PausePolling\(promise: Promise\)/);
    expect(module).toMatch(/@ReactMethod\s+fun v6ResumePolling\(promise: Promise\)/);
  });
});
