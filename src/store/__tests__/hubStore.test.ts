import AsyncStorage from '@react-native-async-storage/async-storage';

import { useHubStore } from '../hubStore';
import type { HubCamera } from '@/lib/hub';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'placeholder-token'),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const cached: HubCamera = {
  id: 'garage',
  name: 'Garage',
  brand: 'dahua',
  livePreview: true,
  mainUrl: 'rtsp://go2rtc:placeholder@hub.lan:8654/garage',
  subUrl: '',
  mainWebUrl: '',
  subWebUrl: '',
  ptz: false,
};

const payload = {
  hub: { name: 'Attic hub', version: '0.4.1' },
  cameras: [
    { id: 'garage', name: 'Garage', brand: 'dahua', livePreview: true, streams: { main: { url: cached.mainUrl } } },
  ],
};

function answer(status: number, body?: unknown, etag?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' && etag ? etag : null) },
    json: async () => body,
  };
}

const fetchMock = jest.fn();

beforeAll(() => {
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
});

beforeEach(async () => {
  await AsyncStorage.clear();
  fetchMock.mockReset();
  useHubStore.setState({
    hydrated: false,
    baseUrl: '',
    token: '',
    hub: null,
    cameras: [],
    etag: null,
    previewOff: [],
    reachable: true,
    failure: null,
    refreshing: false,
  });
});

describe('connect', () => {
  it('stores the hub and its list once the API answers', async () => {
    fetchMock.mockResolvedValue(answer(200, payload, 'W/"3"'));

    const result = await useHubStore.getState().connect('hub.lan:8080', 'placeholder-token');

    expect(result.outcome).toBe('ok');
    const state = useHubStore.getState();
    expect(state.baseUrl).toBe('http://hub.lan:8080');
    expect(state.hub).toEqual({ name: 'Attic hub', version: '0.4.1' });
    expect(state.cameras).toEqual([cached]);
    expect(state.etag).toBe('W/"3"');
    expect(await AsyncStorage.getItem('camerahub.hub')).toContain('Attic hub');
  });

  it('keeps the app disconnected when the token is rejected', async () => {
    fetchMock.mockResolvedValue(answer(401, { error: 'bad token' }));

    const result = await useHubStore.getState().connect('hub.lan:8080', 'wrong-token');

    expect(result.outcome).toBe('unauthorized');
    expect(useHubStore.getState().baseUrl).toBe('');
    expect(await AsyncStorage.getItem('camerahub.hub')).toBeNull();
  });
});

describe('refresh', () => {
  beforeEach(() => {
    useHubStore.setState({
      hydrated: true,
      baseUrl: 'http://hub.lan:8080',
      token: 'placeholder-token',
      hub: { name: 'Attic hub', version: '0.4.1' },
      cameras: [cached],
      etag: 'W/"3"',
      reachable: true,
    });
  });

  it('serves the cached list and marks it unreachable when the hub is down', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    const result = await useHubStore.getState().refresh();

    expect(result?.outcome).toBe('unreachable');
    const state = useHubStore.getState();
    expect(state.cameras).toEqual([cached]);
    expect(state.reachable).toBe(false);
    expect(state.failure).toBe('Network request failed');
  });

  it('keeps the cached list on a 304 and stays reachable', async () => {
    fetchMock.mockResolvedValue(answer(304));

    const result = await useHubStore.getState().refresh();

    expect(result?.outcome).toBe('unchanged');
    expect(useHubStore.getState().cameras).toEqual([cached]);
    expect(useHubStore.getState().reachable).toBe(true);
  });

  it('recovers once the hub answers again', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await useHubStore.getState().refresh();
    expect(useHubStore.getState().reachable).toBe(false);

    fetchMock.mockResolvedValue(answer(200, payload, 'W/"4"'));
    await useHubStore.getState().refresh();

    const state = useHubStore.getState();
    expect(state.reachable).toBe(true);
    expect(state.failure).toBeNull();
    expect(state.etag).toBe('W/"4"');
  });

  it('does nothing without a hub', async () => {
    useHubStore.setState({ baseUrl: '' });
    expect(await useHubStore.getState().refresh()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('hydrate and disconnect', () => {
  it('restores the cached list and its token', async () => {
    await AsyncStorage.setItem(
      'camerahub.hub',
      JSON.stringify({ baseUrl: 'http://hub.lan:8080', hub: payload.hub, cameras: [cached], etag: 'W/"3"' }),
    );

    await useHubStore.getState().hydrate();

    const state = useHubStore.getState();
    expect(state.baseUrl).toBe('http://hub.lan:8080');
    expect(state.cameras).toEqual([cached]);
    expect(state.token).toBe('placeholder-token');
  });

  it('remembers a preview this phone turned off, and forgets it again', async () => {
    useHubStore.setState({ baseUrl: 'http://hub.lan:8080', cameras: [cached], hub: payload.hub, etag: 'W/"3"' });

    await useHubStore.getState().setPreviewOff('garage', true);
    expect(useHubStore.getState().previewOff).toEqual(['garage']);
    const stored = JSON.parse((await AsyncStorage.getItem('camerahub.hub')) ?? '{}');
    expect(stored.previewOff).toEqual(['garage']);

    await useHubStore.getState().setPreviewOff('garage', true);
    expect(useHubStore.getState().previewOff).toEqual(['garage']);

    await useHubStore.getState().setPreviewOff('garage', false);
    expect(useHubStore.getState().previewOff).toEqual([]);
  });

  it('drops the overrides when a different hub is connected', async () => {
    useHubStore.setState({ baseUrl: 'http://old-hub.lan:8080', previewOff: ['garage'] });
    fetchMock.mockResolvedValueOnce(answer(200, payload, 'W/"9"'));

    await useHubStore.getState().connect('http://hub.lan:8080', 'placeholder-token');

    expect(useHubStore.getState().previewOff).toEqual([]);
  });

  it('keeps the overrides when reconnecting to the same hub', async () => {
    useHubStore.setState({ baseUrl: 'http://hub.lan:8080', previewOff: ['garage'] });
    fetchMock.mockResolvedValueOnce(answer(200, payload, 'W/"9"'));

    await useHubStore.getState().connect('http://hub.lan:8080', 'placeholder-token');

    expect(useHubStore.getState().previewOff).toEqual(['garage']);
  });

  it('clears everything on disconnect', async () => {
    useHubStore.setState({ baseUrl: 'http://hub.lan:8080', cameras: [cached], hub: payload.hub, etag: 'W/"3"' });

    await useHubStore.getState().disconnect();

    const state = useHubStore.getState();
    expect(state.baseUrl).toBe('');
    expect(state.cameras).toEqual([]);
    expect(state.hub).toBeNull();
    expect(await AsyncStorage.getItem('camerahub.hub')).toBeNull();
  });
});
