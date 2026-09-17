import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { CameraForm, type CameraPrefill } from '@/components/CameraForm';
import { isBrandId } from '@/lib/brands';
import type { CameraInput } from '@/lib/types';
import { useCameraStore } from '@/store/cameraStore';

export default function AddManualScreen() {
  const router = useRouter();
  const { host, brand } = useLocalSearchParams<{ host?: string; brand?: string }>();
  const addCamera = useCameraStore((state) => state.addCamera);

  const prefill = useMemo<CameraPrefill | undefined>(() => {
    const values: CameraPrefill = {};
    if (host) values.host = host;
    if (isBrandId(brand)) values.brand = brand;
    return Object.keys(values).length > 0 ? values : undefined;
  }, [host, brand]);

  const save = useCallback(
    async (input: CameraInput, password: string) => {
      await addCamera(input, password);
      router.dismissTo('/');
    },
    [addCamera, router],
  );

  return <CameraForm initial={prefill} submitLabel="Save camera" onSubmit={save} />;
}
