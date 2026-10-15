import fs from 'fs';
import path from 'path';
import { normalizeV6FlowEvent } from '../v6Normalization';
import { createInitialHawcxV6AuthState, reduceHawcxV6FlowEvent } from '../v6State';
import type { HawcxV6FlowEvent } from '../v6Types';

const promptEvent = (prompt: Record<string, unknown>) => ({
  type: 'prompt',
  payload: {
    session: 'auth_new',
    traceId: 'trace_new',
    expiresAt: '2099-01-01T00:10:00Z',
    prompt,
  },
});

describe('unknown step types', () => {
  it('surfaces a step type the SDK does not know as an unknown prompt', () => {
    const event = normalizeV6FlowEvent(promptEvent({ type: 'future_step', foo: 1 }));
    expect(event).toEqual({
      type: 'prompt',
      payload: {
        session: 'auth_new',
        traceId: 'trace_new',
        expiresAt: '2099-01-01T00:10:00Z',
        step: undefined,
        risk: undefined,
        codeChannel: undefined,
        pollPath: undefined,
        prompt: { type: 'unknown', rawType: 'future_step' },
      },
    });
  });

  it('keeps the rawType the native bridge reports for an unmapped native prompt', () => {
    const event = normalizeV6FlowEvent(promptEvent({ type: 'unknown', rawType: 'shinyNewStep' }));
    expect(event?.type).toBe('prompt');
    expect(event?.type === 'prompt' && event.payload.prompt).toEqual({
      type: 'unknown',
      rawType: 'shiny_new_step',
    });
  });

  it('falls back to "unknown" when no raw type is reported', () => {
    const event = normalizeV6FlowEvent(promptEvent({ type: 'unknown' }));
    expect(event?.type === 'prompt' && event.payload.prompt).toEqual({
      type: 'unknown',
      rawType: 'unknown',
    });
  });

  it('reduces an unknown prompt to the unknown status without loading or polling flags', () => {
    const event = normalizeV6FlowEvent(promptEvent({ type: 'future_step' })) as HawcxV6FlowEvent;
    const state = reduceHawcxV6FlowEvent(event, createInitialHawcxV6AuthState());
    expect(state).toMatchObject({
      status: 'unknown',
      isLoading: false,
      awaitingApproval: false,
      requiresRedirect: false,
      magicLinkPolling: false,
    });
  });

  it('still drops a known step type that is missing required fields', () => {
    expect(normalizeV6FlowEvent(promptEvent({ type: 'enter_code' }))).toBeNull();
  });
});

describe('native bridges (6.2.0)', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

  it('depend on the 6.2.0 Android SDK by default', () => {
    expect(read('android/build.gradle')).toContain(
      "project.findProperty('HAWCX_ANDROID_SDK_VERSION') ?: '6.2.0'",
    );
  });

  it('encode unmapped native prompts as unknown instead of failing to build', () => {
    const swift = read('ios/HawcxV6BridgeSupport.swift');
    expect(swift).toMatch(/@unknown default:\s*\n\s*return encodeUnknownPrompt\(prompt\)/);
    const kotlin = read('android/src/main/java/com/hawcx/reactnative/v6/HawcxV6Bridge.kt');
    expect(kotlin).toMatch(/else -> \{\s*\n\s*putString\("type", "unknown"\)/);
  });
});
