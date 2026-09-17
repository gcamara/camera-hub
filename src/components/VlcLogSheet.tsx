import { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from './ui';
import { clearVlcLog, getVlcLog } from '../../modules/vlc-player';
import { colors, font, spacing } from '@/theme';

interface VlcLogSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
}

/** The player engine's own log, for a stream that will not start on a device without a debugger. */
export function VlcLogSheet({ visible, title, onClose }: VlcLogSheetProps) {
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      setLines(await getVlcLog());
    } catch (error) {
      setLines([`Could not read the log: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }, []);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  const share = useCallback(() => {
    void Share.share({ title: `Camera Hub VLC log — ${title}`, message: [`Camera Hub VLC log — ${title}`, '', ...lines].join('\n') });
  }, [lines, title]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={[styles.sheet, { paddingTop: Math.max(insets.top, spacing.lg), paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.title}>VLC log</Text>
            <Text style={styles.subtitle}>
              {title} · {lines.length} lines
            </Text>
          </View>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
          {lines.length === 0 ? (
            <Text style={styles.line}>Nothing logged yet.</Text>
          ) : (
            lines.map((line, index) => (
              <Text key={index} style={styles.line} selectable>
                {line}
              </Text>
            ))
          )}
        </ScrollView>
        <View style={styles.actions}>
          <Button
            title="Clear"
            variant="secondary"
            onPress={() => {
              clearVlcLog();
              setLines([]);
            }}
            style={styles.flex}
          />
          <Button title="Refresh" variant="secondary" onPress={refresh} style={styles.flex} />
          <Button title="Share" icon="share-outline" onPress={share} style={styles.flex} disabled={lines.length === 0} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md },
  title: { fontSize: font.title, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.small, color: colors.muted },
  body: { paddingVertical: spacing.sm, gap: 2 },
  line: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11, lineHeight: 15, color: colors.muted },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
});
