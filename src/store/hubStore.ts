import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  describeSessionResult,
  fetchHubCameras,
  needsHubSession,
  normalizeBaseUrl,
  openHubSession,
  type HubCamera,
  type HubInfo,
  type HubResult,
  type SessionResult,
} from '@/lib/hub';
import { isWeb } from '@/lib/platform';
import { readSecret, secrets } from '@/lib/secrets';

const HUB_KEY = 'camerahub.hub';
const TOKEN_KEY = 'camerahub.hub.token';

/** Everything but the token, which belongs in the keychain beside the camera passwords. */
interface StoredHub {
  baseUrl: string;
  hub: HubInfo | null;
  cameras: HubCamera[];
  etag: string | null;
  /** Hub camera ids this phone keeps out of its own grid; see `setPreviewOff`. */
  previewOff: string[];
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
  /** Hub camera ids this phone keeps out of its grid, whatever the hub says. */
  previewOff: string[];
  /**
   * Why this browser has no stream cookie, in one sentence, or null when it has one or does
   * not need one. Kept apart from `failure` because the camera list and the streams
   * authenticate differently on web and fail independently.
   */
  sessionFailure: string | null;
  refreshing: boolean;
  hydrate: () => Promise<void>;
  connect: (baseUrl: string, token: string) => Promise<HubResult>;
  refresh: () => Promise<HubResult | null>;
  /**
   * Trades the stored token for the hub's httpOnly stream cookie. Returns null on a phone,
   * which authenticates every request with the bearer header and needs no cookie at all.
   */
  openSession: () => Promise<SessionResult | null>;
  /**
   * This phone's own preview choice for one hub camera. It can only subtract: a camera
   * the hub keeps off stays off, because only the hub knows a camera cannot take a
   * second viewer. Turning one off here is a preference and never leaves the phone.
   */
  setPreviewOff: (hubCameraId: string, off: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
}

/** The stream-cookie request in flight, shared by everyone who asks while it is. */
let pendingSession: Promise<SessionResult | null> | null = null;

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
  previewOff: [],
  sessionFailure: null,
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
      previewOff: stored?.previewOff ?? [],
      // Optimistic until the first refresh answers: the cached URLs are usually still good,
      // and marking every tile unreachable on launch would be a lie most of the time.
      reachable: true,
      failure: null,
      skipped: 0,
      sessionFailure: null,
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
    // Overrides are keyed by the hub's own camera ids, so they mean nothing on a different hub.
    const previewOff = normalized === get().baseUrl ? get().previewOff : [];
    await secrets.set(TOKEN_KEY, token);
    await persist({ baseUrl: normalized, hub: snapshot.hub, cameras: snapshot.cameras, etag: snapshot.etag, previewOff });
    set({
      baseUrl: normalized,
      token,
      hub: snapshot.hub,
      cameras: snapshot.cameras,
      etag: snapshot.etag,
      previewOff,
      reachable: true,
      failure: null,
      skipped: snapshot.skipped,
      sessionFailure: null,
      refreshing: false,
    });
    // The token is good and stored; a browser now needs it as a cookie before the first tile
    // asks for video. Its outcome lands in `sessionFailure` and never fails the connection:
    // the camera list is already in hand and is worth showing either way.
    await get().openSession();
    return result;
  },

  openSession: () => {
    // `connect` asks for a cookie and, in the same tick, flipping `connected` makes the grid's
    // refresh hook ask again; without this the hub would mint two sessions for one browser.
    if (pendingSession) return pendingSession;
    const { baseUrl, token } = get();
    if (!needsHubSession(isWeb, baseUrl, token)) return Promise.resolve(null);
    pendingSession = openHubSession({ baseUrl, token })
      .then((result) => {
        set({ sessionFailure: describeSessionResult(result) });
        return result;
      })
      .finally(() => {
        pendingSession = null;
      });
    return pendingSession;
  },

  refresh: async () => {
    const { baseUrl, token, etag, refreshing } = get();
    if (baseUrl === '' || refreshing) return null;
    set({ refreshing: true });
    const result = await fetchHubCameras({ baseUrl, token, etag });
    if (result.outcome === 'ok') {
      const { snapshot } = result;
      await persist({
        baseUrl,
        hub: snapshot.hub,
        cameras: snapshot.cameras,
        etag: snapshot.etag,
        previewOff: get().previewOff,
      });
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

  setPreviewOff: async (hubCameraId, off) => {
    const { previewOff, baseUrl, hub, cameras, etag } = get();
    const next = off ? [...new Set([...previewOff, hubCameraId])] : previewOff.filter((id) => id !== hubCameraId);
    if (next.length === previewOff.length && off) return;
    set({ previewOff: next });
    await persist({ baseUrl, hub, cameras, etag, previewOff: next });
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
      previewOff: [],
      reachable: true,
      failure: null,
      skipped: 0,
      sessionFailure: null,
      refreshing: false,
    });
  },
}));
