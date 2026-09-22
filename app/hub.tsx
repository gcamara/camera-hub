import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScanNetwork } from '@/components/ScanNetwork';
import { Button, Card, Field, Muted, SectionLabel } from '@/components/ui';
import { confirm } from '@/lib/dialogs';
import { camerasEndpoint, describeHubResult } from '@/lib/hub';
import { isWeb } from '@/lib/platform';
import { useHubStore } from '@/store/hubStore';
import { colors, font, spacing } from '@/theme';

function ConnectForm() {
  const connect = useHubStore((state) => state.connect);
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const result = await connect(address, token);
    setBusy(false);
    if (result.outcome === 'ok') {
      setToken('');
      return;
    }
    setError(describeHubResult(result));
  }, [connect, address, token]);

  return (
    <>
      <Card>
        <SectionLabel>Connect to hub</SectionLabel>
        <Muted>
          {isWeb
            ? "The hub keeps the camera list and restreams every camera. This browser plays what the hub serves it and nothing else, and never learns your cameras' own passwords."
            : "The hub keeps the camera list and restreams every camera, so this phone plays the hub's streams and never learns your cameras' own passwords."}
        </Muted>
        <Field
          label="Hub address"
          value={address}
          onChangeText={setAddress}
          placeholder="hub.tailnet.ts.net:8080"
          keyboardType="url"
          hint={address.trim() === '' ? undefined : camerasEndpoint(address)}
        />
        <Field
          label="Access token"
          value={token}
          onChangeText={setToken}
          secureTextEntry
          textContentType="password"
          placeholder="The token the hub issued"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          title="Connect"
          icon="link-outline"
          loading={busy}
          disabled={address.trim() === '' || token.trim() === ''}
          onPress={submit}
        />
      </Card>
      <Card>
        <SectionLabel>Away from home</SectionLabel>
        <Muted>
          {isWeb
            ? 'The hub is reachable wherever its tailnet is. Every camera here comes through it: without the hub, this browser has nothing of its own to play.'
            : "The hub is reachable wherever its tailnet is. Cameras on this phone stay local either way, and the hub's cameras need the hub: without it, this app has no credentials of its own for them."}
        </Muted>
      </Card>
    </>
  );
}

function ConnectedHub() {
  const baseUrl = useHubStore((state) => state.baseUrl);
  const hub = useHubStore((state) => state.hub);
  const cameras = useHubStore((state) => state.cameras);
  const reachable = useHubStore((state) => state.reachable);
  const failure = useHubStore((state) => state.failure);
  const skipped = useHubStore((state) => state.skipped);
  const sessionFailure = useHubStore((state) => state.sessionFailure);
  const refreshing = useHubStore((state) => state.refreshing);
  const refresh = useHubStore((state) => state.refresh);
  const disconnect = useHubStore((state) => state.disconnect);

  const confirmDisconnect = useCallback(() => {
    confirm(
      {
        title: 'Disconnect from the hub?',
        message: `Its address, token and cached camera list are removed from this ${isWeb ? 'browser' : 'phone'}.`,
        confirmLabel: 'Disconnect',
        destructive: true,
      },
      () => void disconnect(),
    );
  }, [disconnect]);

  return (
    <>
      <Card>
        <SectionLabel>Hub</SectionLabel>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.name}>{hub?.name ?? 'Hub'}</Text>
            <Muted>Version {hub?.version ?? 'unknown'}</Muted>
          </View>
        </View>
        <Muted>{baseUrl}</Muted>
        <Text style={reachable ? styles.ok : styles.error}>
          {reachable
            ? `Serving ${cameras.length} ${cameras.length === 1 ? 'camera' : 'cameras'}.`
            : `Not answering — ${failure ?? 'unknown reason'}. Showing ${cameras.length} cached ${
                cameras.length === 1 ? 'camera' : 'cameras'
              }, none of which can play: this app holds no credentials for them.`}
        </Text>
        {skipped > 0 ? (
          <Muted>
            {skipped} {skipped === 1 ? 'entry' : 'entries'} in the hub's answer had no id or no RTSP stream and were
            left out.
          </Muted>
        ) : null}
        {/* The list above arrived over the bearer token; video in a browser rides a cookie
            instead, and the two fail on their own. Saying so beats silently black tiles. */}
        {sessionFailure ? <Text style={styles.error}>{sessionFailure}</Text> : null}
        <Button title="Refresh now" variant="secondary" icon="refresh" loading={refreshing} onPress={() => void refresh()} />
      </Card>
      <ScanNetwork />
      <Card>
        <SectionLabel>Disconnect</SectionLabel>
        <Muted>
          {isWeb
            ? 'The grid empties: a browser plays nothing but what the hub serves it.'
            : 'Hub cameras disappear from the grid. Cameras saved on this phone are untouched.'}
        </Muted>
        <Button title="Disconnect" variant="danger" icon="unlink-outline" onPress={confirmDisconnect} />
      </Card>
    </>
  );
}

export default function HubScreen() {
  const connected = useHubStore((state) => state.baseUrl !== '');
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {connected ? <ConnectedHub /> : <ConnectForm />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  name: { fontSize: font.heading, fontWeight: '700', color: colors.text },
  ok: { fontSize: font.small, lineHeight: 18, color: colors.muted },
  error: { fontSize: font.small, lineHeight: 18, color: colors.danger },
});
