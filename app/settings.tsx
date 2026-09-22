import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';

import { VlcLogSheet } from '@/components/VlcLogSheet';
import { Button, Card, Muted, SectionLabel, Segmented } from '@/components/ui';
import { columnChoices, effectiveColumns } from '@/lib/layout';
import { isWeb } from '@/lib/platform';
import type { ColumnCount } from '@/lib/types';
import { useCameraStore } from '@/store/cameraStore';
import { useHubStore } from '@/store/hubStore';
import { colors, font, spacing } from '@/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
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
          {/* Only the counts this window can carry; the same range the grid's own toggle offers. */}
          <Segmented
            value={String(effectiveColumns(settings.columns, width))}
            onChange={(value) => void updateSettings({ columns: Number(value) as ColumnCount })}
            options={columnChoices(width).map((value) => ({ value: String(value), label: String(value) }))}
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
            : isWeb
              ? 'A browser plays only what a hub restreams for it. Connect one and its cameras appear on the grid.'
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
          {isWeb
            ? 'Camera Hub in a browser plays the fragmented MP4 a hub restreams for it. It speaks no RTSP and holds no camera passwords, so everything it shows comes from a hub. Away from home, reach the hub over a VPN such as Tailscale or WireGuard.'
            : 'Camera Hub plays RTSP streams straight from your cameras. Nothing leaves your network, and passwords are kept in the iOS keychain. Away from home, connect to your LAN with a VPN such as Tailscale or WireGuard.'}
        </Muted>
        <Muted>Version {Constants.expoConfig?.version ?? '1.0.0'}</Muted>
      </Card>

      {/* There is no libVLC in a browser: the web player is a <video> element, and the log
          sheet would have nothing to show. */}
      {isWeb ? null : (
        <Card>
          <SectionLabel>Diagnostics</SectionLabel>
          <Muted>The player engine's own log. Open it after a stream fails and share it.</Muted>
          <Button title="VLC log" variant="secondary" icon="document-text-outline" onPress={() => setLogOpen(true)} />
        </Card>
      )}
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
