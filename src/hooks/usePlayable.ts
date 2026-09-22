import { useMemo } from 'react';

import { playableFromCamera, playableFromHub, type PlayableCamera } from '@/lib/playable';
import { useCameraStore } from '@/store/cameraStore';
import { useHubStore } from '@/store/hubStore';

/** Local cameras first, then the hub's, so adding a hub never reorders what was already on the grid. */
export function usePlayableCameras(): PlayableCamera[] {
  const cameras = useCameraStore((state) => state.cameras);
  const passwords = useCameraStore((state) => state.passwords);
  const hub = useHubStore((state) => state.hub);
  const hubCameras = useHubStore((state) => state.cameras);
  const reachable = useHubStore((state) => state.reachable);

  return useMemo(
    () => [
      ...cameras.map((camera) => playableFromCamera(camera, passwords[camera.id] ?? '')),
      ...(hub ? hubCameras.map((camera) => playableFromHub(camera, hub, reachable)) : []),
    ],
    [cameras, passwords, hub, hubCameras, reachable],
  );
}

/** Hub ids are the hub's own strings, so the route param is matched both as written and as escaped. */
export function usePlayableCamera(id: string | undefined): PlayableCamera | undefined {
  const cameras = usePlayableCameras();
  return useMemo(
    () => cameras.find((camera) => camera.id === id || encodeURIComponent(camera.id) === id),
    [cameras, id],
  );
}
