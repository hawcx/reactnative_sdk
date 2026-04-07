/* eslint-disable no-void */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  type StyleProp,
  Switch,
  Text,
  type TextStyle,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import {
  approveV6Qr,
  getLastLoggedInUser,
  initialize,
  notifyUserAuthenticated,
  routeWebLoginScan,
  storeBackendOAuthTokens,
  useHawcxV6Auth,
  useHawcxWebLogin,
  type HawcxInitializeConfig,
  type HawcxV6AuthState,
  type HawcxV6CompletedPayload,
  type HawcxV6Method,
  type HawcxV6PromptPayload,
} from '@hawcx/react-native-sdk';
import {
  DEFAULT_HAWCX_CONFIG,
  EXAMPLE_DEFAULT_BACKEND_URL,
  EXAMPLE_DEFAULT_IDENTIFIER,
  EXAMPLE_REDIRECT_SCHEMES,
} from './hawcx.config';

const COLORS = {
  bg: '#09111f',
  card: '#122033',
  cardAlt: '#0c1827',
  border: '#24384f',
  accent: '#f97316',
  accentMuted: '#fdba74',
  text: '#f8fafc',
  muted: '#93a9c2',
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#f87171',
};

type ExampleStage = 'primary' | 'mfa' | 'device_trust';

type BackendExchangeResponse = {
  success: boolean;
  message?: string;
  error?: string;
  access_token?: string;
  refresh_token?: string;
};

const STAGE_ORDER: ExampleStage[] = ['primary', 'mfa', 'device_trust'];

const STAGE_COPY: Record<ExampleStage, { number: number; title: string; subtitle: string }> = {
  primary: { number: 1, title: 'Primary', subtitle: 'Identity verification' },
  mfa: { number: 2, title: 'MFA', subtitle: 'Second factor' },
  device_trust: { number: 3, title: 'Device Trust', subtitle: 'Remember devices' },
};

const STATUS_COPY: Record<string, string> = {
  identifier: 'Ready for identifier entry',
  loading: 'Submitting request',
  select_method: 'Choose a verification method',
  enter_code: 'Enter the verification code',
  setup_sms: 'Add or confirm a phone number',
  setup_totp: 'Set up your authenticator app',
  enter_totp: 'Enter the authenticator code',
  redirect: 'Continue in the browser',
  await_approval: 'Waiting for approval',
  completed: 'Authorization code received',
  error: 'Resolve the error and continue',
};

type PendingAction =
  | 'start'
  | 'select_method'
  | 'submit_prompt'
  | 'resend_code'
  | 'change_identifier'
  | 'reset_flow'
  | 'process_scan'
  | 'handle_redirect';

type PendingActionOptions = {
  waitForTransition?: boolean;
  methodId?: string;
};

type ActionButtonVariant = 'primary' | 'secondary' | 'secondaryTiny' | 'destructive';

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  testID?: string;
  variant?: ActionButtonVariant;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

const ActionButton = ({
  label,
  onPress,
  disabled = false,
  loading = false,
  loadingLabel,
  testID,
  variant = 'primary',
  style,
  textStyle,
}: ActionButtonProps) => {
  const baseButtonStyle =
    variant === 'primary'
      ? styles.primaryButton
      : variant === 'secondary'
        ? styles.secondaryButton
        : variant === 'secondaryTiny'
          ? styles.secondaryTinyButton
          : styles.destructiveButton;
  const baseTextStyle =
    variant === 'primary'
      ? styles.primaryButtonText
      : variant === 'secondary'
        ? styles.secondaryButtonText
        : variant === 'secondaryTiny'
          ? styles.secondaryTinyButtonText
          : styles.primaryButtonText;
  const spinnerColor = variant === 'primary' ? '#111827' : COLORS.text;

  return (
    <TouchableOpacity
      testID={testID}
      style={[
        baseButtonStyle,
        style,
        disabled && !loading && styles.buttonDisabled,
        loading && styles.buttonLoading,
      ]}
      disabled={disabled || loading}
      onPress={onPress}
    >
      <View style={styles.buttonContent}>
        {loading ? <ActivityIndicator color={spinnerColor} size="small" /> : null}
        <Text style={[baseTextStyle, textStyle]}>{loading ? (loadingLabel ?? label) : label}</Text>
      </View>
    </TouchableOpacity>
  );
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const isValidPhone = (value: string) => {
  const cleaned = value.replace(/\s+/g, '');
  const digits = cleaned.replace(/\D/g, '');
  return cleaned.startsWith('+') ? digits.length >= 8 : digits.length >= 7;
};

const isValidIdentifier = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 && (isValidEmail(trimmed) || isValidPhone(trimmed));
};

const summarizeValue = (value: string, prefix = 8, suffix = 4) => {
  if (value.length <= prefix + suffix + 1) {
    return value;
  }
  return `${value.slice(0, prefix)}…${value.slice(-suffix)}`;
};

const formatDateTime = (value?: string) => {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString();
};

const titleize = (value?: string) =>
  value
    ?.replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ') ?? '';

const stageFromStepId = (value?: string): ExampleStage | undefined => {
  const normalized = value?.trim().toLowerCase().replace(/_/g, '');
  switch (normalized) {
    case 'primary':
    case 'verifyidentity':
      return 'primary';
    case 'mfa':
    case 'secondfactor':
      return 'mfa';
    case 'devicetrust':
    case 'setupdevice':
    case 'devicechallenge':
      return 'device_trust';
    default:
      return undefined;
  }
};

const stageRank = (stage: ExampleStage) => STAGE_ORDER.indexOf(stage);

const resolveStage = (state: HawcxV6AuthState, previous: ExampleStage): ExampleStage => {
  const explicitStage = stageFromStepId(state.step?.id);
  if (explicitStage) {
    return explicitStage;
  }

  if (state.prompt?.prompt.type === 'select_method') {
    const phaseStage = stageFromStepId(state.prompt.prompt.phase);
    if (phaseStage) {
      return phaseStage;
    }
  }

  switch (state.prompt?.prompt.type) {
    case 'setup_sms':
    case 'setup_totp':
      return 'device_trust';
    case 'enter_totp':
      return stageRank(previous) > stageRank('mfa') ? previous : 'mfa';
    case 'enter_code':
      if (previous === 'device_trust') {
        return previous;
      }
      return previous === 'mfa' ? 'mfa' : 'primary';
    default:
      return state.status === 'identifier' ? 'primary' : previous;
  }
};

