import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CameraPlayer } from './CameraPlayer';
import { GlassPill } from './GlassPill';
import { useReconnect } from '@/hooks/useReconnect';
import { getBrand } from '@/lib/brands';
import { hasStream, previewUrl, type PlayableCamera } from '@/lib/playable';
import { colors, radius } from '@/theme';

type Resting = 'unreachable' | 'no-stream' | 'preview-off';

const RESTING_ICON: Record<Resting, ComponentProps<typeof Ionicons>['name']> = {
  unreachable: 'cloud-offline-outline',
  'no-stream': 'desktop-outline',
  'preview-off': 'play-circle-outline',
};

const RESTING_LABEL: Record<Resting, string> = {
  unreachable: 'Hub unreachable',
  'no-stream': 'Not playable here',
  'preview-off': 'Tap to view',
};

const RESTING_HINT: Record<Resting, string> = {
  unreachable: 'This camera is only reachable through the hub.',
  'no-stream': 'The hub restreams this camera over RTSP only, which a browser cannot play.',
  'preview-off': '',
};

interface CameraTileProps {
  camera: PlayableCamera;
  /** Whether this tile should be decoding right now; the caller has already weighed both preview switches. */
  live: boolean;
  /** Single-column tiles get the large name treatment; denser grids a compact one. */
  large: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export function CameraTile({ camera, live, large, onPress, onLongPress }: CameraTileProps) {
  const uri = previewUrl(camera);
  const { status, retryIn, attempt, handleStatus } = useReconnect(live);
  const brandLabel = getBrand(camera.brand).label.split(' /')[0] ?? '';
  const waiting = retryIn !== null;
  const showVideo = live && !waiting;
  const isLive = showVideo && status === 'live';
  // Three reasons a tile will never show video, however long you wait; each owes the person a
  // different sentence. `no-stream` is the browser's: the hub is up and this camera is fine,
  // but the hub restreams it only over RTSP and no browser can play that.
  const resting = camera.unreachable
    ? 'unreachable'
    : !hasStream(camera)
      ? 'no-stream'
      : !camera.livePreview
        ? 'preview-off'
        : null;

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
          {resting ? (
            <>
              <Ionicons
                name={RESTING_ICON[resting]}
                size={large ? 34 : 26}
                color={resting === 'unreachable' ? colors.danger : colors.muted}
              />
              <Text style={[styles.restingText, large ? styles.restingLarge : styles.restingCompact]}>
                {RESTING_LABEL[resting]}
              </Text>
              {large && RESTING_HINT[resting] ? <Text style={styles.restingHint}>{RESTING_HINT[resting]}</Text> : null}
            </>
          ) : (
            <Ionicons
              name={waiting ? 'refresh' : status === 'error' ? 'cloud-offline-outline' : 'videocam-outline'}
              size={large ? 30 : 22}
              color={waiting ? colors.warn : colors.muted}
            />
          )}
        </View>
      ) : null}
      <LinearGradient colors={['rgba(0,0,0,0)', colors.scrim]} style={styles.scrim} pointerEvents="none" />

      {camera.source === 'hub' ? (
        <View style={styles.origin} pointerEvents="none">
          <GlassPill label="HUB" />
        </View>
      ) : null}

      <View style={styles.badge} pointerEvents="none">
        {waiting ? (
          <GlassPill solid={colors.accent} textColor={colors.accentText} label={`RECONNECTING · ${retryIn} s`} />
        ) : camera.unreachable ? (
          <GlassPill dot={colors.danger} label="HUB OFFLINE" />
        ) : resting === 'no-stream' ? (
          <GlassPill label="NO WEB STREAM" />
        ) : !camera.livePreview ? (
          <GlassPill label="PREVIEW OFF" />
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
          {large || resting ? (
            <Text style={styles.meta} numberOfLines={1}>
              {brandLabel} · {camera.origin}
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
  placeholder: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16 },
  restingText: { color: colors.text, fontWeight: '600', textAlign: 'center' },
  restingLarge: { fontSize: 15 },
  restingCompact: { fontSize: 12 },
  restingHint: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  origin: { position: 'absolute', top: 10, left: 10 },
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
