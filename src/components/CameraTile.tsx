import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CameraPlayer } from './CameraPlayer';
import { GlassPill } from './GlassPill';
import { useReconnect } from '@/hooks/useReconnect';
import { getBrand } from '@/lib/brands';
import { buildStreamUrl } from '@/lib/rtsp';
import type { Camera } from '@/lib/types';
import { colors, radius } from '@/theme';

interface CameraTileProps {
  camera: Camera;
  password: string;
  live: boolean;
  /** Single-column tiles get the large name treatment; denser grids a compact one. */
  large: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export function CameraTile({ camera, password, live, large, onPress, onLongPress }: CameraTileProps) {
  const uri = buildStreamUrl(camera, password, 'sub');
  const { status, retryIn, attempt, handleStatus } = useReconnect(live);
  const brandLabel = getBrand(camera.brand).label.split(' /')[0] ?? '';
  const waiting = retryIn !== null;
  const showVideo = live && !waiting;
  const isLive = showVideo && status === 'live';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${camera.name}`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
    >
      {showVideo ? (
        <CameraPlayer key={`${uri}#${attempt}`} uri={uri} muted contentFit="cover" onStatus={handleStatus} style={StyleSheet.absoluteFill} />
      ) : null}
      {!isLive ? (
        <View style={styles.placeholder} pointerEvents="none">
          <Ionicons
            name={waiting ? 'refresh' : status === 'error' ? 'cloud-offline-outline' : 'videocam-outline'}
            size={large ? 30 : 22}
            color={waiting ? colors.warn : colors.muted}
          />
        </View>
      ) : null}
      <LinearGradient colors={['rgba(0,0,0,0)', colors.scrim]} style={styles.scrim} pointerEvents="none" />

      <View style={styles.badge} pointerEvents="none">
        {waiting ? (
          <GlassPill solid={colors.accent} textColor={colors.accentText} label={`RECONNECTING · ${retryIn} s`} />
        ) : isLive ? (
          <GlassPill dot={colors.live} label="LIVE" />
        ) : !live ? (
          <GlassPill label="PAUSED" />
        ) : status === 'error' ? (
          <GlassPill dot={colors.danger} label="OFFLINE" />
        ) : (
          <GlassPill dot={colors.warn} label="CONNECTING" />
        )}
      </View>

      <View style={[styles.caption, large ? styles.captionLarge : styles.captionCompact]} pointerEvents="none">
        <View style={styles.captionText}>
          <Text style={[styles.name, large ? styles.nameLarge : styles.nameCompact]} numberOfLines={1}>
            {camera.name}
          </Text>
          {large ? (
            <Text style={styles.meta} numberOfLines={1}>
              {brandLabel} · {camera.host}
            </Text>
          ) : null}
        </View>
        {large ? (
          <View style={styles.expand}>
            <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, aspectRatio: 16 / 9, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  placeholder: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  badge: { position: 'absolute', top: 10, right: 10 },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  captionLarge: { paddingHorizontal: 16, paddingBottom: 14 },
  captionCompact: { paddingHorizontal: 10, paddingBottom: 8 },
  captionText: { flex: 1, gap: 2 },
  name: { color: '#FFFFFF', fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  nameLarge: { fontSize: 22, letterSpacing: -0.3 },
  nameCompact: { fontSize: 14 },
  meta: { fontSize: 13, color: 'rgba(255,255,255,0.82)' },
  expand: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
