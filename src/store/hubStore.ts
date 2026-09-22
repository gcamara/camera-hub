import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { fetchHubCameras, normalizeBaseUrl, type HubCamera, type HubInfo, type HubResult } from '@/lib/hub';
import { readSecret, secrets } from '@/lib/secrets';

const HUB_KEY = 'camerahub.hub';
const TOKEN_KEY = 'camerahub.hub.token';

/** Everything but the token, which belongs in the keychain beside the camera passwords. */
interface StoredHub {
  baseUrl: string;
  hub: HubInfo | null;
  cameras: HubCamera[];
  etag: string | null;
}

interface HubState {
  hydrated: boolean;
  baseUrl: string;
  token: string;
  hub: HubInfo | null;
  /** The list as last served; kept so the grid still has something to show when the hub is down. */
  cameras: HubCamera[];
  etag: string | null;
  /** False once a refresh failed: what is on screen is then the cached list, not the hub's. */
  reachable: boolean;
  /** Why the last refresh failed, in the hub client's own words. */
  failure: string | null;
  /** Entries the last answer carried that this app could not read. */
  skipped: number;
  refreshing: boolean;
  hydrate: () => Promise<void>;
  connect: (baseUrl: string, token: string) => Promise<HubResult>;
  refresh: () => Promise<HubResult | null>;
  disconnect: () => Promise<void>;
}

async function persist(state: StoredHub): Promise<void> {
  await AsyncStorage.setItem(HUB_KEY, JSON.stringify(state));
}

export const useHubStore = create<HubState>((set, get) => ({
  hydrated: false,
  baseUrl: '',
  token: '',
  hub: null,
  cameras: [],
  etag: null,
  reachable: true,
  failure: null,
  skipped: 0,
  refreshing: false,

  hydrate: async () => {
    if (get().hydrated) return;
    let stored: StoredHub | null = null;
    try {
      const raw = await AsyncStorage.getItem(HUB_KEY);
      if (raw) stored = JSON.parse(raw) as StoredHub;
    } catch {
      stored = null;
    }
    const token = stored?.baseUrl ? await readSecret(TOKEN_KEY) : '';
    set({
      hydrated: true,
      baseUrl: stored?.baseUrl ?? '',
      token,
      hub: stored?.hub ?? null,
      cameras: stored?.cameras ?? [],
      etag: stored?.etag ?? null,
      // Optimistic until the first refresh answers: the cached URLs are usually still good,
      // and marking every tile unreachable on launch would be a lie most of the time.
      reachable: true,
      failure: null,
      skipped: 0,
    });
  },

  connect: async (baseUrl, token) => {
    const normalized = normalizeBaseUrl(baseUrl);
    set({ refreshing: true });
    const result = await fetchHubCameras({ baseUrl: normalized, token, etag: null });
    if (result.outcome !== 'ok') {
      set({ refreshing: false });
      return result;
    }
    const { snapshot } = result;
    await secrets.set(TOKEN_KEY, token);
    await persist({ baseUrl: normalized, hub: snapshot.hub, cameras: snapshot.cameras, etag: snapshot.etag });
    set({
      baseUrl: normalized,
      token,
      hub: snapshot.hub,
      cameras: snapshot.cameras,
      etag: snapshot.etag,
      reachable: true,
      failure: null,
      skipped: snapshot.skipped,
      refreshing: false,
    });
    return result;
  },

  refresh: async () => {
    const { baseUrl, token, etag, refreshing } = get();
    if (baseUrl === '' || refreshing) return null;
    set({ refreshing: true });
    const result = await fetchHubCameras({ baseUrl, token, etag });
    if (result.outcome === 'ok') {
      const { snapshot } = result;
      await persist({ baseUrl, hub: snapshot.hub, cameras: snapshot.cameras, etag: snapshot.etag });
      set({
        hub: snapshot.hub,
        cameras: snapshot.cameras,
        etag: snapshot.etag,
        reachable: true,
        failure: null,
        skipped: snapshot.skipped,
        refreshing: false,
      });
      return result;
    }
    if (result.outcome === 'unchanged') {
      set({ reachable: true, failure: null, refreshing: false });
      return result;
    }
    // The cached list stays exactly as it is; only its standing changes.
    set({
      reachable: false,
      failure: result.outcome === 'unauthorized' ? 'the hub rejected the token' : result.detail,
      refreshing: false,
    });
    return result;
  },

  disconnect: async () => {
    await AsyncStorage.removeItem(HUB_KEY);
    try {
      await secrets.remove(TOKEN_KEY);
    } catch {
      // The token may already be gone; clearing the hub entry is what matters.
    }
    set({
      baseUrl: '',
      token: '',
      hub: null,
      cameras: [],
      etag: null,
      reachable: true,
      failure: null,
      skipped: 0,
      refreshing: false,
    });
  },
}));
