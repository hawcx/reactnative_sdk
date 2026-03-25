/* eslint-disable no-void */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  approveV6Qr,
  addPushListener,
  approvePushRequest,
  clearLastLoggedInUser,
  declinePushRequest,
  forgetTrustedDevice,
  getLastLoggedInUser,
  handlePushNotification as forwardPushPayload,
  initialize,
  logoutSession,
  notifyUserAuthenticated,
  routeWebLoginScan,
  setPushDeviceToken,
  storeBackendOAuthTokens,
  useHawcxV6Auth,
  useHawcxWebLogin,
  type HawcxInitializeConfig,
  type HawcxV6AuthState,
  type HawcxV6CompletedPayload,
  type HawcxV6FlowType,
  type HawcxV6Method,
  type HawcxV6PromptPayload,
  type PushEvent,
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

const FLOW_OPTIONS: Array<{ value: HawcxV6FlowType; label: string }> = [
  { value: 'signin', label: 'Sign In' },
  { value: 'signup', label: 'Sign Up' },
  { value: 'account_manage', label: 'Manage Account' },
];

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
      return 'Kick off a V6 protocol flow with the current SDK workspace build.';
  }
};

const actionLabelForPrompt = (
  prompt?: HawcxV6PromptPayload,
  flowType: HawcxV6FlowType = 'signin',
) => {
  if (!prompt) {
    switch (flowType) {
      case 'signup':
        return 'Start V6 Sign Up';
      case 'account_manage':
        return 'Start Account Manage';
      case 'signin':
      default:
        return 'Start V6 Sign In';
    }
  }

  switch (prompt.prompt.type) {
    case 'enter_code':
      return 'Submit Code';
    case 'setup_sms':
      return 'Save Phone';
    case 'setup_totp':
    case 'enter_totp':
      return 'Verify Code';
    case 'redirect':
      return 'Open Browser';
    case 'await_approval':
      return 'Poll Status';
    default:
      return undefined;
  }
};

