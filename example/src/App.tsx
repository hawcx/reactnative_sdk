import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { initialize, useHawcxAuth, useHawcxWebLogin, type HawcxInitializeConfig } from '@hawcx/react-native-sdk';
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
  status: {
    color: COLORS.muted,
  },
  errorText: {
    color: COLORS.error,
  },
  successText: {
    color: COLORS.success,
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
});

export default App;
