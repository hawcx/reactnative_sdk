import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  initialize,
  hawcxClient,
  useHawcxAuth,
  useHawcxWebLogin,
  useHawcxAuth as useAuthHook,
} from '@hawcx/react-native-sdk';

const COLORS = {
  bg: '#0f172a',
  card: '#1e293b',
  accent: '#38bdf8',
  text: '#f8fafc',
  muted: '#94a3b8',
};

const App = () => {
  const [apiKey, setApiKey] = useState('YOUR_PROJECT_KEY');
  const [email, setEmail] = useState('user@example.com');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [token, setToken] = useState('');

  const { state: authState, authenticate, submitOtp } = useHawcxAuth();
  const web = useHawcxWebLogin();

  useEffect(() => {
    initialize({ projectApiKey: apiKey }).catch((err) => console.warn('Init failed', err));
  }, [apiKey]);

  const startAuth = () => {
    authenticate(email);
  };

  const submitOtpCode = () => {
    submitOtp(otp);
    setOtp('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Hawcx React Native SDK</Text>

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
        <TouchableOpacity style={styles.button} onPress={startAuth}>
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
            <TouchableOpacity style={[styles.button, styles.otpButton]} onPress={submitOtpCode}>
              <Text style={styles.buttonText}>Submit</Text>
            </TouchableOpacity>
          </View>
        )}
        <Text style={styles.status}>State: {authState.status}</Text>
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
        <TouchableOpacity style={styles.button} onPress={() => web.webLogin(pin)}>
          <Text style={styles.buttonText}>Validate PIN</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Web Token"
          placeholderTextColor={COLORS.muted}
          value={token}
          onChangeText={setToken}
        />
        <TouchableOpacity style={styles.button} onPress={() => web.webApprove(token)}>
          <Text style={styles.buttonText}>Approve Token</Text>
        </TouchableOpacity>
        <Text style={styles.status}>Web State: {web.state.status}</Text>
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
  buttonText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  status: {
    color: COLORS.muted,
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
