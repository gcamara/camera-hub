import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';

import { readSecret, secretKey, secrets } from '@/lib/secrets';
import { DEFAULT_SETTINGS, type Camera, type CameraInput, type Settings } from '@/lib/types';

const CAMERAS_KEY = 'camerahub.cameras';
const SETTINGS_KEY = 'camerahub.settings';

function passwordKey(id: string): string {
  return secretKey('camerahub.pw.', id);
}

/** A camera as older versions wrote it: everything added since may be missing. */
type StoredCamera = Omit<Camera, 'livePreview'> & Partial<Pick<Camera, 'livePreview'>>;

/**
 * Records saved before per-camera previews existed carry no `livePreview`, and the grid did
 * stream them, so an absent flag has to read as on.
 */
export function restoreCameras(stored: StoredCamera[]): Camera[] {
  return stored.map((camera) => ({ ...camera, livePreview: camera.livePreview ?? true }));
}

async function persistCameras(cameras: Camera[]): Promise<void> {
  await AsyncStorage.setItem(CAMERAS_KEY, JSON.stringify(cameras));
}

interface CameraState {
  hydrated: boolean;
  cameras: Camera[];
  passwords: Record<string, string>;
  settings: Settings;
  hydrate: () => Promise<void>;
  addCamera: (input: CameraInput, password: string) => Promise<Camera>;
  updateCamera: (id: string, patch: Partial<CameraInput>, password?: string) => Promise<void>;
  removeCamera: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

export const useCameraStore = create<CameraState>((set, get) => ({
  hydrated: false,
  cameras: [],
  passwords: {},
  settings: DEFAULT_SETTINGS,

  hydrate: async () => {
    if (get().hydrated) return;
    let cameras: Camera[] = [];
    let settings: Settings = DEFAULT_SETTINGS;
    try {
      const [rawCameras, rawSettings] = await Promise.all([
        AsyncStorage.getItem(CAMERAS_KEY),
        AsyncStorage.getItem(SETTINGS_KEY),
      ]);
      if (rawCameras) cameras = restoreCameras(JSON.parse(rawCameras) as StoredCamera[]);
      if (rawSettings) settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(rawSettings) as Partial<Settings>) };
    } catch {
      cameras = [];
    }
    const passwords: Record<string, string> = {};
    await Promise.all(
      cameras.map(async (camera) => {
        passwords[camera.id] = await readSecret(passwordKey(camera.id));
      }),
    );
    set({ cameras, passwords, settings, hydrated: true });
  },

  addCamera: async (input, password) => {
    const camera: Camera = { ...input, id: Crypto.randomUUID(), createdAt: Date.now() };
    await secrets.set(passwordKey(camera.id), password);
    const cameras = [...get().cameras, camera];
    await persistCameras(cameras);
    set({ cameras, passwords: { ...get().passwords, [camera.id]: password } });
    return camera;
  },

  updateCamera: async (id, patch, password) => {
    const cameras = get().cameras.map((camera) => (camera.id === id ? { ...camera, ...patch } : camera));
    await persistCameras(cameras);
    const passwords = { ...get().passwords };
    if (password !== undefined) {
      await secrets.set(passwordKey(id), password);
      passwords[id] = password;
    }
    set({ cameras, passwords });
  },

  removeCamera: async (id) => {
    const cameras = get().cameras.filter((camera) => camera.id !== id);
    await persistCameras(cameras);
    try {
      await secrets.remove(passwordKey(id));
    } catch {
      // The secret may already be gone; the camera entry is what matters.
    }
    const passwords = { ...get().passwords };
    delete passwords[id];
    set({ cameras, passwords });
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    set({ settings });
  },
}));

export function useCamera(id: string | undefined): { camera: Camera | undefined; password: string } {
  const camera = useCameraStore((state) => state.cameras.find((item) => item.id === id));
  const password = useCameraStore((state) => (id ? (state.passwords[id] ?? '') : ''));
  return { camera, password };
}
