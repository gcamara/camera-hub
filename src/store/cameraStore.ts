import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { DEFAULT_SETTINGS, type Camera, type CameraInput, type Settings } from '@/lib/types';

const CAMERAS_KEY = 'camerahub.cameras';
const SETTINGS_KEY = 'camerahub.settings';

function passwordKey(id: string): string {
  return `camerahub.pw.${id.replace(/[^A-Za-z0-9._-]/g, '')}`;
}

/** The keychain is native only; the browser preview keeps passwords in plain storage and is never a shipping target. */
const secrets = {
  get: (key: string) => (Platform.OS === 'web' ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key)),
  set: (key: string, value: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value)),
  remove: (key: string) => (Platform.OS === 'web' ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key)),
};

async function readPassword(id: string): Promise<string> {
  try {
    return (await secrets.get(passwordKey(id))) ?? '';
  } catch {
    return '';
  }
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
      if (rawCameras) cameras = JSON.parse(rawCameras) as Camera[];
      if (rawSettings) settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(rawSettings) as Partial<Settings>) };
    } catch {
      cameras = [];
    }
    const passwords: Record<string, string> = {};
    await Promise.all(
      cameras.map(async (camera) => {
        passwords[camera.id] = await readPassword(camera.id);
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