const promptTitle = (prompt?: HawcxV6PromptPayload) => {
  switch (prompt?.prompt.type) {
    case 'select_method':
      return 'Choose a method';
    case 'enter_code':
      return 'Enter verification code';
    case 'setup_sms':
      return 'Add phone number';
    case 'setup_totp':
      return 'Set up authenticator';
    case 'enter_totp':
      return 'Enter authenticator code';
    case 'redirect':
      return 'Continue in browser';
    case 'await_approval':
      return 'Awaiting approval';
    default:
      return 'Start authentication';
  }
};

const promptSubtitle = (prompt?: HawcxV6PromptPayload) => {
  switch (prompt?.prompt.type) {
    case 'select_method':
      return prompt.prompt.phase
        ? `${titleize(prompt.prompt.phase)} step`
        : 'Select the factor you want to use next.';
    case 'enter_code':
      return `Code sent to ${prompt.prompt.destination}`;
    case 'setup_sms':
      return 'Provide the phone number that should receive verification codes.';
    case 'setup_totp':
      return 'Add this account to your authenticator app, then enter a fresh code.';
    case 'enter_totp':
      return 'Open your authenticator app and type the current code.';
    case 'redirect':
      return 'Open the provider flow and return to the app when prompted.';
    case 'await_approval':
      return 'Approve the request on the linked device or web flow.';
    default:
      return 'Start a V6 sign-in flow with the current SDK workspace build.';
  }
};

const actionLabelForPrompt = (prompt?: HawcxV6PromptPayload) => {
  if (!prompt) {
    return 'Continue';
  }

  switch (prompt.prompt.type) {
    case 'enter_code':
      return 'Continue';
    case 'setup_sms':
      return 'Continue';
    case 'setup_totp':
    case 'enter_totp':
      return 'Continue';
    case 'redirect':
      return 'Open Browser';
    case 'await_approval':
      return 'Check Status';
    default:
      return undefined;
  }
};

const buildV6TransitionKey = (state: HawcxV6AuthState) =>
  [
    state.status,
    state.prompt?.prompt.type ?? 'none',
    state.step?.id ?? 'none',
    state.traceId ?? 'no-trace',
    state.error?.code ?? 'no-error',
    state.error?.traceId ?? 'no-error-trace',
    state.completed?.traceId ?? 'no-completion',
    state.completed?.session ?? 'no-completion-session',
  ].join('|');

