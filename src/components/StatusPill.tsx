import { StyleSheet, Text, View } from 'react-native';

import type { PlayerStatus } from './CameraPlayer';
import { GlassPill } from './GlassPill';
import { colors } from '@/theme';

const LABELS: Record<PlayerStatus, string> = {
  connecting: 'Connecting',
  buffering: 'Buffering',
  live: 'Live',
  error: 'Offline',
  stopped: 'Paused',
};

export function statusColor(status: PlayerStatus): string {
  switch (status) {
    case 'live':
      return colors.live;
    case 'error':
      return colors.danger;
    case 'stopped':
      return colors.muted;
    default:
      return colors.warn;
  }
}

interface StatusPillProps {
  status: PlayerStatus;
  label?: string;
  compact?: boolean;
}

/** Compact = dot + text on a surface; default = frosted pill for use over video. */
export function StatusPill({ status, label, compact = false }: StatusPillProps) {
  const tint = statusColor(status);
  const text = label ?? LABELS[status];
  if (compact) {
    return (
      <View style={styles.compact}>
        <View style={[styles.dot, { backgroundColor: tint }]} />
        <Text style={[styles.compactText, { color: status === 'live' ? colors.muted : tint }]} numberOfLines={1}>
          {text}
        </Text>
      </View>
    );
  }
  if (status === 'buffering' && label) {
    return <GlassPill solid={colors.accent} textColor={colors.accentText} label={text.toUpperCase()} />;
  }
  return <GlassPill dot={tint} label={text.toUpperCase()} style={styles.tall} />;
}

const styles = StyleSheet.create({
  compact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactText: { fontSize: 12, lineHeight: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tall: { height: 36, paddingHorizontal: 14, borderRadius: 18 },
});
