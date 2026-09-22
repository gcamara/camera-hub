import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CameraTile } from '@/components/CameraTile';
import { Button, IconButton, Muted } from '@/components/ui';
import { useHubRefresh } from '@/hooks/useHubRefresh';
import { usePlayableCameras } from '@/hooks/usePlayable';
import { useShouldStream } from '@/hooks/useVisibility';
import { getBrand } from '@/lib/brands';
import { confirm, notify } from '@/lib/dialogs';
import { columnChoices, effectiveColumns, fillLastRow } from '@/lib/layout';
import { hubCameraId, shouldPreview, type PlayableCamera } from '@/lib/playable';
import { isWeb } from '@/lib/platform';
import type { ColumnCount } from '@/lib/types';
import { useCameraStore } from '@/store/cameraStore';
import { useHubStore } from '@/store/hubStore';
import { colors, font, radius, spacing } from '@/theme';

function KeepAwakeWhileViewing() {
  useKeepAwake();
  return null;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function CamerasScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const settings = useCameraStore((state) => state.settings);
  const updateSettings = useCameraStore((state) => state.updateSettings);
  const removeCamera = useCameraStore((state) => state.removeCamera);
  const setPreviewOff = useHubStore((state) => state.setPreviewOff);
  const cameras = usePlayableCameras();
  const streaming = useShouldStream();
  const live = streaming && settings.livePreviews;
  useHubRefresh();

  const hubCount = cameras.filter((camera) => camera.source === 'hub').length;
  const hubDown = cameras.some((camera) => camera.unreachable);
  const choices = columnChoices(width);
  const columns = effectiveColumns(settings.columns, width);
  const cells = useMemo(() => fillLastRow(cameras, columns), [cameras, columns]);

  const openCamera = useCallback(
    (camera: PlayableCamera) => router.push(`/camera/${encodeURIComponent(camera.id)}`),
    [router],
  );

  /** A hub camera is the hub's to change, so its long-press explains where it came from instead. */
  const showActions = useCallback(
    (camera: PlayableCamera) => {
      const brandLabel = getBrand(camera.brand).label.split(' /')[0] ?? '';
      if (camera.source === 'hub') {
        const lines = [
          `${brandLabel} · served by ${camera.origin}`,
          'This camera is managed by the hub. Add, rename or remove it there.',
        ];
        if (camera.previewVetoed) {
          lines.push('The hub keeps this camera out of the grid, so it only plays full screen.');
        }
        if (camera.unreachable) {
          lines.push(
            'The hub is not answering, so this is its cached entry. The app has no credentials of its own for this camera and cannot reach it without the hub.',
          );
        }
        const hubId = hubCameraId(camera.id);
        // Only offered when the hub allows a preview at all; this phone may turn one off, never on.
        if (camera.previewVetoed) {
          notify(camera.name, lines.join('\n\n'));
          return;
        }
        confirm(
          {
            title: camera.name,
            message: lines.join('\n\n'),
            confirmLabel: camera.livePreview ? 'Turn preview off here' : 'Turn preview on here',
          },
          () => void setPreviewOff(hubId, camera.livePreview),
        );
        return;
      }
      Alert.alert(camera.name, undefined, [
        { text: 'Edit', onPress: () => router.push(`/camera/${camera.id}/edit`) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            confirm(
              {
                title: 'Delete camera?',
                message: `${camera.name} will be removed from this phone.`,
                confirmLabel: 'Delete',
                destructive: true,
              },
              () => void removeCamera(camera.id),
            ),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [router, removeCamera, setPreviewOff],
  );

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>{cameras.length === 0 ? 'Welcome' : greeting()}</Text>
          <Text style={styles.title}>Cameras</Text>
        </View>
        <View style={styles.headerActions}>
          <IconButton icon="settings-outline" label="Settings" size={20} onPress={() => router.push('/settings')} style={styles.outlined} />
          {/* A browser has no camera of its own to add: it holds no credentials and cannot
              speak RTSP, so everything it can play comes from the hub. */}
          {isWeb ? (
            <IconButton icon="server-outline" label="Camera hub" size={22} tint={colors.accentText} background={colors.accent} onPress={() => router.push('/hub')} />
          ) : cameras.length > 0 ? (
            <IconButton icon="add" label="Add camera" size={26} tint={colors.accentText} background={colors.accent} onPress={() => router.push('/add')} />
          ) : null}
        </View>
      </View>
      {cameras.length > 0 ? (
        <View style={styles.subRow}>
          <Text style={styles.subtitle}>
            {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'}
            {hubCount > 0 ? ` · ${hubCount} from the hub` : ''}
            {hubDown ? ' · hub unreachable' : ''}
            {settings.livePreviews ? '' : ' · previews off'}
          </Text>
          {/* The counts on offer follow the window, so a desktop browser gets the 3 and 4 a
              phone has no room for, and the selected pill is what is actually on screen. */}
          <View style={styles.columnToggle} accessibilityRole="radiogroup">
            {choices.map((value) => {
              const selected = columns === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityLabel={`${value} ${value === 1 ? 'column' : 'columns'}`}
                  accessibilityState={{ selected }}
                  onPress={() => void updateSettings({ columns: value as ColumnCount })}
                  style={[styles.columnButton, selected && styles.columnButtonSelected]}
                >
                  <Text style={[styles.columnButtonText, selected && styles.columnButtonTextSelected]}>{value}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );

  if (cameras.length === 0) {
    return (
      <View style={styles.screen}>
        <View style={{ paddingHorizontal: spacing.lg }}>{header}</View>
        <View style={styles.emptyHero}>
          <View style={styles.emptyHeroIcon}>
            <Ionicons name={isWeb ? 'server-outline' : 'videocam-outline'} size={26} color="#FFFFFF" />
          </View>
          <Text style={styles.emptyHeroText}>{isWeb ? "Your hub's cameras go here" : 'Your first camera goes here'}</Text>
        </View>
        <View style={styles.emptyCopy}>
          <Text style={styles.emptyTitle}>{isWeb ? 'Whatever the hub serves' : 'Every brand, one screen'}</Text>
          <Text style={styles.emptyBody}>
            {isWeb
              ? 'This browser plays the streams a hub restreams for it, and nothing else: it holds no camera credentials and cannot speak RTSP. Connect the hub with its address and the token it issued, and its cameras appear here.'
              : 'Streams play straight from the cameras over your Wi‑Fi. Nothing goes through a cloud.'}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={[styles.emptyActions, { paddingBottom: insets.bottom + spacing.xl }]}>
          {isWeb ? (
            <Button title="Connect a hub" icon="server-outline" onPress={() => router.push('/hub')} />
          ) : (
            <>
              <Button title="Find cameras on my network" icon="search" onPress={() => router.push('/add/discover')} />
              <Button title="Add manually" variant="secondary" icon="create-outline" onPress={() => router.push('/add/manual')} />
            </>
          )}
        </View>
      </View>
    );
  }

  const large = columns === 1;

  return (
    <View style={styles.screen}>
      {settings.keepAwake && streaming ? <KeepAwakeWhileViewing /> : null}
      <FlatList
        key={columns}
        data={cells}
        keyExtractor={(camera, index) => camera?.id ?? `spacer-${index}`}
        numColumns={columns}
        ListHeaderComponent={header}
        columnWrapperStyle={columns > 1 ? styles.columns : undefined}
        contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + spacing.xl }]}
        renderItem={({ item }) =>
          item ? (
            <CameraTile
              camera={item}
              live={shouldPreview(item, live)}
              large={large}
              onPress={() => openCamera(item)}
              onLongPress={() => showActions(item)}
            />
          ) : (
            <View style={styles.spacer} />
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Muted center>
              {isWeb
                ? 'Cameras here are the hub’s. Add, rename or remove them there.'
                : hubCount > 0
                  ? 'Long-press for options · hub cameras are managed by the hub'
                  : 'Long-press a camera to edit'}
            </Muted>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingBottom: spacing.md, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  headerActions: { flexDirection: 'row', gap: spacing.sm, paddingBottom: 2 },
  outlined: { borderWidth: 1, borderColor: colors.border },
  greeting: { fontSize: font.body, color: colors.muted },
  title: { fontSize: 34, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6, color: colors.text },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  subtitle: { fontSize: font.small, color: colors.muted },
  columnToggle: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  columnButton: { width: 32, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  columnButtonSelected: { backgroundColor: colors.border },
  columnButtonText: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  columnButtonTextSelected: { color: colors.text },
  grid: { gap: spacing.md, paddingHorizontal: spacing.lg },
  columns: { gap: spacing.md },
  spacer: { flex: 1 },
  footer: { paddingTop: spacing.xl },
  emptyHero: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  emptyHeroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHeroText: { fontSize: font.heading, fontWeight: '700', color: '#FFFFFF' },
  emptyCopy: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontSize: font.title, fontWeight: '700', letterSpacing: -0.3, color: colors.text },
  emptyBody: { fontSize: font.body, lineHeight: 21, color: colors.muted },
  emptyActions: { paddingHorizontal: spacing.lg, gap: spacing.md },
});
