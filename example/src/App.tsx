import React, { useEffect, useMemo, useState } from 'react';
import { Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  initialize,
  useHawcxAuth,
  useHawcxWebLogin,
  addPushListener,
  setPushDeviceToken,
  notifyUserAuthenticated,
  handlePushNotification as forwardPushPayload,
  approvePushRequest,
  declinePushRequest,
  type HawcxInitializeConfig,
  type PushEvent,
} from '@hawcx/react-native-sdk';
import { DEFAULT_HAWCX_CONFIG } from './hawcx.config';

const COLORS = {
  bg: '#0f172a',
  card: '#1e293b',
  accent: '#38bdf8',
  text: '#f8fafc',
  muted: '#94a3b8',
  error: '#f87171',
  success: '#4ade80',
};

const App = () => {
  const activeConfig: HawcxInitializeConfig | null = DEFAULT_HAWCX_CONFIG;
  const [initStatus, setInitStatus] = useState<'idle' | 'initializing' | 'ready' | 'error'>(
    DEFAULT_HAWCX_CONFIG ? 'initializing' : 'error',
  );
  const [initError, setInitError] = useState<string | null>(
    DEFAULT_HAWCX_CONFIG ? null : 'Set credentials in example/src/hawcx.config.ts to continue.',
  );
  const [email, setEmail] = useState('user@example.com');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [token, setToken] = useState('');
  const [pushTokenInput, setPushTokenInput] = useState('');
  const [pushPayloadInput, setPushPayloadInput] = useState('{"request_id":"","ip_address":"","deviceInfo":"","timestamp":""}');
  const [pushRequestId, setPushRequestId] = useState('');
  const [pushEvents, setPushEvents] = useState<PushEvent[]>([]);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  const { state: authState, authenticate, submitOtp } = useHawcxAuth();
  const web = useHawcxWebLogin();

  useEffect(() => {
    if (!activeConfig) {
      return;
    }
    setInitStatus('initializing');
    setInitError(null);
    initialize(activeConfig)
      .then(() => setInitStatus('ready'))
      .catch((err) => {
        console.warn('Init failed', err);
        setInitStatus('error');
        setInitError(err?.message ?? 'Failed to initialize the Hawcx SDK');
      });
  }, [activeConfig]);

  useEffect(() => {
    const subscription = addPushListener((event) => {
      setPushEvents((prev) => [event, ...prev].slice(0, 4));
      setPushStatus(`Received push event: ${event.type}`);
    });
    return () => subscription.remove();
  }, []);

  const isReady = initStatus === 'ready';
  const maskedKey = useMemo(() => {
    if (!activeConfig?.projectApiKey) {
      return '';
    }
    const suffix = activeConfig.projectApiKey.slice(-4);
    return `Active key ••••${suffix}`;
  }, [activeConfig?.projectApiKey]);
  const oauthStatus = activeConfig?.oauthConfig ? 'Configured' : 'Not provided';

  const requireReady = () => {
    if (!isReady) {
      setInitError('Initialize the SDK with your credentials in hawcx.config.ts before calling this action.');
      return false;
    }
    return true;
  };

  const startAuth = () => {
    if (!requireReady()) {
      return;
    }
    authenticate(email);
  };

  const submitOtpCode = () => {
    if (!requireReady()) {
      return;
    }
    submitOtp(otp);
    setOtp('');
  };

  const registerPushToken = async () => {
    if (!requireReady()) {
      return;
    }
    const trimmed = pushTokenInput.trim();
    if (!trimmed) {
      setPushError('Enter a token first (FCM token for Android or byte list for iOS).');
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
          throw new Error('Provide a comma-separated list of APNs byte values for iOS.');
        }
        await setPushDeviceToken(bytes);
      } else {
        await setPushDeviceToken(trimmed);
      }
      setPushStatus('Push token submitted to the Hawcx SDK.');
    } catch (error: unknown) {
      setPushError((error as Error)?.message ?? 'Failed to register token');
    }
  };

  const forwardPush = async () => {
    if (!requireReady()) {
      return;
    }
    setPushError(null);
    try {
      const parsed = JSON.parse(pushPayloadInput);
      await forwardPushPayload(parsed);
      setPushStatus('Forwarded payload to the Hawcx SDK.');
    } catch (error: unknown) {
      setPushError((error as Error)?.message ?? 'Invalid JSON payload');
    }
  };

  const onApprovePush = async () => {
    try {
      await approvePushRequest(pushRequestId.trim());
      setPushStatus('Approved push request');
    } catch (error: unknown) {
      setPushError((error as Error)?.message ?? 'Failed to approve push request');
    }
  };

  const onDeclinePush = async () => {
    try {
      await declinePushRequest(pushRequestId.trim());
      setPushStatus('Declined push request');
    } catch (error: unknown) {
      setPushError((error as Error)?.message ?? 'Failed to decline push request');
    }
  };

  const markUserAuthenticated = async () => {
    try {
      await notifyUserAuthenticated();
      setPushStatus('Notified native SDK to register push token.');
    } catch (error: unknown) {
      setPushError((error as Error)?.message ?? 'Failed to notify Hawcx SDK');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Hawcx React Native SDK</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>SDK Status</Text>
        <Text style={styles.status}>State: {initStatus === 'ready' ? 'Ready' : initStatus}</Text>
        {!!maskedKey && <Text style={styles.status}>{maskedKey}</Text>}
        <Text style={styles.status}>OAuth: {oauthStatus}</Text>
        {!!initError && <Text style={[styles.status, styles.errorText]}>{initError}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>V5 Authentication</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={COLORS.muted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={[styles.button, !isReady && styles.buttonDisabled]}
          onPress={startAuth}
          disabled={!isReady}>
          <Text style={styles.buttonText}>Authenticate</Text>
        </TouchableOpacity>
        {authState.status === 'otp' && (
          <View style={styles.otpRow}>
            <TextInput
              style={[styles.input, styles.otpInput]}
              placeholder="OTP"
              placeholderTextColor={COLORS.muted}
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
            />
            <TouchableOpacity
              style={[styles.button, styles.otpButton, !isReady && styles.buttonDisabled]}
              onPress={submitOtpCode}
              disabled={!isReady}>
              <Text style={styles.buttonText}>Submit</Text>
            </TouchableOpacity>
          </View>
        )}
        <Text style={styles.status}>State: {authState.status}</Text>
        {authState.status === 'error' && (
          <Text style={[styles.status, styles.errorText]}>
            {authState.error.code}: {authState.error.message}
          </Text>
        )}
        {authState.status === 'success' && (
          <Text style={[styles.status, styles.successText]}>Tokens received from Hawcx</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Web Login</Text>
        <TextInput
          style={styles.input}
          placeholder="Web PIN"
          placeholderTextColor={COLORS.muted}
          value={pin}
          onChangeText={setPin}
        />
        <TouchableOpacity
          style={[styles.button, !isReady && styles.buttonDisabled]}
          disabled={!isReady}
          onPress={() => {
            if (requireReady()) {
              web.webLogin(pin);
            }
          }}>
          <Text style={styles.buttonText}>Validate PIN</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Web Token"
          placeholderTextColor={COLORS.muted}
          value={token}
          onChangeText={setToken}
        />
        <TouchableOpacity
          style={[styles.button, !isReady && styles.buttonDisabled]}
          disabled={!isReady}
          onPress={() => {
            if (requireReady()) {
              web.webApprove(token);
            }
          }}>
          <Text style={styles.buttonText}>Approve Token</Text>
        </TouchableOpacity>
        <Text style={styles.status}>Web State: {web.state.status}</Text>
        {web.state.status === 'error' && (
          <Text style={[styles.status, styles.errorText]}>
            {web.state.error.code}: {web.state.error.message}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Push Approvals (Manual Harness)</Text>
        <Text style={styles.status}>
          Token format: Android expects the FCM string. iOS expects a comma-separated list of APNs byte values.
        </Text>
        <TextInput
          style={[styles.input, styles.payloadInput]}
          placeholder={Platform.OS === 'ios' ? 'e.g. 42, 13, 255' : 'FCM token'}
          placeholderTextColor={COLORS.muted}
          value={pushTokenInput}
          onChangeText={setPushTokenInput}
          multiline
        />
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, styles.rowButton]} onPress={registerPushToken} disabled={!isReady}>
            <Text style={styles.buttonText}>Register Token</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.rowButton]} onPress={markUserAuthenticated} disabled={!isReady}>
            <Text style={styles.buttonText}>Notify Authenticated</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={[styles.input, styles.payloadInput]}
          placeholder='Raw push payload JSON (e.g. {"request_id": "..."} )'
          placeholderTextColor={COLORS.muted}
          value={pushPayloadInput}
          onChangeText={setPushPayloadInput}
          multiline
        />
        <TouchableOpacity style={[styles.button, !isReady && styles.buttonDisabled]} onPress={forwardPush} disabled={!isReady}>
          <Text style={styles.buttonText}>Send Payload to SDK</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder="Request ID for approve/decline"
          placeholderTextColor={COLORS.muted}
          value={pushRequestId}
          onChangeText={setPushRequestId}
        />
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.button, styles.successButton, (!isReady || !pushRequestId.trim()) && styles.buttonDisabled]}
            onPress={onApprovePush}
            disabled={!isReady || !pushRequestId.trim()}>
            <Text style={styles.buttonText}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.errorButton, (!isReady || !pushRequestId.trim()) && styles.buttonDisabled]}
            onPress={onDeclinePush}
            disabled={!isReady || !pushRequestId.trim()}>
            <Text style={styles.buttonText}>Decline</Text>
          </TouchableOpacity>
        </View>

        {!!pushStatus && <Text style={[styles.status, styles.successText]}>{pushStatus}</Text>}
        {!!pushError && <Text style={[styles.status, styles.errorText]}>{pushError}</Text>}

        <View>
          <Text style={styles.status}>Recent Push Events</Text>
          {pushEvents.length === 0 && <Text style={styles.status}>Waiting for events…</Text>}
          {pushEvents.map((event, index) => (
            <View key={`${event.type}-${index}`} style={styles.pushEvent}>
              <Text style={styles.monoText}>{event.type}</Text>
              {'payload' in event && event.payload && (
                <Text style={[styles.monoText, styles.payloadText]}>{JSON.stringify(event.payload, null, 2)}</Text>
              )}
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    padding: 16,
    gap: 16,
  },
  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '600',
  },
  card: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#0b1220',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.text,
  },
  button: {
    backgroundColor: COLORS.accent,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  rowButton: {
    flex: 1,
  },
  payloadInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  status: {
    color: COLORS.muted,
  },
  errorText: {
    color: COLORS.error,
  },
  successText: {
    color: COLORS.success,
  },
  successButton: {
    backgroundColor: COLORS.success,
  },
  errorButton: {
    backgroundColor: COLORS.error,
  },
  otpRow: {
    flexDirection: 'row',
    gap: 8,
  },
  otpInput: {
    flex: 1,
  },
  otpButton: {
    flex: 0.6,
  },
  pushEvent: {
    backgroundColor: '#0b1527',
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  monoText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: COLORS.text,
  },
  payloadText: {
    marginTop: 4,
  },
});

export default App;
