import { useMemo } from 'react';

import { playableFromCamera, playableFromHub, type HubStreamContext, type PlayableCamera } from '@/lib/playable';
import { isWeb } from '@/lib/platform';
import { useCameraStore } from '@/store/cameraStore';
import { useHubStore } from '@/store/hubStore';

/** Local cameras first, then the hub's, so adding a hub never reorders what was already on the grid. */
export function usePlayableCameras(): PlayableCamera[] {
  const cameras = useCameraStore((state) => state.cameras);
  const passwords = useCameraStore((state) => state.passwords);
  const hub = useHubStore((state) => state.hub);
  const hubCameras = useHubStore((state) => state.cameras);
  const baseUrl = useHubStore((state) => state.baseUrl);
  const token = useHubStore((state) => state.token);
  const reachable = useHubStore((state) => state.reachable);
  const previewOff = useHubStore((state) => state.previewOff);

  // The single place the app decides which of a hub camera's two stream URLs this build can
  // play. Everything below reads `mainUrl`/`subUrl` and never asks what platform it is on.
  const context = useMemo<HubStreamContext>(() => ({ baseUrl, web: isWeb, token }), [baseUrl, token]);

  return useMemo(
    () => [
      ...cameras.map((camera) => playableFromCamera(camera, passwords[camera.id] ?? '')),
      ...(hub
        ? hubCameras.map((camera) => playableFromHub(camera, hub, context, reachable, previewOff.includes(camera.id)))
        : []),
    ],
    [cameras, passwords, hub, hubCameras, context, reachable, previewOff],
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
