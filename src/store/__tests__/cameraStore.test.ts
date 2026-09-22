import AsyncStorage from '@react-native-async-storage/async-storage';

import { restoreCameras, useCameraStore } from '../cameraStore';
import type { Camera } from '@/lib/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

/** A record as it was written before `livePreview` existed. */
const legacy: Omit<Camera, 'livePreview'> = {
  id: 'legacy-1',
  name: 'Front door',
  brand: 'reolink',
  host: '192.168.1.20',
  rtspPort: 554,
  username: 'viewer',
  channel: 1,
  mainPath: '/h264Preview_01_main',
  subPath: '/h264Preview_01_sub',
  createdAt: 1,
};

describe('restoreCameras', () => {
  it('reads a missing livePreview as on, because the grid used to stream every camera', () => {
    expect(restoreCameras([legacy])[0]?.livePreview).toBe(true);
  });

  it('keeps a flag that was stored', () => {
    expect(restoreCameras([{ ...legacy, livePreview: false }])[0]?.livePreview).toBe(false);
    expect(restoreCameras([{ ...legacy, livePreview: true }])[0]?.livePreview).toBe(true);
  });
});

describe('hydrate', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useCameraStore.setState({ hydrated: false, cameras: [], passwords: {} });
  });

  it('migrates records saved before per-camera previews existed', async () => {
    await AsyncStorage.setItem('camerahub.cameras', JSON.stringify([legacy, { ...legacy, id: 'legacy-2', livePreview: false }]));

    await useCameraStore.getState().hydrate();

    const cameras = useCameraStore.getState().cameras as Camera[];
    expect(cameras.map((camera) => camera.livePreview)).toEqual([true, false]);
  });

  it('survives a camera list that is not readable', async () => {
    await AsyncStorage.setItem('camerahub.cameras', '{not json');

    await useCameraStore.getState().hydrate();

    expect(useCameraStore.getState().cameras).toEqual([]);
    expect(useCameraStore.getState().hydrated).toBe(true);
  });
});