const App = () => {
  const [activeConfig] = useState<HawcxInitializeConfig | null>(DEFAULT_HAWCX_CONFIG);
  const [initStatus, setInitStatus] = useState<'idle' | 'initializing' | 'ready' | 'error'>('idle');
  const [initError, setInitError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState(EXAMPLE_DEFAULT_IDENTIFIER);
  const [codeInput, setCodeInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [manualRedirectUrl, setManualRedirectUrl] = useState('');
  const [backendFlowEnabled, setBackendFlowEnabled] = useState(false);
  const [backendUrl, setBackendUrl] = useState(EXAMPLE_DEFAULT_BACKEND_URL);
  const [savedUserId, setSavedUserId] = useState<string | null>(null);
  const [webStatus, setWebStatus] = useState<string | null>(null);
  const [webError, setWebError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<ExampleStage>('primary');
  const [pendingRedirectUrl, setPendingRedirectUrl] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingMethodId, setPendingMethodId] = useState<string | null>(null);

  const v6 = useHawcxV6Auth(undefined, { flowType: 'signin' });
  const web = useHawcxWebLogin();
  const handledCompletionRef = useRef<string | null>(null);
  const loggedStateRef = useRef<string>('');
  const previousPromptTypeRef = useRef<string | undefined>();
  const pendingTransitionRef = useRef<{
    action: PendingAction;
    key: string;
    sawLoading: boolean;
  } | null>(null);

  const appendLog = useCallback(
    (message: string) => {
      if (!loggingEnabled) {
        return;
      }
      const timestamp = new Date().toLocaleTimeString();
      setLogs((previous) => [`[${timestamp}] ${message}`, ...previous].slice(0, 120));
    },
    [loggingEnabled],
  );

  const isReady = initStatus === 'ready';
  const currentPrompt = v6.state.prompt;
  const currentIdentifier = v6.state.identifier ?? identifier.trim();
  const preferredUserId = savedUserId ?? currentIdentifier ?? null;
  const redirectPrompt = currentPrompt?.prompt.type === 'redirect' ? currentPrompt.prompt : null;
  const v6TransitionKey = buildV6TransitionKey(v6.state);
  const redirectWarning =
    redirectPrompt?.returnScheme &&
    !EXAMPLE_REDIRECT_SCHEMES.some(
      (scheme) => scheme === redirectPrompt.returnScheme?.toLowerCase(),
    )
      ? `Return scheme "${
          redirectPrompt.returnScheme
        }" is not registered in the example app. Registered schemes: ${EXAMPLE_REDIRECT_SCHEMES.join(
          ', ',
        )}.`
      : null;

  const requireReady = useCallback(() => {
    if (isReady) {
      return true;
    }
    setInitError('Initialize the SDK in hawcx.config.ts before running example actions.');
    return false;
  }, [isReady]);

  const clearPendingAction = useCallback((action?: PendingAction) => {
    setPendingAction((current) => {
      if (action && current !== action) {
        return current;
      }
      return null;
    });
    if (!action || pendingTransitionRef.current?.action === action) {
      pendingTransitionRef.current = null;
    }
    if (!action || action === 'select_method') {
      setPendingMethodId(null);
    }
  }, []);

  const runPendingAction = useCallback(
    async (
      action: PendingAction,
      work: () => Promise<unknown>,
      { waitForTransition = false, methodId }: PendingActionOptions = {},
    ) => {
      setPendingAction(action);
      setPendingMethodId(methodId ?? null);
      pendingTransitionRef.current = waitForTransition
        ? {
            action,
            key: v6TransitionKey,
            sawLoading: v6.state.status === 'loading',
          }
        : null;

      try {
        const result = await work();
        if (!waitForTransition) {
          clearPendingAction(action);
        }
        return result;
      } catch (error) {
        clearPendingAction(action);
        throw error;
      }
    },
    [clearPendingAction, v6.state.status, v6TransitionKey],
  );

  const hydrateSavedUser = useCallback(async () => {
    try {
      const userId = (await getLastLoggedInUser()).trim();
      setSavedUserId(userId || null);
      if (userId && !identifier.trim()) {
        setIdentifier(userId);
      }
    } catch {
      setSavedUserId(null);
    }
  }, [identifier]);

  const exchangeWithBackend = useCallback(
    async (payload: HawcxV6CompletedPayload, resolvedIdentifier: string) => {
      const trimmedIdentifier = resolvedIdentifier.trim();
      const completionLabel = summarizeValue(payload.authCode, 8, 6);

      setBackendError(null);
      if (!backendFlowEnabled) {
        setBackendStatus(`Demo mode: captured authorization code ${completionLabel}.`);
        setSavedUserId(trimmedIdentifier || savedUserId);
        appendLog(`completed V6 flow in demo mode for ${trimmedIdentifier || 'unknown user'}`);
        return;
      }

      const trimmedUrl = backendUrl.trim();
      if (!trimmedUrl) {
        setBackendError('Enter a backend URL before exchanging the authorization code.');
        return;
      }
      if (!trimmedIdentifier) {
        setBackendError('The example needs an identifier to exchange the authorization code.');
        return;
      }

      setBackendStatus('Forwarding authorization code to backend...');
      appendLog(`forwarding V6 authorization code for ${trimmedIdentifier}`);

      try {
        const response = await fetch(trimmedUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: payload.authCode,
            code_verifier: payload.codeVerifier,
            email: trimmedIdentifier,
            trace_id: payload.traceId,
            expires_at: payload.expiresAt,
          }),
        });
        const text = await response.text();
        let parsed: BackendExchangeResponse = { success: response.ok };
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { success: response.ok, message: text };
          }
        }
        if (!response.ok || parsed.success === false) {
          throw new Error(
            parsed.error ?? parsed.message ?? `Backend responded with ${response.status}`,
          );
        }

        if (parsed.access_token) {
          await storeBackendOAuthTokens(
            trimmedIdentifier,
            parsed.access_token,
            parsed.refresh_token ?? undefined,
          );
          await notifyUserAuthenticated();
          setBackendStatus('Backend tokens stored through the Hawcx SDK.');
          setSavedUserId(trimmedIdentifier);
          appendLog(`stored backend-issued tokens for ${trimmedIdentifier}`);
        } else {
          setBackendStatus(parsed.message ?? 'Backend accepted the code without returning tokens.');
          setSavedUserId(trimmedIdentifier);
        }
      } catch (error) {
        const message =
          (error as Error)?.message ?? 'Failed to reach the backend exchange endpoint.';
        setBackendStatus(null);
        setBackendError(message);
        appendLog(`backend exchange failed: ${message}`);
      }
    },
    [appendLog, backendFlowEnabled, backendUrl, savedUserId],
  );

  useEffect(() => {
    if (!activeConfig) {
      setInitStatus('error');
      setInitError('Populate example/src/hawcx.config.ts with a project API key and base URL.');
      return;
    }

    let cancelled = false;

    const boot = async () => {
      try {
        setInitStatus('initializing');
        setInitError(null);
        await initialize(activeConfig);
        if (cancelled) {
          return;
        }
        setInitStatus('ready');
        appendLog('SDK initialized successfully');
        await hydrateSavedUser();
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = (error as Error)?.message ?? 'Failed to initialize the Hawcx SDK';
        setInitStatus('error');
        setInitError(message);
        appendLog(`SDK initialization failed: ${message}`);
      }
    };

    boot().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeConfig, appendLog, hydrateSavedUser]);

  useEffect(() => {
    setCurrentStage((previous) => resolveStage(v6.state, previous));
  }, [v6.state]);

  useEffect(() => {
    const pendingTransition = pendingTransitionRef.current;
    if (!pendingTransition || pendingAction !== pendingTransition.action) {
      return;
    }

    if (v6.state.status === 'loading') {
      pendingTransition.sawLoading = true;
      return;
    }

    if (
      pendingTransition.sawLoading ||
      v6TransitionKey !== pendingTransition.key ||
      v6.state.status === 'completed' ||
      v6.state.status === 'error'
    ) {
      clearPendingAction(pendingTransition.action);
    }
  }, [clearPendingAction, pendingAction, v6.state.status, v6TransitionKey]);

  useEffect(() => {
    const promptType = currentPrompt?.prompt.type;
    if (previousPromptTypeRef.current === promptType) {
      return;
    }

    if (currentPrompt?.prompt.type === 'setup_sms') {
      setPhoneInput(currentPrompt.prompt.existingPhone ?? '');
    }

    if (promptType === 'enter_code' || promptType === 'enter_totp' || promptType === 'setup_totp') {
      setCodeInput('');
    }

    previousPromptTypeRef.current = promptType;
  }, [currentPrompt]);

  useEffect(() => {
    const summary = [
      v6.state.status,
      currentPrompt?.prompt.type ?? 'none',
      v6.state.traceId ?? 'no-trace',
      v6.state.error?.code ?? 'no-error',
      v6.state.completed?.traceId ?? 'no-completion',
    ].join('|');

    if (loggedStateRef.current === summary) {
      return;
    }
    loggedStateRef.current = summary;

    const promptLabel = currentPrompt ? ` (${currentPrompt.prompt.type})` : '';
    const traceLabel = v6.state.traceId ? ` trace=${v6.state.traceId}` : '';
    appendLog(`v6 state: ${v6.state.status}${promptLabel}${traceLabel}`);
  }, [appendLog, currentPrompt, v6.state]);

  useEffect(() => {
    if (web.state.status === 'success') {
      setWebStatus('Legacy web login fallback completed.');
      setWebError(null);
      appendLog('legacy web session completed');
    } else if (web.state.status === 'error') {
      setWebError(`${web.state.error.code}: ${web.state.error.message}`);
      setWebStatus(null);
      appendLog(`legacy web session error: ${web.state.error.code}`);
    }
  }, [appendLog, web.state]);

  useEffect(() => {
    const completion = v6.state.completed;
    if (!completion || v6.state.status !== 'completed') {
      return;
    }

    const completionKey = `${completion.session}:${completion.traceId}`;
    if (handledCompletionRef.current === completionKey) {
      return;
    }
    handledCompletionRef.current = completionKey;

    exchangeWithBackend(completion, currentIdentifier).catch((error) => {
      const message =
        (error as Error)?.message ?? 'Failed to exchange the completed authorization code.';
      setBackendStatus(null);
      setBackendError(message);
      appendLog(`backend exchange failed: ${message}`);
    });
  }, [appendLog, currentIdentifier, exchangeWithBackend, v6.state.completed, v6.state.status]);

  useEffect(() => {
    const receiveUrl = (url: string) => {
      setPendingRedirectUrl(url);
      appendLog(`received redirect URL: ${url}`);
    };

    const subscription = Linking.addEventListener('url', ({ url }) => receiveUrl(url));

    Linking.getInitialURL()
      .then((url) => {
        if (url) {
          receiveUrl(url);
        }
      })
      .catch(() => undefined);

    return () => subscription.remove();
  }, [appendLog]);

  useEffect(() => {
    if (!pendingRedirectUrl || !isReady) {
      return;
    }

    const url = pendingRedirectUrl;
    setPendingRedirectUrl(null);
    setManualRedirectUrl(url);

    v6.handleRedirectUrl(url)
      .then(() => appendLog('forwarded redirect URL to the V6 bridge'))
      .catch((error) => {
        const message = (error as Error)?.message ?? 'Failed to handle redirect URL.';
        setWebError(message);
        appendLog(`redirect handling failed: ${message}`);
      })
      .finally(() => {
        clearPendingAction('handle_redirect');
      });
  }, [appendLog, clearPendingAction, isReady, pendingRedirectUrl, v6]);

  const startFlow = useCallback(async () => {
    if (!requireReady()) {
      return;
    }
    const trimmedIdentifier = identifier.trim();
    if (!isValidIdentifier(trimmedIdentifier)) {
      setBackendError('Enter a valid email address or phone number to continue.');
      return;
    }

    await runPendingAction(
      'start',
      async () => {
        setBackendStatus(null);
        setBackendError(null);
        setWebStatus(null);
        setWebError(null);
        handledCompletionRef.current = null;
        appendLog(`starting signin flow for ${trimmedIdentifier}`);
        await v6.start({
          identifier: trimmedIdentifier,
          flowType: 'signin',
        });
      },
      { waitForTransition: true },
    );
  }, [appendLog, identifier, requireReady, runPendingAction, v6]);

  const openExternalUrl = useCallback(
    (url: string) => {
      Linking.openURL(url)
        .then(() => appendLog(`opened external URL ${url}`))
        .catch((error) => {
          const message = (error as Error)?.message ?? 'Failed to open the external URL.';
          setWebError(message);
          appendLog(`external URL open failed: ${message}`);
        });
    },
    [appendLog],
  );

  const submitCurrentPrompt = useCallback(async () => {
    if (!requireReady() || !currentPrompt) {
      return;
    }

    const waitForTransition = currentPrompt.prompt.type !== 'redirect';
    await runPendingAction(
      'submit_prompt',
      async () => {
        switch (currentPrompt.prompt.type) {
          case 'enter_code':
            await v6.submitCode(codeInput.trim());
            break;
          case 'setup_sms':
            await v6.submitPhone(phoneInput.trim());
            break;
          case 'setup_totp':
          case 'enter_totp':
            await v6.submitTotp(codeInput.trim());
            break;
          case 'redirect':
            await openExternalUrl(currentPrompt.prompt.url);
            break;
          case 'await_approval':
            await v6.poll();
            appendLog('polled await-approval state');
            break;
          default:
            break;
        }
      },
      { waitForTransition },
    );
  }, [
    appendLog,
    codeInput,
    currentPrompt,
    openExternalUrl,
    phoneInput,
    requireReady,
    runPendingAction,
    v6,
  ]);

  const selectMethod = useCallback(
    async (methodId: string) => {
      if (!requireReady()) {
        return;
      }
      await runPendingAction(
        'select_method',
        async () => {
          await v6.selectMethod(methodId);
          appendLog(`selected method ${methodId}`);
        },
        { waitForTransition: true, methodId },
      );
    },
    [appendLog, requireReady, runPendingAction, v6],
  );

  const changeIdentifier = useCallback(async () => {
    await runPendingAction('change_identifier', async () => {
      await v6.changeIdentifier();
      setCodeInput('');
      setPhoneInput('');
      setBackendStatus(null);
      setBackendError(null);
      appendLog('reset flow to change identifier');
    });
  }, [appendLog, runPendingAction, v6]);

  const resetFlow = useCallback(async () => {
    await runPendingAction('reset_flow', async () => {
      await v6.reset();
      setBackendStatus(null);
      setBackendError(null);
      appendLog('fully reset V6 flow');
    });
  }, [appendLog, runPendingAction, v6]);

  const resendCode = useCallback(async () => {
    await runPendingAction('resend_code', async () => {
      const result = await v6.resend();
      appendLog(result ? 'requested resend' : 'resend unavailable');
    });
  }, [appendLog, runPendingAction, v6]);

  const runMixedModeScan = useCallback(async () => {
    await runPendingAction('process_scan', async () => {
      if (!requireReady()) {
        return;
      }
      const route = routeWebLoginScan(scanInput);
      setWebError(null);
      setWebStatus(null);

      if (route.kind === 'invalid') {
        setWebError(
          'Unsupported scan payload. Provide a protocol QR JSON payload or a legacy 7-digit PIN URL.',
        );
        return;
      }

      if (route.kind === 'legacy_pin') {
        await web.webLogin(route.pin);
        setWebStatus(`Submitted legacy PIN ${route.pin}.`);
        appendLog(`submitted legacy PIN ${route.pin}`);
        return;
      }

      const approvalIdentifier = (preferredUserId ?? identifier.trim()).trim();
      if (!approvalIdentifier) {
        setWebError(
          'Provide an identifier or load a saved trusted user before approving protocol QR payloads.',
        );
        return;
      }

      const approval = await approveV6Qr(route.payload.raw, approvalIdentifier, {
        rememberDevice: true,
      });
      const approvedUserId = 'userId' in approval ? approval.userId : undefined;

      setWebStatus(
        approval.outcome === 'bound'
          ? `Protocol QR approved and bound for ${approvedUserId ?? approvalIdentifier}.`
          : `Protocol QR approved for ${approvalIdentifier}.`,
      );
      setSavedUserId(approvedUserId ?? approvalIdentifier);
      appendLog(`approved protocol QR payload (${route.payload.type})`);
    });
  }, [appendLog, identifier, preferredUserId, requireReady, runPendingAction, scanInput, web]);

  const handleManualRedirect = useCallback(async () => {
    if (!requireReady()) {
      return;
    }
    const trimmedUrl = manualRedirectUrl.trim();
    if (!trimmedUrl) {
      setWebError('Paste the callback URL before forwarding it manually.');
      return;
    }
    setPendingAction('handle_redirect');
    setPendingRedirectUrl(trimmedUrl);
  }, [manualRedirectUrl, requireReady]);

  const isFlowBusy = pendingAction !== null || v6.state.status === 'loading';

  const renderMethodButton = (method: HawcxV6Method) => {
    const isMethodLoading = pendingAction === 'select_method' && pendingMethodId === method.id;
    return (
      <TouchableOpacity
        key={method.id}
        style={[
          styles.secondaryButton,
          isFlowBusy && !isMethodLoading && styles.buttonDisabled,
          isMethodLoading && styles.buttonLoading,
        ]}
        disabled={isFlowBusy}
        onPress={() => void selectMethod(method.id)}
      >
        <View style={styles.buttonContent}>
          {isMethodLoading ? <ActivityIndicator color={COLORS.text} size="small" /> : null}
          <Text style={styles.secondaryButtonText}>
            {isMethodLoading ? 'Continuing…' : method.label}
          </Text>
        </View>
        <Text style={styles.secondaryMeta}>{method.id}</Text>
      </TouchableOpacity>
    );
  };

  const promptActionLabel = actionLabelForPrompt(currentPrompt);
  const setupTotpPrompt = currentPrompt?.prompt.type === 'setup_totp' ? currentPrompt.prompt : null;
  const canSubmitPrompt = (() => {
    switch (currentPrompt?.prompt.type) {
      case 'enter_code':
      case 'setup_totp':
      case 'enter_totp':
        return codeInput.trim().length > 0;
      case 'setup_sms':
        return isValidPhone(phoneInput);
      case 'redirect':
      case 'await_approval':
        return true;
      default:
        return false;
    }
  })();
  const currentStageDescriptor = STAGE_COPY[currentStage];
  const currentStepLabel =
    currentPrompt?.prompt.type === 'redirect'
      ? 'Continue in browser'
      : currentPrompt?.prompt.type === 'await_approval'
        ? 'Complete the approval'
        : currentPrompt
          ? promptTitle(currentPrompt)
          : v6.state.status === 'completed'
            ? 'Authorization code received'
            : 'Enter an identifier to begin';
  const currentStepGuidance =
    currentPrompt?.prompt.type === 'await_approval'
      ? 'Approve the request in the linked browser or device, then poll for the result here.'
      : currentPrompt
        ? promptSubtitle(currentPrompt)
        : 'Start with an email address or phone number to move through the primary verification step.';
  const currentStepMetaValue = v6.state.step?.id
    ? `${titleize(v6.state.step.id)} • ${currentStageDescriptor.title}`
    : `${currentStageDescriptor.title} • ${currentStepLabel}`;
  const startButtonLoading = pendingAction === 'start';
  const promptButtonLoading = pendingAction === 'submit_prompt';
  const promptLoadingLabel =
    currentPrompt?.prompt.type === 'setup_sms'
      ? 'Saving…'
      : currentPrompt?.prompt.type === 'setup_totp' || currentPrompt?.prompt.type === 'enter_totp'
        ? 'Verifying…'
        : currentPrompt?.prompt.type === 'await_approval'
          ? 'Checking…'
          : 'Continuing…';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Hawcx React Native V6 Example</Text>
        <Text style={styles.subtitle}>
          Focused maintainer app for V6 sign-in, backend exchange, mixed-mode web login, and log
          capture.
        </Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>V6 Authentication</Text>
              <Text style={styles.cardSubtitle}>{promptTitle(currentPrompt)}</Text>
            </View>
            <View style={styles.toggleControl}>
              <View style={styles.toggleCopy}>
                <Text style={styles.toggleLabel}>Exchange mode</Text>
                <Text style={styles.toggleValue}>
                  {backendFlowEnabled ? 'Backend' : 'Demo'}
                </Text>
              </View>
              <Switch value={backendFlowEnabled} onValueChange={setBackendFlowEnabled} />
            </View>
          </View>

          <Text style={styles.statusLine}>
            Status: {STATUS_COPY[v6.state.status] ?? v6.state.status}
          </Text>
          <Text style={styles.statusLine}>{promptSubtitle(currentPrompt)}</Text>
          <Text style={styles.statusLine}>
            SDK state: {initStatus === 'ready' ? 'Ready' : initStatus}
          </Text>
          {savedUserId ? (
            <Text style={[styles.statusLine, styles.successText]}>
              Saved trusted user: {savedUserId}
            </Text>
          ) : null}
          {initError ? (
            <Text style={[styles.statusLine, styles.errorText]}>{initError}</Text>
          ) : null}

          <View style={styles.currentStepCard}>
            <View style={styles.currentStepHeader}>
              <Text style={styles.currentStepEyebrow}>Current step</Text>
              <Text style={styles.currentStepCount}>
                Step {currentStageDescriptor.number} of {STAGE_ORDER.length}
              </Text>
            </View>
            <Text style={styles.currentStepTitle}>{currentStageDescriptor.title}</Text>
            <Text style={styles.currentStepSubtitleText}>{currentStageDescriptor.subtitle}</Text>
            <Text style={styles.currentStepBody}>{currentStepLabel}</Text>
            <Text style={styles.currentStepDetail}>{currentStepGuidance}</Text>
          </View>

          <View style={styles.stageRow}>
            {STAGE_ORDER.map((stage) => {
              const descriptor = STAGE_COPY[stage];
              const isActive = currentStage === stage;
              const isPast = stageRank(stage) < stageRank(currentStage);
              const stageStateLabel = isActive ? 'Current' : isPast ? 'Done' : 'Next';
              return (
                <View
                  key={stage}
                  style={[
                    styles.stageBadge,
                    isActive && styles.stageBadgeActive,
                    isPast && styles.stageBadgePast,
                  ]}
                >
                  <View style={styles.stageBadgeHeader}>
                    <Text
                      style={[
                        styles.stageNumber,
                        (isActive || isPast) && styles.stageNumberActive,
                      ]}
                    >
                      {descriptor.number}
                    </Text>
                    <View
                      style={[
                        styles.stageStatusPill,
                        isActive
                          ? styles.stageStatusPillActive
                          : isPast
                            ? styles.stageStatusPillPast
                            : styles.stageStatusPillUpcoming,
                      ]}
                    >
                      <Text
                        style={[
                          styles.stageStatusText,
                          isActive
                            ? styles.stageStatusTextActive
                            : isPast
                              ? styles.stageStatusTextPast
                              : null,
                        ]}
                      >
                        {stageStateLabel}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[styles.stageTitle, (isActive || isPast) && styles.stageTitleActive]}
                  >
                    {descriptor.title}
                  </Text>
                  <Text style={styles.stageSubtitle}>{descriptor.subtitle}</Text>
                </View>
              );
            })}
          </View>

          {!currentPrompt && v6.state.status !== 'completed' ? (
            <>
              <TextInput
                testID="v6-identifier-input"
                style={styles.input}
                placeholder="Email or phone"
                placeholderTextColor={COLORS.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={identifier}
                onChangeText={setIdentifier}
              />
              {!isValidIdentifier(identifier) && identifier.trim().length > 0 ? (
                <Text style={[styles.statusLine, styles.errorText]}>
                  Please enter a valid email address or phone number.
                </Text>
              ) : null}
              <ActionButton
                testID="v6-start-button"
                label={actionLabelForPrompt(undefined) ?? 'Continue'}
                loadingLabel="Continuing…"
                disabled={!isReady || !isValidIdentifier(identifier) || isFlowBusy}
                loading={startButtonLoading}
                onPress={() => void startFlow()}
              />
            </>
          ) : null}

          {currentPrompt && currentIdentifier ? (
            <View style={styles.inlineBanner}>
              <View style={styles.inlineBannerCopy}>
                <Text style={styles.inlineBannerTitle}>Identifier locked for this step</Text>
                <Text style={styles.inlineBannerText}>{currentIdentifier}</Text>
              </View>
              <ActionButton
                variant="secondaryTiny"
                label="Change Identifier"
                loadingLabel="Resetting…"
                disabled={isFlowBusy}
                loading={pendingAction === 'change_identifier'}
                onPress={() => void changeIdentifier()}
              />
            </View>
          ) : null}

          {currentPrompt?.prompt.type === 'select_method' ? (
            <View style={styles.methodGrid}>
              {currentPrompt.prompt.methods.map(renderMethodButton)}
            </View>
          ) : null}

          {currentPrompt?.prompt.type === 'enter_code' ? (
            <>
              <Text style={styles.statusLine}>
                Destination: {currentPrompt.prompt.destination}
                {v6.state.codeChannel ? ` • ${v6.state.codeChannel}` : ''}
              </Text>
              {currentPrompt.prompt.codeLength ? (
                <Text style={styles.statusLine}>
                  Expected length: {currentPrompt.prompt.codeLength}
                  {currentPrompt.prompt.codeFormat ? ` (${currentPrompt.prompt.codeFormat})` : ''}
                </Text>
              ) : null}
              {currentPrompt.prompt.codeExpiresAt ? (
                <Text style={styles.statusLine}>
                  Code expires: {formatDateTime(currentPrompt.prompt.codeExpiresAt)}
                </Text>
              ) : null}
              <TextInput
                testID="v6-code-input"
                style={styles.input}
                placeholder="Verification code"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                value={codeInput}
                onChangeText={setCodeInput}
              />
              {promptActionLabel ? (
                <ActionButton
                  label={promptActionLabel}
                  loadingLabel={promptLoadingLabel}
                  disabled={!canSubmitPrompt || isFlowBusy}
                  loading={promptButtonLoading}
                  onPress={() => void submitCurrentPrompt()}
                />
              ) : null}
              <View style={styles.inlineRow}>
                <ActionButton
                  variant="secondaryTiny"
                  label="Resend Code"
                  loadingLabel="Sending…"
                  disabled={!v6.canResend || isFlowBusy}
                  loading={pendingAction === 'resend_code'}
                  onPress={() => void resendCode()}
                />
                <Text style={styles.statusLine}>
                  {v6.canResend
                    ? 'Resend is available now.'
                    : `Resend available in ${v6.secondsUntilResend ?? 0}s`}
                </Text>
              </View>
            </>
          ) : null}

          {currentPrompt?.prompt.type === 'setup_sms' ? (
            <>
              {currentPrompt.prompt.existingPhone ? (
                <Text style={styles.statusLine}>
                  Existing phone: {currentPrompt.prompt.existingPhone}
                </Text>
              ) : null}
              <TextInput
                style={styles.input}
                placeholder="+1 555 123 4567"
                placeholderTextColor={COLORS.muted}
                keyboardType="phone-pad"
                value={phoneInput}
                onChangeText={setPhoneInput}
              />
              {!isValidPhone(phoneInput) && phoneInput.trim().length > 0 ? (
                <Text style={[styles.statusLine, styles.errorText]}>
                  Enter a phone number with at least 7 digits.
                </Text>
              ) : null}
              {promptActionLabel ? (
                <ActionButton
                  label={promptActionLabel}
                  loadingLabel={promptLoadingLabel}
                  disabled={!canSubmitPrompt || isFlowBusy}
                  loading={promptButtonLoading}
                  onPress={() => void submitCurrentPrompt()}
                />
              ) : null}
            </>
          ) : null}

          {setupTotpPrompt ? (
            <>
              <Text style={styles.statusLine}>Secret</Text>
              <Text style={styles.monoBlock}>{setupTotpPrompt.secret}</Text>
              <Text style={styles.statusLine}>Authenticator link</Text>
              <Text style={styles.monoBlock}>{setupTotpPrompt.otpauthUrl}</Text>
              <View style={styles.inlineRow}>
                <TouchableOpacity
                  style={styles.secondaryTinyButton}
                  onPress={() => void openExternalUrl(setupTotpPrompt.otpauthUrl)}
                >
                  <Text style={styles.secondaryTinyButtonText}>Open Authenticator App</Text>
                </TouchableOpacity>
                {setupTotpPrompt.period ? (
                  <Text style={styles.statusLine}>Refreshes every {setupTotpPrompt.period}s</Text>
                ) : null}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Authenticator code"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                value={codeInput}
                onChangeText={setCodeInput}
              />
              {promptActionLabel ? (
                <ActionButton
                  label={promptActionLabel}
                  loadingLabel={promptLoadingLabel}
                  disabled={!canSubmitPrompt || isFlowBusy}
                  loading={promptButtonLoading}
                  onPress={() => void submitCurrentPrompt()}
                />
              ) : null}
            </>
          ) : null}

          {currentPrompt?.prompt.type === 'enter_totp' ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Authenticator code"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                value={codeInput}
                onChangeText={setCodeInput}
              />
              {promptActionLabel ? (
                <ActionButton
                  label={promptActionLabel}
                  loadingLabel={promptLoadingLabel}
                  disabled={!canSubmitPrompt || isFlowBusy}
                  loading={promptButtonLoading}
                  onPress={() => void submitCurrentPrompt()}
                />
              ) : null}
            </>
          ) : null}

          {currentPrompt?.prompt.type === 'redirect' ? (
            <>
              <Text style={styles.statusLine}>Redirect URL</Text>
              <Text style={styles.monoBlock}>{currentPrompt.prompt.url}</Text>
              {redirectWarning ? (
                <Text style={[styles.statusLine, styles.warningText]}>{redirectWarning}</Text>
              ) : null}
              {promptActionLabel ? (
                <ActionButton
                  label={promptActionLabel}
                  loadingLabel="Opening…"
                  disabled={isFlowBusy}
                  loading={promptButtonLoading}
                  onPress={() => void submitCurrentPrompt()}
                />
              ) : null}
              <TextInput
                style={styles.input}
                placeholder="Paste redirect callback URL"
                placeholderTextColor={COLORS.muted}
                autoCapitalize="none"
                value={manualRedirectUrl}
                onChangeText={setManualRedirectUrl}
              />
              <ActionButton
                variant="secondary"
                label="Handle Redirect Manually"
                loadingLabel="Handling…"
                disabled={!manualRedirectUrl.trim() || isFlowBusy}
                loading={pendingAction === 'handle_redirect'}
                onPress={() => void handleManualRedirect()}
              />
            </>
          ) : null}

          {currentPrompt?.prompt.type === 'await_approval' ? (
            <>
              <Text style={styles.statusLine}>
                Expires: {formatDateTime(currentPrompt.prompt.expiresAt) ?? 'Unknown'}
              </Text>
              <Text style={styles.statusLine}>
                Recommended poll interval: {currentPrompt.prompt.pollInterval}s
              </Text>
              {currentPrompt.prompt.qrData ? (
                <>
                  <Text style={styles.statusLine}>QR payload</Text>
                  <Text style={styles.monoBlock}>{currentPrompt.prompt.qrData}</Text>
                </>
              ) : null}
              {promptActionLabel ? (
                <ActionButton
                  label={promptActionLabel}
                  loadingLabel={promptLoadingLabel}
                  disabled={isFlowBusy}
                  loading={promptButtonLoading}
                  onPress={() => void submitCurrentPrompt()}
                />
              ) : null}
            </>
          ) : null}

          {v6.state.status === 'loading' ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={COLORS.accent} />
              <Text style={styles.statusLine}>
                {pendingAction === 'start'
                  ? 'Starting sign in…'
                  : pendingAction === 'process_scan'
                    ? 'Processing scan result…'
                    : promptLoadingLabel}
              </Text>
            </View>
          ) : null}

          {v6.state.error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerTitle}>Authentication Failed</Text>
              <Text style={styles.errorBannerBody}>{v6.state.error.message}</Text>
              <Text style={styles.errorBannerMeta}>
                Code: {v6.state.error.code}
                {v6.state.error.action ? ` • Action: ${v6.state.error.action}` : ''}
              </Text>
              {v6.state.error.traceId ? (
                <Text style={styles.errorBannerMeta}>Trace ID: {v6.state.error.traceId}</Text>
              ) : null}
              {v6.state.error.details?.errors?.length ? (
                <View style={styles.errorList}>
                  {v6.state.error.details.errors.map((item) => (
                    <Text key={`${item.field}-${item.message}`} style={styles.errorItem}>
                      {item.field}: {item.message}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {v6.state.risk?.detected ? (
            <View style={styles.warningBanner}>
              <Text style={styles.warningBannerTitle}>Risk detected</Text>
              {v6.state.risk.message ? (
                <Text style={styles.warningBannerBody}>{v6.state.risk.message}</Text>
              ) : null}
              {v6.state.risk.reasons.map((reason) => (
                <Text key={reason} style={styles.warningBannerBody}>
                  - {reason}
                </Text>
              ))}
              {v6.state.risk.location ? (
                <Text style={styles.warningBannerMeta}>
                  Location:{' '}
                  {[v6.state.risk.location.city, v6.state.risk.location.country]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.metaGrid}>
            <MetaItem label="Trace ID" value={v6.state.traceId ?? v6.state.error?.traceId} />
            <MetaItem label="Session" value={v6.state.session} />
            <MetaItem label="Current Step" value={currentStepMetaValue} />
            <MetaItem label="Expires" value={formatDateTime(v6.state.expiresAt) ?? undefined} />
          </View>

          {v6.state.status === 'completed' && v6.state.completed ? (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerTitle}>Authorization code received</Text>
              <Text style={styles.successBannerBody}>
                Code: {summarizeValue(v6.state.completed.authCode, 8, 6)}
              </Text>
              <Text style={styles.successBannerBody}>Trace ID: {v6.state.completed.traceId}</Text>
              <Text style={styles.successBannerBody}>
                Expires:{' '}
                {formatDateTime(v6.state.completed.expiresAt) ?? v6.state.completed.expiresAt}
              </Text>
            </View>
          ) : null}

          <View style={styles.inlineRow}>
            <ActionButton
              variant="secondaryTiny"
              label="Change Identifier"
              loadingLabel="Resetting…"
              disabled={isFlowBusy}
              loading={pendingAction === 'change_identifier'}
              onPress={() => void changeIdentifier()}
            />
            <ActionButton
              variant="secondaryTiny"
              label="Reset Flow"
              loadingLabel="Resetting…"
              disabled={isFlowBusy}
              loading={pendingAction === 'reset_flow'}
              onPress={() => void resetFlow()}
            />
          </View>

          <View style={styles.backendCard}>
            <Text style={styles.sectionTitle}>Authorization Code Exchange</Text>
            <Text style={styles.statusLine}>
              Mode: {backendFlowEnabled ? 'Real backend exchange' : 'Demo mode'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="https://example-ngrok-url.ngrok-free.dev/api/login"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="none"
              value={backendUrl}
              onChangeText={setBackendUrl}
            />
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setBackendUrl(EXAMPLE_DEFAULT_BACKEND_URL)}
            >
              <Text style={styles.secondaryButtonText}>Use localhost:3000</Text>
            </TouchableOpacity>
            {backendStatus ? (
              <Text style={[styles.statusLine, styles.successText]}>{backendStatus}</Text>
            ) : null}
            {backendError ? (
              <Text style={[styles.statusLine, styles.errorText]}>{backendError}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mixed-Mode Web Login</Text>
          <Text style={styles.cardSubtitle}>
            Paste a scanned value, protocol QR JSON, legacy PIN URL, or a bare 7-digit PIN.
          </Text>
          <TextInput
            style={[styles.input, styles.payloadInput]}
            placeholder='{"type":"qr_auth","session_id":"..."} or https://hawcx.com?pin=1234567'
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            multiline
            value={scanInput}
            onChangeText={setScanInput}
          />
          <Text style={styles.statusLine}>
            Protocol approvals use {preferredUserId ?? 'the identifier in the auth card'} as the
            signing user.
          </Text>
          <Text style={styles.statusLine}>
            Registered return schemes: {EXAMPLE_REDIRECT_SCHEMES.join(', ')}
          </Text>
          <ActionButton
            label="Process Scan Result"
            loadingLabel="Processing…"
            disabled={!scanInput.trim() || isFlowBusy}
            loading={pendingAction === 'process_scan'}
            onPress={() => void runMixedModeScan()}
          />
          {webStatus ? (
            <Text style={[styles.statusLine, styles.successText]}>{webStatus}</Text>
          ) : null}
          {webError ? <Text style={[styles.statusLine, styles.errorText]}>{webError}</Text> : null}
          <Text style={styles.statusLine}>Legacy web session state: {web.state.status}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Logs</Text>
              <Text style={styles.cardSubtitle}>
                Toggle lightweight in-app logging for auth, backend exchange, redirects, and web
                login events.
              </Text>
            </View>
            <View style={styles.toggleControl}>
              <View style={styles.toggleCopy}>
                <Text style={styles.toggleLabel}>In-app logs</Text>
                <Text style={styles.toggleValue}>{loggingEnabled ? 'On' : 'Off'}</Text>
              </View>
              <Switch value={loggingEnabled} onValueChange={setLoggingEnabled} />
            </View>
          </View>
          {logs.length === 0 ? (
            <Text style={styles.statusLine}>No logs captured yet.</Text>
          ) : (
            logs.slice(0, 16).map((log) => (
              <Text key={log} style={styles.logLine}>
                {log}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const MetaItem = ({ label, value }: { label: string; value?: string }) => (
  <View style={styles.metaItem}>
    <Text style={styles.metaLabel}>{label}</Text>
    <Text style={styles.metaValue}>{value ?? '—'}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  title: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.muted,
    lineHeight: 20,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backendCard: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  cardHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: COLORS.muted,
    marginTop: 4,
    lineHeight: 18,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  statusLine: {
    color: COLORS.muted,
    lineHeight: 18,
  },
  input: {
    backgroundColor: '#08101b',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  payloadInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  destructiveButton: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
    alignItems: 'center',
    flex: 1,
  },
  secondaryButton: {
    backgroundColor: '#1d3146',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    flex: 1,
  },
  secondaryTinyButton: {
    backgroundColor: '#1d3146',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  primaryButtonText: {
    color: '#111827',
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  secondaryTinyButtonText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: 12,
  },
  secondaryMeta: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonLoading: {
    opacity: 0.82,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  inlineSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleControl: {
    marginLeft: 'auto',
    minWidth: 138,
    maxWidth: '100%',
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleCopy: {
    flexShrink: 1,
  },
  toggleLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  toggleValue: {
    color: COLORS.text,
    fontWeight: '600',
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardAlt,
  },
  chipButtonActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  chipButtonText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  chipButtonTextActive: {
    color: '#111827',
  },
  currentStepCard: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  currentStepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  currentStepEyebrow: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  currentStepCount: {
    color: COLORS.accentMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  currentStepTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
  },
  currentStepSubtitleText: {
    color: COLORS.accentMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  currentStepBody: {
    color: COLORS.text,
    fontWeight: '600',
    marginTop: 6,
  },
  currentStepDetail: {
    color: COLORS.muted,
    lineHeight: 18,
  },
  stageRow: {
    flexDirection: 'row',
    gap: 8,
  },
  stageBadge: {
    flex: 1,
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stageBadgeActive: {
    borderColor: COLORS.accent,
    backgroundColor: '#2f1f14',
  },
  stageBadgePast: {
    borderColor: '#14532d',
    backgroundColor: '#102117',
  },
  stageBadgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stageStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  stageStatusPillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  stageStatusPillPast: {
    backgroundColor: '#14532d',
    borderColor: '#166534',
  },
  stageStatusPillUpcoming: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
  },
  stageStatusText: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  stageStatusTextActive: {
    color: '#111827',
  },
  stageStatusTextPast: {
    color: '#bbf7d0',
  },
  stageNumber: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  stageNumberActive: {
    color: COLORS.text,
  },
  stageTitle: {
    color: COLORS.text,
    fontWeight: '700',
    marginTop: 4,
  },
  stageTitleActive: {
    color: COLORS.text,
  },
  stageSubtitle: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 2,
  },
  inlineBanner: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  inlineBannerCopy: {
    flex: 1,
  },
  inlineBannerTitle: {
    color: COLORS.text,
    fontWeight: '600',
  },
  inlineBannerText: {
    color: COLORS.muted,
    marginTop: 4,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  methodGrid: {
    gap: 10,
  },
  warningBanner: {
    backgroundColor: '#2d240d',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#7c5c17',
    gap: 4,
  },
  warningBannerTitle: {
    color: COLORS.warning,
    fontWeight: '700',
  },
  warningBannerBody: {
    color: '#fde68a',
  },
  warningBannerMeta: {
    color: '#fcd34d',
    fontSize: 12,
    marginTop: 2,
  },
  warningText: {
    color: COLORS.warning,
  },
  errorBanner: {
    backgroundColor: '#2a1212',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    gap: 4,
  },
  errorBannerTitle: {
    color: COLORS.error,
    fontWeight: '700',
  },
  errorBannerBody: {
    color: '#fecaca',
  },
  errorBannerMeta: {
    color: '#fca5a5',
    fontSize: 12,
  },
  errorList: {
    marginTop: 4,
    gap: 4,
  },
  errorItem: {
    color: '#fecaca',
    fontSize: 12,
  },
  successBanner: {
    backgroundColor: '#13261d',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#166534',
    gap: 4,
  },
  successBannerTitle: {
    color: COLORS.success,
    fontWeight: '700',
  },
  successBannerBody: {
    color: '#bbf7d0',
  },
  metaGrid: {
    gap: 8,
  },
  metaItem: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  metaLabel: {
    color: COLORS.muted,
    fontSize: 12,
    marginBottom: 4,
  },
  metaValue: {
    color: COLORS.text,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  monoBlock: {
    color: COLORS.text,
    backgroundColor: '#08101b',
    borderRadius: 10,
    padding: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  monoInline: {
    color: COLORS.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  eventCard: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  logLine: {
    color: COLORS.muted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  successText: {
    color: COLORS.success,
  },
  errorText: {
    color: COLORS.error,
  },
});

export default App;
