/* eslint-disable no-void */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  approvalReferenceFromPush,
  approveV6Qr,
  enrolledIdentifiers,
  hawcxV6Client,
  registerPushToken,
  scanApproval,
  toHawcxServiceError,
  unregisterPushToken,
  useHawcxApprover,
  type HawcxV6ApprovalReference,
  type HawcxV6ApprovalResult,
  type HawcxV6DeviceSummary,
  type HawcxServiceError,
} from '@hawcx/react-native-sdk';

/**
 * Approver (the signed-in phone) for approvals v2, with debug inputs so every
 * path runs on a simulator / emulator without APNs or FCM:
 * - paste a push payload (APNs userInfo, FCM `{data: {hawcx}}`, or a bare `{hawcx}`)
 * - paste a QR (v2 opens the approver, v1 asks for confirmation first)
 * - register a fake push token (forced) / unregister
 * - device list / revoke / log out everywhere (the last flow's session token, kept native)
 */

const randomHex = (bytes: number) =>
  Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  ).join('');

const fakeToken = () => (Platform.OS === 'ios' ? randomHex(32) : `fake-fcm:${randomHex(24)}`);

/** Text for every decision result. */
export const describeApprovalResult = (result: HawcxV6ApprovalResult): string => {
  switch (result.outcome) {
    case 'approved':
      return 'Approved. The other device is signing in.';
    case 'denied':
      return 'Denied. The sign-in was refused.';
    case 'wrong_number':
      return 'Wrong number. The request has ended; start again on the other device.';
    case 'resolved':
      switch (result.resolvedOutcome) {
        case 'blocked':
          return 'Sign-in blocked.';
        case 'expired':
          return 'This request has expired.';
        case 'superseded':
          return 'Already handled: a newer request replaced it.';
        default:
          return result.decidedByThisDevice
            ? `Already ${result.resolvedOutcome} on this device.`
            : `Already handled (${result.resolvedOutcome}).`;
      }
  }
  return 'Done.';
};

/** Text for the approver's error codes (server and local). */
export const describeApproverError = (error: HawcxServiceError): string => {
  switch (error.code) {
    case 'device_not_enrolled':
      return 'Not enrolled: sign in on this device first.';
    case 'approval_expired':
      return 'This request has expired.';
    case 'approval_not_found':
      return 'Request not found for the accounts on this device.';
    case 'approval_resolved':
      return `Already handled (${error.outcome ?? 'resolved'}).`;
    case 'project_mismatch':
      return 'This request is for another project.';
    case 'unsupported_approval_version':
      return 'This request needs a newer approver.';
    case 'number_required':
      return 'Type the number shown on the other screen.';
    case 'invalid_number':
      return 'The number has two digits.';
    case 'identifier_required':
      return 'Pick the account to sign in as.';
    case 'account_locked':
      return 'This account is locked.';
    case 'approval_identity_mismatch':
      return 'That account cannot approve this request.';
    case 'approval_outcome_unknown':
      return 'The approval may have succeeded. Check the other device.';
    case 'push_not_registered':
      return 'Nothing to unregister from this install.';
    case 'keychain_unavailable':
      return 'Unlock the device and try again.';
    case 'rate_limited':
      return `Too many requests${error.retryAfterSeconds ? `; retry in ${error.retryAfterSeconds}s` : ''}.`;
    default:
      return `${error.message} (${error.code})`;
  }
};

/** Demo stand-in for a device-owner check (use biometrics / passcode in a real app). */
const confirmDeviceOwner = (title: string) =>
  new Promise<boolean>((resolve) => {
    Alert.alert(title, 'Demo: a real app gates this behind biometrics or the passcode.', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Approve', onPress: () => resolve(true) },
    ]);
  });

type V1Pending = { raw: string; payloadType: 'qr_auth' | 'qr_login' };

export type ApproverScreenProps = {
  /** A scan routed here from elsewhere in the app (`routeWebLoginScan` → `approval_v2`). */
  incomingScan?: { raw: string; nonce: number };
  /** Identifier for v1 QR approvals. */
  defaultIdentifier?: string;
};

