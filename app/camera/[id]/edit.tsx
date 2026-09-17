import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { CameraForm } from '@/components/CameraForm';
import { Button } from '@/components/ui';
import type { CameraInput } from '@/lib/types';
import { useCamera, useCameraStore } from '@/store/cameraStore';
import { colors, spacing } from '@/theme';

export default function EditCameraScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { camera, password } = useCamera(id);
  const updateCamera = useCameraStore((state) => state.updateCamera);
  const removeCamera = useCameraStore((state) => state.removeCamera);

  const save = useCallback(
    async (input: CameraInput, nextPassword: string) => {
      if (!camera) return;
      await updateCamera(camera.id, input, nextPassword);
      router.back();
    },
    [camera, updateCamera, router],
  );

  const confirmDelete = useCallback(() => {
    if (!camera) return;
    Alert.alert('Delete camera?', `${camera.name} will be removed from this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeCamera(camera.id);
          router.dismissTo('/');
        },
      },
    ]);
  }, [camera, removeCamera, router]);

  if (!camera) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>This camera no longer exists.</Text>
      </View>
    );
  }

  return (
    <CameraForm
      key={camera.id}
      initial={camera}
      initialPassword={password}
      submitLabel="Save changes"
      onSubmit={save}
      footer={<Button title="Delete camera" variant="danger" icon="trash-outline" onPress={confirmDelete} />}
    />
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  missingText: { color: colors.text },
});
