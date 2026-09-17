import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CameraTile } from '@/components/CameraTile';
import { Button, IconButton, Muted } from '@/components/ui';
import { useShouldStream } from '@/hooks/useVisibility';
import type { Camera } from '@/lib/types';
import { useCameraStore } from '@/store/cameraStore';
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
  const cameras = useCameraStore((state) => state.cameras);
  const passwords = useCameraStore((state) => state.passwords);
  const settings = useCameraStore((state) => state.settings);
  const updateSettings = useCameraStore((state) => state.updateSettings);
  const removeCamera = useCameraStore((state) => state.removeCamera);
  const streaming = useShouldStream();
  const live = streaming && settings.livePreviews;

  const openCamera = useCallback((camera: Camera) => router.push(`/camera/${camera.id}`), [router]);

  const showActions = useCallback(
    (camera: Camera) => {
      Alert.alert(camera.name, undefined, [
        { text: 'Edit', onPress: () => router.push(`/camera/${camera.id}/edit`) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Delete camera?', `${camera.name} will be removed from this phone.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => void removeCamera(camera.id) },
            ]),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [router, removeCamera],
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
          {cameras.length > 0 ? (
            <IconButton icon="add" label="Add camera" size={26} tint={colors.accentText} background={colors.accent} onPress={() => router.push('/add')} />
          ) : null}
        </View>
      </View>
      {cameras.length > 0 ? (
        <View style={styles.subRow}>
          <Text style={styles.subtitle}>
            {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'}
            {settings.livePreviews ? '' : ' · previews off'}
          </Text>
          <View style={styles.columnToggle} accessibilityRole="radiogroup">
            {([1, 2] as const).map((value) => {
              const selected = settings.columns === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityLabel={value === 1 ? 'One column' : 'Two columns'}
                  accessibilityState={{ selected }}
                  onPress={() => void updateSettings({ columns: value })}
                  style={[styles.columnButton, selected && styles.columnButtonSelected]}
                >
                  <Ionicons name={value === 1 ? 'square-outline' : 'grid-outline'} size={16} color={selected ? colors.text : colors.muted} />
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
            <Ionicons name="videocam-outline" size={26} color="#FFFFFF" />
          </View>
          <Text style={styles.emptyHeroText}>Your first camera goes here</Text>
        </View>
        <View style={styles.emptyCopy}>
          <Text style={styles.emptyTitle}>Every brand, one screen</Text>
          <Text style={styles.emptyBody}>Streams play straight from the cameras over your Wi‑Fi. Nothing goes through a cloud.</Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={[styles.emptyActions, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Button title="Find cameras on my network" icon="search" onPress={() => router.push('/add/discover')} />
          <Button title="Add manually" variant="secondary" icon="create-outline" onPress={() => router.push('/add/manual')} />
        </View>
      </View>
    );
  }

  const large = settings.columns === 1;

  return (
    <View style={styles.screen}>
      {settings.keepAwake && streaming ? <KeepAwakeWhileViewing /> : null}
      <FlatList
        key={settings.columns}
        data={cameras}
        keyExtractor={(camera) => camera.id}
        numColumns={settings.columns}
        ListHeaderComponent={header}
        columnWrapperStyle={settings.columns > 1 ? styles.columns : undefined}
        contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + spacing.xl }]}
        renderItem={({ item }) => (
          <CameraTile
            camera={item}
            password={passwords[item.id] ?? ''}
            live={live}
            large={large}
            onPress={() => openCamera(item)}
            onLongPress={() => showActions(item)}
          />
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            <Muted center>Long-press a camera to edit</Muted>
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
  grid: { gap: spacing.md, paddingHorizontal: spacing.lg },
  columns: { gap: spacing.md },
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
