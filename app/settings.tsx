import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { VlcLogSheet } from '@/components/VlcLogSheet';
import { Button, Card, Muted, SectionLabel, Segmented } from '@/components/ui';
import { useCameraStore } from '@/store/cameraStore';
import { useHubStore } from '@/store/hubStore';
import { colors, font, spacing } from '@/theme';

type Columns = '1' | '2' | '3';

export default function SettingsScreen() {
  const router = useRouter();
  const settings = useCameraStore((state) => state.settings);
  const updateSettings = useCameraStore((state) => state.updateSettings);
  const hub = useHubStore((state) => state.hub);
  const connected = useHubStore((state) => state.baseUrl !== '');
  const hubCameras = useHubStore((state) => state.cameras.length);
  const reachable = useHubStore((state) => state.reachable);
  const [logOpen, setLogOpen] = useState(false);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        <SectionLabel>Grid</SectionLabel>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Columns</Text>
          <Segmented<Columns>
            value={String(settings.columns) as Columns}
            onChange={(value) => void updateSettings({ columns: Number(value) as 1 | 2 | 3 })}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
          />
        </View>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.label}>Live previews</Text>
            <Muted>Play every camera's sub stream in the grid. Off saves battery and bandwidth.</Muted>
          </View>
          <Switch
            value={settings.livePreviews}
            onValueChange={(value) => void updateSettings({ livePreviews: value })}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.label}>Keep screen awake on the grid</Text>
            <Muted>The full-screen viewer always keeps the screen on.</Muted>
          </View>
          <Switch
            value={settings.keepAwake}
            onValueChange={(value) => void updateSettings({ keepAwake: value })}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>
      </Card>

      <Card>
        <SectionLabel>Camera hub</SectionLabel>
        <Muted>
          {connected
            ? `${hub?.name ?? 'Hub'} · ${hubCameras} ${hubCameras === 1 ? 'camera' : 'cameras'}${reachable ? '' : ' · not answering'}`
            : 'Pull the camera list from a hub on your network and play the streams it restreams.'}
        </Muted>
        <Button
          title={connected ? 'Manage hub' : 'Connect to hub'}
          variant="secondary"
          icon="server-outline"
          onPress={() => router.push('/hub')}
        />
      </Card>

      <Card>
        <SectionLabel>About</SectionLabel>
        <Muted>
          Camera Hub plays RTSP streams straight from your cameras. Nothing leaves your network, and passwords are kept in the
          iOS keychain. Away from home, connect to your LAN with a VPN such as Tailscale or WireGuard.
        </Muted>
        <Muted>Version {Constants.expoConfig?.version ?? '1.0.0'}</Muted>
      </Card>

      <Card>
        <SectionLabel>Diagnostics</SectionLabel>
        <Muted>The player engine's own log. Open it after a stream fails and share it.</Muted>
        <Button title="VLC log" variant="secondary" icon="document-text-outline" onPress={() => setLogOpen(true)} />
      </Card>
      <VlcLogSheet visible={logOpen} title="Settings" onClose={() => setLogOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  label: { fontSize: font.body, color: colors.text, marginBottom: 2 },
});