export const ApproverScreen = ({ incomingScan, defaultIdentifier }: ApproverScreenProps) => {
  const approver = useHawcxApprover();
  const [pushInput, setPushInput] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [numberInput, setNumberInput] = useState('');
  const [token, setToken] = useState(fakeToken);
  const [status, setStatus] = useState<string | null>(null);
  const [pickFrom, setPickFrom] = useState<{ reference: HawcxV6ApprovalReference; ids: string[] } | null>(null);
  const [v1Pending, setV1Pending] = useState<V1Pending | null>(null);
  const [devices, setDevices] = useState<HawcxV6DeviceSummary[] | null>(null);

  const report = useCallback((error: unknown) => {
    setStatus(describeApproverError(toHawcxServiceError(error)));
  }, []);

  // The handle on screen right now (read after awaits, where `approver` is stale).
  const shownHandle = useRef<string | undefined>(undefined);
  shownHandle.current = approver.request?.handle;

  // A final result: the handle is gone natively, so clear the number and the
  // buttons instead of leaving a request that can no longer be decided.
  const finish = (text: string) => {
    setNumberInput('');
    void approver.reset().catch(() => undefined);
    setStatus(text);
  };

  const open = useCallback(
    async (reference: HawcxV6ApprovalReference) => {
      setStatus(null);
      setNumberInput('');
      setPickFrom(null);
      setV1Pending(null);
      await approver.reset();
      try {
        if (reference.kind === 'qr_login') {
          const ids = await enrolledIdentifiers();
          if (ids.length > 1) {
            setPickFrom({ reference, ids });
            return;
          }
          await approver.fetch(reference, ids[0]);
        } else {
          await approver.fetch(reference);
        }
      } catch (error) {
        report(error);
      }
    },
    [approver, report],
  );

  const handleScan = useCallback(
    async (raw: string) => {
      setStatus(null);
      const scanned = await scanApproval(raw);
      if (!scanned) {
        setStatus('Not a Hawcx approval QR.');
        return;
      }
      if (scanned.version === 2) {
        await open(scanned.reference);
      } else {
        await approver.reset();
        setV1Pending({ raw, payloadType: scanned.payloadType });
      }
    },
    [approver, open],
  );

  useEffect(() => {
    if (incomingScan?.raw) {
      void handleScan(incomingScan.raw);
    }
    // Only a new scan (nonce) re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingScan?.nonce]);

  const openPastedPush = async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(pushInput);
    } catch {
      setStatus('Paste JSON: an APNs payload, an FCM {"data":{"hawcx":"…"}} message or {"hawcx":{…}}.');
      return;
    }
    const reference = await approvalReferenceFromPush(payload as Record<string, unknown>);
    if (!reference) {
      setStatus('Not a live Hawcx v2 push (or it has expired).');
      return;
    }
    await open(reference);
  };

  const approve = async () => {
    const request = approver.request;
    if (!request) return;
    const number = request.numberRequired ? Number.parseInt(numberInput, 10) : undefined;
    if (request.numberRequired && !(number !== undefined && number >= 10 && number <= 99)) {
      setStatus('Type the 2-digit number shown on the other screen.');
      return;
    }
    if (!(await confirmDeviceOwner('Approve sign-in?'))) return;
    // Bound to the request the user confirmed: if a newer push replaced it
    // while the dialog was open, don't decide anything (the hook also refuses).
    if (shownHandle.current !== request.handle) {
      setStatus('The request changed while you were confirming. Review it and confirm again.');
      return;
    }
    try {
      const result = await approver.approve(request.handle, number);
      finish(describeApprovalResult(result));
    } catch (error) {
      report(error);
    }
  };

  const deny = async () => {
    const request = approver.request;
    if (!request) return;
    try {
      const result = await approver.deny(request.handle);
      finish(describeApprovalResult(result));
    } catch (error) {
      report(error);
    }
  };

  const approveV1 = async () => {
    if (!v1Pending) return;
    const identifier = defaultIdentifier?.trim();
    if (!identifier) {
      setStatus('Enter the account (identifier) in the sign-in card first.');
      return;
    }
    if (!(await confirmDeviceOwner('Approve this sign-in? This code cannot show who is asking.'))) {
      return;
    }
    try {
      const result = await approveV6Qr(v1Pending.raw, identifier, { rememberDevice: true });
      setStatus(result.outcome === 'bound' ? 'Approved and bound.' : 'Approved.');
      setV1Pending(null);
    } catch (error) {
      report(error);
    }
  };

  const register = async () => {
    try {
      const input =
        Platform.OS === 'ios'
          ? ({ provider: 'apns', token, apnsEnv: 'development' } as const)
          : ({ provider: 'fcm', token } as const);
      const { registered } = await registerPushToken(input, true);
      setStatus(`Registered for ${registered} identit${registered === 1 ? 'y' : 'ies'}.`);
    } catch (error) {
      report(error);
    }
  };

  const unregister = async () => {
    try {
      await unregisterPushToken();
      setStatus('Push token unregistered.');
    } catch (error) {
      report(error);
    }
  };

  const listDevices = async () => {
    try {
      setDevices(await hawcxV6Client.listDevices(null));
    } catch (error) {
      report(error);
    }
  };

  const revoke = async (deviceId: string) => {
    try {
      await hawcxV6Client.revokeDevice(null, deviceId);
      setStatus('Device revoked.');
      await listDevices();
    } catch (error) {
      report(error);
    }
  };

  const logoutEverywhere = async () => {
    try {
      const { sessionsEnded } = await hawcxV6Client.logoutEverywhere(null);
      setStatus(`Ended ${sessionsEnded} session(s).`);
    } catch (error) {
      report(error);
    }
  };

  const request = approver.request;
  const requester = request?.requester;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Approver (approvals v2)</Text>
      <Text style={styles.subtitle}>
        Approve a sign-in started on another screen. Everything shown comes from the server context,
        never from the push.
      </Text>

      {request ? (
        <View style={styles.review}>
          <Text style={styles.reviewTitle}>
            {request.mode === 'push' ? 'Sign-in request' : 'QR sign-in'} for {request.identifier}
          </Text>
          <Row label="App" value={requester?.appName} />
          <Row label="Website" value={requester?.origin} />
          <Row label="Browser" value={requester?.browser} />
          <Row label="Location" value={requester?.location} />
          <Row label="IP" value={requester?.ip} />
          <Row label="Requested" value={requester?.requestedAt} />
          <Row label="Expires" value={request.expiresAt} />
          {request.locationMismatch ? (
            <Text style={styles.warning}>The requester is in a different country than this phone.</Text>
          ) : null}
          {request.numberRequired ? (
            <TextInput
              testID="approver-number-input"
              style={styles.input}
              placeholder="Number shown on the other screen"
              keyboardType="number-pad"
              maxLength={2}
              value={numberInput}
              onChangeText={setNumberInput}
            />
          ) : null}
          <View style={styles.row}>
            <Button label="Approve" onPress={() => void approve()} disabled={approver.loading} />
            <Button label="Deny" onPress={() => void deny()} disabled={approver.loading} destructive />
          </View>
        </View>
      ) : null}

      {pickFrom ? (
        <View style={styles.review}>
          <Text style={styles.reviewTitle}>Sign in as</Text>
          {pickFrom.ids.map((id) => (
            <Button
              key={id}
              label={id}
              onPress={() => {
                const { reference } = pickFrom;
                setPickFrom(null);
                void approver.fetch(reference, id).catch(report);
              }}
            />
          ))}
        </View>
      ) : null}

      {v1Pending ? (
        <View style={styles.review}>
          <Text style={styles.reviewTitle}>Older QR code ({v1Pending.payloadType})</Text>
          <Text style={styles.warning}>
            This code can't show who is asking. Approve only if you started this sign-in yourself.
          </Text>
          <View style={styles.row}>
            <Button label="Approve" onPress={() => void approveV1()} />
            <Button label="Cancel" onPress={() => setV1Pending(null)} />
          </View>
        </View>
      ) : null}

      {status ? <Text testID="approver-status" style={styles.status}>{status}</Text> : null}

      <Text style={styles.section}>Debug: paste push payload</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        autoCapitalize="none"
        placeholder='{"hawcx":{"v":2,"type":"push_approval","project_id":"…","approval_id":"…"}}'
        value={pushInput}
        onChangeText={setPushInput}
      />
      <Button label="Open approval" onPress={() => void openPastedPush()} disabled={!pushInput.trim()} />

      <Text style={styles.section}>Debug: paste QR text</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        autoCapitalize="none"
        placeholder='{"v":2,"type":"qr_auth","project_id":"…","approval_id":"…"}'
        value={qrInput}
        onChangeText={setQrInput}
      />
      <Button label="Scan pasted QR" onPress={() => void handleScan(qrInput)} disabled={!qrInput.trim()} />

      <Text style={styles.section}>
        Push token ({Platform.OS === 'ios' ? 'APNs, development' : 'FCM'}; fake for simulators)
      </Text>
      <TextInput style={styles.input} autoCapitalize="none" value={token} onChangeText={setToken} />
      <View style={styles.row}>
        <Button label="Register (force)" onPress={() => void register()} />
        <Button label="Unregister" onPress={() => void unregister()} />
        <Button label="New" onPress={() => setToken(fakeToken())} />
      </View>

      <Text style={styles.section}>My devices (needs a sign-in in this app session)</Text>
      <View style={styles.row}>
        <Button label="List devices" onPress={() => void listDevices()} />
        <Button label="Log out everywhere" onPress={() => void logoutEverywhere()} destructive />
      </View>
      {devices?.map((device) => (
        <View key={device.deviceId} style={styles.deviceRow}>
          <Text style={styles.deviceText}>
            {device.deviceId.slice(0, 8)}… {device.revoked ? '(revoked)' : ''} {device.createdAt ?? ''}
          </Text>
          {!device.revoked ? <Button label="Revoke" onPress={() => void revoke(device.deviceId)} /> : null}
        </View>
      ))}
    </View>
  );
};

const Row = ({ label, value }: { label: string; value?: string }) =>
  value ? (
    <Text style={styles.rowText}>
      <Text style={styles.rowLabel}>{label}: </Text>
      {value}
    </Text>
  ) : null;

const Button = ({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) => (
  <TouchableOpacity
    style={[styles.button, destructive && styles.destructive, disabled && styles.disabled]}
    onPress={onPress}
    disabled={disabled}
  >
    <Text style={styles.buttonText}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: { backgroundColor: '#ffffff', borderRadius: 12, padding: 16, marginBottom: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#4b5563' },
  section: { marginTop: 12, fontSize: 13, fontWeight: '600', color: '#111827' },
  review: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, gap: 6 },
  reviewTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  rowText: { fontSize: 13, color: '#111827' },
  rowLabel: { fontWeight: '600' },
  warning: { fontSize: 13, color: '#b45309' },
  status: { fontSize: 14, color: '#1d4ed8' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#111827',
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { backgroundColor: '#1d4ed8', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  destructive: { backgroundColor: '#b91c1c' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deviceText: { fontSize: 12, color: '#374151', flexShrink: 1 },
});
