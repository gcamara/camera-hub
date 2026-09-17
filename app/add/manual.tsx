import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { CameraForm } from '@/components/CameraForm';
import type { CameraInput } from '@/lib/types';
import { useCameraStore } from '@/store/cameraStore';

export default function AddManualScreen() {
  const router = useRouter();
  const addCamera = useCameraStore((state) => state.addCamera);

  const save = useCallback(
    async (input: CameraInput, password: string) => {
      await addCamera(input, password);
      router.dismissTo('/');
    },
    [addCamera, router],
  );

  return <CameraForm submitLabel="Save camera" onSubmit={save} />;
}
