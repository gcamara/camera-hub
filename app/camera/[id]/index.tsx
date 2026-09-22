import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Device from 'expo-device';
import { useKeepAwake } from 'expo-keep-awake';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CameraPlayer } from '@/components/CameraPlayer';
import { StatusPill } from '@/components/StatusPill';
import { VlcLogSheet } from '@/components/VlcLogSheet';
import { IconButton, Segmented } from '@/components/ui';
import { usePlayableCamera } from '@/hooks/usePlayable';
import { useReconnect } from '@/hooks/useReconnect';
import { useShouldStream } from '@/hooks/useVisibility';
import { getBrand } from '@/lib/brands';
import type { StreamKind } from '@/lib/types';
import { colors, font, spacing } from '@/theme';

const OVERLAY_HIDE_MS = 4000;

export default function ViewerScreen() {
  useKeepAwake();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const camera = usePlayableCamera(id);
  const streaming = useShouldStream();
  // A hub camera the hub cannot serve has no address the app could dial on its own.
  const reconnect = useReconnect(streaming && camera !== undefined && !camera.unreachable);

  // Emulators decode in software and fall seconds behind a 1080p main stream; the
  // picture freezes on its first frame. Real devices start on the main stream.
  const [kind, setKind] = useState<StreamKind>(Device.isDevice || !camera || camera.subUrl === '' ? 'main' : 'sub');
  const [muted, setMuted] = useState(true);
  const [overlay, setOverlay] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.unlockAsync().catch(() => undefined);
      return () => {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
      };
    }, []),
  );

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOverlay(false), OVERLAY_HIDE_MS);
  }, []);

  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);

  const toggleOverlay = useCallback(() => {
    setOverlay((visible) => {
      if (!visible) scheduleHide();
      return !visible;
    });
  }, [scheduleHide]);

  const touch = useCallback(() => {
    setOverlay(true);
    scheduleHide();
  }, [scheduleHide]);

  if (!camera) {
    return (
      <View style={styles.screen}>
        <StatusBar hidden />
        <View style={[styles.missing, { paddingTop: insets.top + spacing.lg }]}>
          <Text style={styles.missingText}>This camera no longer exists.</Text>
          <IconButton icon="close" label="Close" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const uri = kind === 'sub' && camera.subUrl !== '' ? camera.subUrl : camera.mainUrl;
  const brand = getBrand(camera.brand);
  const waiting = reconnect.retryIn !== null;
  const status = camera.unreachable ? 'error' : waiting ? 'buffering' : reconnect.status;
  const statusLabel = camera.unreachable ? 'Hub unreachable' : waiting ? `Reconnecting in ${reconnect.retryIn} s` : undefined;

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <Pressable style={StyleSheet.absoluteFill} onPress={toggleOverlay} accessibilityLabel="Toggle controls">
        {streaming && !waiting && !camera.unreachable ? (
          <CameraPlayer
            key={`${uri}#${reconnect.attempt}`}
            uri={uri}
            muted={muted}
            contentFit="contain"
            onStatus={reconnect.handleStatus}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {status !== 'live' ? (
          <View style={styles.center} pointerEvents="none">
            <Ionicons
              name={status === 'error' ? 'cloud-offline-outline' : 'videocam-outline'}
              size={48}
              color={status === 'error' ? colors.danger : colors.muted}
            />
            {camera.unreachable ? (
              <Text style={styles.detail}>
                {camera.origin} is not answering. This camera streams through the hub, and the app holds no credentials to
                reach it any other way.
              </Text>
            ) : reconnect.detail ? (
              <Text style={styles.detail}>{reconnect.detail}</Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {overlay ? (
        <>
          <View
            style={[styles.bar, styles.topBar, { paddingTop: insets.top + spacing.sm, paddingLeft: Math.max(insets.left, spacing.lg), paddingRight: Math.max(insets.right, spacing.lg) }]}
            onTouchStart={touch}
          >
            <View style={styles.barGroup}>
              <IconButton icon="chevron-back" label="Back to cameras" background={colors.overlay} tint="#FFFFFF" size={24} style={styles.glass} onPress={() => router.back()} />
              <BlurView intensity={40} tint="dark" style={[styles.glass, styles.namePill]}>
                <Text style={styles.name}>{camera.name}</Text>
                <Text style={styles.meta}>
                  {brand.label.split(' /')[0]} · {camera.origin}
                </Text>
              </BlurView>
            </View>
            <StatusPill status={status} label={statusLabel} />
          </View>

          <View
            style={[styles.bar, styles.bottomBar, { paddingBottom: insets.bottom + spacing.md, paddingLeft: Math.max(insets.left, spacing.lg), paddingRight: Math.max(insets.right, spacing.lg) }]}
            onTouchStart={touch}
          >
            {camera.subUrl !== '' ? (
              <Segmented
                light
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'main', label: 'Main' },
                  { value: 'sub', label: 'Sub' },
                ]}
              />
            ) : (
              <View />
            )}
            <View style={styles.barGroup}>
              <IconButton
                icon={muted ? 'volume-mute' : 'volume-high'}
                label={muted ? 'Unmute' : 'Mute'}
                background={colors.overlay}
                tint="#FFFFFF"
                style={styles.glass}
                onPress={() => setMuted((m) => !m)}
              />
              <IconButton icon="refresh" label="Reconnect" background={colors.overlay} tint="#FFFFFF" style={styles.glass} onPress={reconnect.retryNow} />
              <IconButton icon="document-text-outline" label="VLC log" background={colors.overlay} tint="#FFFFFF" style={styles.glass} onPress={() => setLogOpen(true)} />
              {camera.source === 'local' ? (
                <IconButton
                  icon="settings-outline"
                  label="Edit camera"
                  background={colors.overlay}
                  tint="#FFFFFF"
                  style={styles.glass}
                  onPress={() => router.push(`/camera/${camera.id}/edit`)}
                />
              ) : null}
            </View>
          </View>
        </>
      ) : null}
      <VlcLogSheet visible={logOpen} title={camera.name} onClose={() => setLogOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  detail: { color: colors.text, fontSize: font.body, textAlign: 'center' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  topBar: { top: 0 },
  bottomBar: { bottom: 0 },
  barGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  glass: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassBorder },
  namePill: { height: 44, paddingHorizontal: spacing.lg, borderRadius: 22, justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.overlay },
  name: { fontSize: 16, lineHeight: 20, fontWeight: '700', color: '#FFFFFF' },
  meta: { fontSize: 12, lineHeight: 15, color: 'rgba(255,255,255,0.8)' },
  missing: { flex: 1, alignItems: 'center', gap: spacing.lg, padding: spacing.xl },
  missingText: { color: colors.text, fontSize: font.body },
});