const App = () => {
  const [activeConfig] = useState<HawcxInitializeConfig | null>(DEFAULT_HAWCX_CONFIG);
  const [initStatus, setInitStatus] = useState<'idle' | 'initializing' | 'ready' | 'error'>('idle');
  const [initError, setInitError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState(EXAMPLE_DEFAULT_IDENTIFIER);
  const [selectedFlowType, setSelectedFlowType] = useState<HawcxV6FlowType>('signin');
  const [codeInput, setCodeInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [manualRedirectUrl, setManualRedirectUrl] = useState('');
  const [backendFlowEnabled, setBackendFlowEnabled] = useState(false);
  const [backendUrl, setBackendUrl] = useState(EXAMPLE_DEFAULT_BACKEND_URL);
  const [savedUserId, setSavedUserId] = useState<string | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [webStatus, setWebStatus] = useState<string | null>(null);
  const [webError, setWebError] = useState<string | null>(null);
  const [pushTokenInput, setPushTokenInput] = useState('');
  const [pushPayloadInput, setPushPayloadInput] = useState(
    '{"request_id":"","ip_address":"","deviceInfo":"","timestamp":""}',
  );
  const [pushRequestId, setPushRequestId] = useState('');
  const [pushEvents, setPushEvents] = useState<PushEvent[]>([]);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<ExampleStage>('primary');
  const [pendingRedirectUrl, setPendingRedirectUrl] = useState<string | null>(null);

  const v6 = useHawcxV6Auth(undefined, { flowType: selectedFlowType });
  const web = useHawcxWebLogin();
  const handledCompletionRef = useRef<string | null>(null);
  const loggedStateRef = useRef<string>('');
  const previousPromptTypeRef = useRef<string | undefined>();

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
  const maskedKey = useMemo(() => {
    if (!activeConfig?.projectApiKey) {
      return null;
    }
    return `Active key ••••${activeConfig.projectApiKey.slice(-4)}`;
  }, [activeConfig?.projectApiKey]);
  const redirectPrompt = currentPrompt?.prompt.type === 'redirect' ? currentPrompt.prompt : null;
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
    const subscription = addPushListener((event) => {
      setPushEvents((previous) => [event, ...previous].slice(0, 6));
      setPushStatus(`Received push event: ${event.type}`);
      appendLog(`push event: ${event.type}`);
    });
    return () => subscription.remove();
  }, [appendLog]);

  useEffect(() => {
    setCurrentStage((previous) => resolveStage(v6.state, previous));
  }, [v6.state]);

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
      });
  }, [appendLog, isReady, pendingRedirectUrl, v6]);

  const startFlow = useCallback(async () => {
    if (!requireReady()) {
      return;
    }
    const trimmedIdentifier = identifier.trim();
    if (!isValidIdentifier(trimmedIdentifier)) {
      setBackendError('Enter a valid email address or phone number to start the V6 flow.');
      return;
    }

    setBackendStatus(null);
    setBackendError(null);
    setWebStatus(null);
    setWebError(null);
    handledCompletionRef.current = null;
    appendLog(`starting ${selectedFlowType} flow for ${trimmedIdentifier}`);
    await v6.start({
      identifier: trimmedIdentifier,
      flowType: selectedFlowType,
    });
  }, [appendLog, identifier, requireReady, selectedFlowType, v6]);

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
        openExternalUrl(currentPrompt.prompt.url);
        break;
      case 'await_approval':
        await v6.poll();
        appendLog('polled await-approval state');
        break;
      default:
        break;
    }
  }, [appendLog, codeInput, currentPrompt, openExternalUrl, phoneInput, requireReady, v6]);

  const changeIdentifier = useCallback(async () => {
    await v6.changeIdentifier();
    setCodeInput('');
    setPhoneInput('');
    setBackendStatus(null);
    setBackendError(null);
    appendLog('reset flow to change identifier');
  }, [appendLog, v6]);

  const resetFlow = useCallback(async () => {
    await v6.reset();
    setBackendStatus(null);
    setBackendError(null);
    appendLog('fully reset V6 flow');
  }, [appendLog, v6]);

  const resendCode = useCallback(async () => {
    const result = await v6.resend();
    appendLog(result ? 'requested resend' : 'resend unavailable');
  }, [appendLog, v6]);

  const runMixedModeScan = useCallback(async () => {
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
  }, [appendLog, identifier, preferredUserId, requireReady, scanInput, web]);

  const handleManualRedirect = useCallback(async () => {
    if (!requireReady()) {
      return;
    }
    const trimmedUrl = manualRedirectUrl.trim();
    if (!trimmedUrl) {
      setWebError('Paste the callback URL before forwarding it manually.');
      return;
    }
    setPendingRedirectUrl(trimmedUrl);
  }, [manualRedirectUrl, requireReady]);

  const registerPushToken = useCallback(async () => {
    if (!requireReady()) {
      return;
    }

    const trimmed = pushTokenInput.trim();
    if (!trimmed) {
      setPushError('Enter a token first (FCM token on Android or APNs bytes on iOS).');
      return;
    }

    setPushError(null);
    try {
      if (Platform.OS === 'ios') {
        const bytes = trimmed
          .split(',')
          .map((segment) => parseInt(segment.trim(), 10))
          .filter((value) => !Number.isNaN(value));
        if (!bytes.length) {
          throw new Error('Provide a comma-separated APNs byte list for iOS.');
        }
        await setPushDeviceToken(bytes);
      } else {
        await setPushDeviceToken(trimmed);
      }
      setPushStatus('Push token submitted to the Hawcx SDK.');
      appendLog('registered push token with native SDK');
    } catch (error) {
      const message = (error as Error)?.message ?? 'Failed to register push token.';
      setPushError(message);
    }
  }, [appendLog, pushTokenInput, requireReady]);

  const forwardPush = useCallback(async () => {
    if (!requireReady()) {
      return;
    }
    setPushError(null);
    try {
      const parsed = JSON.parse(pushPayloadInput);
      await forwardPushPayload(parsed);
      setPushStatus('Forwarded payload to the Hawcx SDK.');
      appendLog('forwarded push payload to native SDK');
    } catch (error) {
      setPushError((error as Error)?.message ?? 'Invalid JSON payload.');
    }
  }, [appendLog, pushPayloadInput, requireReady]);

  const onApprovePush = useCallback(async () => {
    try {
      await approvePushRequest(pushRequestId.trim());
      setPushStatus('Approved push request.');
      appendLog(`approved push request ${pushRequestId.trim()}`);
    } catch (error) {
      setPushError((error as Error)?.message ?? 'Failed to approve push request.');
    }
  }, [appendLog, pushRequestId]);

  const onDeclinePush = useCallback(async () => {
    try {
      await declinePushRequest(pushRequestId.trim());
      setPushStatus('Declined push request.');
      appendLog(`declined push request ${pushRequestId.trim()}`);
    } catch (error) {
      setPushError((error as Error)?.message ?? 'Failed to decline push request.');
    }
  }, [appendLog, pushRequestId]);

  const markUserAuthenticated = useCallback(async () => {
    try {
      await notifyUserAuthenticated();
      setPushStatus('Notified the Hawcx SDK that the user authenticated.');
      appendLog('called notifyUserAuthenticated');
    } catch (error) {
      setPushError((error as Error)?.message ?? 'Failed to notify the Hawcx SDK.');
    }
  }, [appendLog]);

  const signOut = useCallback(async () => {
    const target = preferredUserId?.trim();
    if (!target) {
      setDeviceError('No saved user is available for session logout.');
      return;
    }
    setDeviceError(null);
    await logoutSession(target);
    setDeviceStatus(`Cleared session tokens for ${target}. Trusted device record was retained.`);
    appendLog(`cleared session tokens for ${target}`);
    await hydrateSavedUser();
  }, [appendLog, hydrateSavedUser, preferredUserId]);

  const forgetDevice = useCallback(async () => {
    const target = preferredUserId?.trim();
    if (!target) {
      setDeviceError('No saved user is available to forget from this device.');
      return;
    }
    setDeviceError(null);
    await forgetTrustedDevice(target);
    await clearLastLoggedInUser();
    setSavedUserId(null);
    setDeviceStatus(`Cleared trusted-device data for ${target}.`);
    appendLog(`forgot trusted device for ${target}`);
  }, [appendLog, preferredUserId]);

  const renderMethodButton = (method: HawcxV6Method) => (
    <TouchableOpacity
      key={method.id}
      style={styles.secondaryButton}
      onPress={() => void v6.selectMethod(method.id)}
    >
      <Text style={styles.secondaryButtonText}>{method.label}</Text>
      <Text style={styles.secondaryMeta}>{method.id}</Text>
    </TouchableOpacity>
  );

  const promptActionLabel = actionLabelForPrompt(currentPrompt, selectedFlowType);
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Hawcx React Native Example</Text>
        <Text style={styles.subtitle}>
          Secondary maintainer reference app for the local React SDK workspace. Use the separate
          smoke app for release signoff.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>SDK Status</Text>
          <Text style={styles.statusLine}>
            State: {initStatus === 'ready' ? 'Ready' : initStatus}
          </Text>
          {maskedKey ? <Text style={styles.statusLine}>{maskedKey}</Text> : null}
          {activeConfig?.baseUrl ? (
            <Text style={styles.statusLine}>Base URL: {activeConfig.baseUrl}</Text>
          ) : null}
          <Text style={styles.statusLine}>
            Redirect schemes: {EXAMPLE_REDIRECT_SCHEMES.join(', ')}
          </Text>
          {savedUserId ? (
            <Text style={[styles.statusLine, styles.successText]}>
              Saved trusted user: {savedUserId}
            </Text>
          ) : (
            <Text style={styles.statusLine}>Saved trusted user: none</Text>
          )}
          {initError ? (
            <Text style={[styles.statusLine, styles.errorText]}>{initError}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>V6 Authentication</Text>
              <Text style={styles.cardSubtitle}>{promptTitle(currentPrompt)}</Text>
            </View>
            <View style={styles.inlineSwitch}>
              <Text style={styles.statusLine}>{backendFlowEnabled ? 'Backend' : 'Demo'}</Text>
              <Switch value={backendFlowEnabled} onValueChange={setBackendFlowEnabled} />
            </View>
          </View>

          <Text style={styles.statusLine}>
            Status: {STATUS_COPY[v6.state.status] ?? v6.state.status}
          </Text>
          <Text style={styles.statusLine}>{promptSubtitle(currentPrompt)}</Text>

          <View style={styles.stageRow}>
            {STAGE_ORDER.map((stage) => {
              const descriptor = STAGE_COPY[stage];
              const isActive = currentStage === stage;
              const isPast = stageRank(stage) < stageRank(currentStage);
              return (
                <View
                  key={stage}
                  style={[
                    styles.stageBadge,
                    isActive && styles.stageBadgeActive,
                    isPast && styles.stageBadgePast,
                  ]}
                >
                  <Text
                    style={[styles.stageNumber, (isActive || isPast) && styles.stageNumberActive]}
                  >
                    {descriptor.number}
                  </Text>
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
              <View style={styles.chipRow}>
                {FLOW_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.chipButton,
                      selectedFlowType === option.value && styles.chipButtonActive,
                    ]}
                    onPress={() => setSelectedFlowType(option.value)}
                  >
                    <Text
                      style={[
                        styles.chipButtonText,
                        selectedFlowType === option.value && styles.chipButtonTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                testID="v6-start-button"
                style={[styles.primaryButton, !isReady && styles.buttonDisabled]}
                disabled={!isReady}
                onPress={() => void startFlow()}
              >
                <Text style={styles.primaryButtonText}>
                  {actionLabelForPrompt(undefined, selectedFlowType)}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}

          {currentPrompt && currentIdentifier ? (
            <View style={styles.inlineBanner}>
              <View style={styles.inlineBannerCopy}>
                <Text style={styles.inlineBannerTitle}>Identifier locked for this step</Text>
                <Text style={styles.inlineBannerText}>{currentIdentifier}</Text>
              </View>
              <TouchableOpacity
                style={styles.secondaryTinyButton}
                onPress={() => void changeIdentifier()}
              >
                <Text style={styles.secondaryTinyButtonText}>Change Identifier</Text>
              </TouchableOpacity>
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
                <TouchableOpacity
                  style={[styles.primaryButton, !canSubmitPrompt && styles.buttonDisabled]}
                  disabled={!canSubmitPrompt}
                  onPress={() => void submitCurrentPrompt()}
                >
                  <Text style={styles.primaryButtonText}>{promptActionLabel}</Text>
                </TouchableOpacity>
              ) : null}
              <View style={styles.inlineRow}>
                <TouchableOpacity
                  style={[styles.secondaryTinyButton, !v6.canResend && styles.buttonDisabled]}
                  disabled={!v6.canResend}
                  onPress={() => void resendCode()}
                >
                  <Text style={styles.secondaryTinyButtonText}>Resend Code</Text>
                </TouchableOpacity>
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
                <TouchableOpacity
                  style={[styles.primaryButton, !canSubmitPrompt && styles.buttonDisabled]}
                  disabled={!canSubmitPrompt}
                  onPress={() => void submitCurrentPrompt()}
                >
                  <Text style={styles.primaryButtonText}>{promptActionLabel}</Text>
                </TouchableOpacity>
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
                <TouchableOpacity
                  style={[styles.primaryButton, !canSubmitPrompt && styles.buttonDisabled]}
                  disabled={!canSubmitPrompt}
                  onPress={() => void submitCurrentPrompt()}
                >
                  <Text style={styles.primaryButtonText}>{promptActionLabel}</Text>
                </TouchableOpacity>
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
                <TouchableOpacity
                  style={[styles.primaryButton, !canSubmitPrompt && styles.buttonDisabled]}
                  disabled={!canSubmitPrompt}
                  onPress={() => void submitCurrentPrompt()}
                >
                  <Text style={styles.primaryButtonText}>{promptActionLabel}</Text>
                </TouchableOpacity>
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
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => void submitCurrentPrompt()}
                >
                  <Text style={styles.primaryButtonText}>{promptActionLabel}</Text>
                </TouchableOpacity>
              ) : null}
              <TextInput
                style={styles.input}
                placeholder="Paste redirect callback URL"
                placeholderTextColor={COLORS.muted}
                autoCapitalize="none"
                value={manualRedirectUrl}
                onChangeText={setManualRedirectUrl}
              />
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => void handleManualRedirect()}
              >
                <Text style={styles.secondaryButtonText}>Handle Redirect Manually</Text>
              </TouchableOpacity>
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
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => void submitCurrentPrompt()}
                >
                  <Text style={styles.primaryButtonText}>{promptActionLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}

          {v6.state.status === 'loading' ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={COLORS.accent} />
              <Text style={styles.statusLine}>Submitting request...</Text>
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
            <MetaItem label="Step" value={v6.state.step?.id} />
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
            <TouchableOpacity
              style={styles.secondaryTinyButton}
              onPress={() => void changeIdentifier()}
            >
              <Text style={styles.secondaryTinyButtonText}>Change Identifier</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryTinyButton} onPress={() => void resetFlow()}>
              <Text style={styles.secondaryTinyButtonText}>Reset Flow</Text>
            </TouchableOpacity>
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
          <TouchableOpacity style={styles.primaryButton} onPress={() => void runMixedModeScan()}>
            <Text style={styles.primaryButtonText}>Process Scan Result</Text>
          </TouchableOpacity>
          {webStatus ? (
            <Text style={[styles.statusLine, styles.successText]}>{webStatus}</Text>
          ) : null}
          {webError ? <Text style={[styles.statusLine, styles.errorText]}>{webError}</Text> : null}
          <Text style={styles.statusLine}>Legacy web session state: {web.state.status}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Saved User & Device Actions</Text>
          <Text style={styles.statusLine}>
            Current saved user: {preferredUserId ?? 'none loaded from the native SDK'}
          </Text>
          <View style={styles.inlineRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void hydrateSavedUser()}
            >
              <Text style={styles.secondaryButtonText}>Refresh Saved User</Text>
            </TouchableOpacity>
            {preferredUserId && preferredUserId !== identifier.trim() ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setIdentifier(preferredUserId)}
              >
                <Text style={styles.secondaryButtonText}>Use Saved User</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.inlineRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => void signOut()}>
              <Text style={styles.secondaryButtonText}>Sign Out (Keep Trusted Device)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.destructiveButton} onPress={() => void forgetDevice()}>
              <Text style={styles.primaryButtonText}>Forget This Device</Text>
            </TouchableOpacity>
          </View>
          {deviceStatus ? (
            <Text style={[styles.statusLine, styles.successText]}>{deviceStatus}</Text>
          ) : null}
          {deviceError ? (
            <Text style={[styles.statusLine, styles.errorText]}>{deviceError}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Push Approvals (Legacy Harness)</Text>
          <Text style={styles.cardSubtitle}>
            This card intentionally stays V5-style because push approval remains on the legacy
            surface.
          </Text>
          <Text style={styles.statusLine}>
            Android expects an FCM token string. iOS expects a comma-separated list of APNs bytes.
          </Text>
          <TextInput
            style={[styles.input, styles.payloadInput]}
            placeholder={Platform.OS === 'ios' ? 'e.g. 42, 13, 255' : 'FCM token'}
            placeholderTextColor={COLORS.muted}
            multiline
            value={pushTokenInput}
            onChangeText={setPushTokenInput}
          />
          <View style={styles.inlineRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void registerPushToken()}
            >
              <Text style={styles.secondaryButtonText}>Register Token</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void markUserAuthenticated()}
            >
              <Text style={styles.secondaryButtonText}>Notify Authenticated</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.input, styles.payloadInput]}
            placeholder='{"request_id":"...","ip_address":"...","deviceInfo":"...","timestamp":"..."}'
            placeholderTextColor={COLORS.muted}
            multiline
            value={pushPayloadInput}
            onChangeText={setPushPayloadInput}
          />
          <TouchableOpacity style={styles.secondaryButton} onPress={() => void forwardPush()}>
            <Text style={styles.secondaryButtonText}>Send Payload To SDK</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Request ID for approve / decline"
            placeholderTextColor={COLORS.muted}
            value={pushRequestId}
            onChangeText={setPushRequestId}
          />
          <View style={styles.inlineRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, !pushRequestId.trim() && styles.buttonDisabled]}
              disabled={!pushRequestId.trim()}
              onPress={() => void onApprovePush()}
            >
              <Text style={styles.secondaryButtonText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.destructiveButton, !pushRequestId.trim() && styles.buttonDisabled]}
              disabled={!pushRequestId.trim()}
              onPress={() => void onDeclinePush()}
            >
              <Text style={styles.primaryButtonText}>Decline</Text>
            </TouchableOpacity>
          </View>
          {pushStatus ? (
            <Text style={[styles.statusLine, styles.successText]}>{pushStatus}</Text>
          ) : null}
          {pushError ? (
            <Text style={[styles.statusLine, styles.errorText]}>{pushError}</Text>
          ) : null}
          <Text style={styles.sectionTitle}>Recent Push Events</Text>
          {pushEvents.length === 0 ? (
            <Text style={styles.statusLine}>Waiting for events...</Text>
          ) : (
            pushEvents.map((event, index) => (
              <View key={`${event.type}-${index}`} style={styles.eventCard}>
                <Text style={styles.monoInline}>{event.type}</Text>
                {'payload' in event && event.payload ? (
                  <Text style={styles.monoBlock}>{JSON.stringify(event.payload, null, 2)}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Logs</Text>
              <Text style={styles.cardSubtitle}>
                Toggle lightweight in-app logging for auth, redirect, web, and push events.
              </Text>
            </View>
            <View style={styles.inlineSwitch}>
              <Text style={styles.statusLine}>{loggingEnabled ? 'On' : 'Off'}</Text>
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
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
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
    backgroundColor: '#1c2b1b',
  },
  stageBadgePast: {
    borderColor: COLORS.accentMuted,
  },
  stageNumber: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  stageNumberActive: {
    color: COLORS.accentMuted,
  },
  stageTitle: {
    color: COLORS.text,
    fontWeight: '700',
    marginTop: 4,
  },
  stageTitleActive: {
    color: COLORS.accentMuted,
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
