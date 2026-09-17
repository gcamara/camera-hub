import Constants from 'expo-constants';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card, Muted, SectionLabel, Segmented } from '@/components/ui';
import { useCameraStore } from '@/store/cameraStore';
import { colors, font, spacing } from '@/theme';

type Columns = '1' | '2' | '3';

export default function SettingsScreen() {
  const settings = useCameraStore((state) => state.settings);
  const updateSettings = useCameraStore((state) => state.updateSettings);

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
        <SectionLabel>About</SectionLabel>
        <Muted>
          Camera Hub plays RTSP streams straight from your cameras. Nothing leaves your network, and passwords are kept in the
          iOS keychain. Away from home, connect to your LAN with a VPN such as Tailscale or WireGuard.
        </Muted>
        <Muted>Version {Constants.expoConfig?.version ?? '1.0.0'}</Muted>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  label: { fontSize: font.body, color: colors.text, marginBottom: 2 },
});
