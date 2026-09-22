import AsyncStorage from '@react-native-async-storage/async-storage';

import { useHubStore } from '../hubStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'placeholder-token'),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// The store reads the platform through this one module, so a test can stand in either place.
let mockRunningInBrowser = false;
jest.mock('@/lib/platform', () => ({
  get isWeb() {
    return mockRunningInBrowser;
  },
}));

const payload = {
  hub: { name: 'Attic hub', version: '0.4.1' },
  cameras: [
    {
      id: 'garage',
      name: 'Garage',
      brand: 'dahua',
      streams: {
        main: { url: 'rtsp://go2rtc:placeholder@hub.lan:8654/garage', webUrl: '/stream/garage/main.mp4' },
      },
    },
  ],
};

function answer(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
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
  mockRunningInBrowser = false;
  useHubStore.setState({
    hydrated: true,
    baseUrl: '',
    token: '',
    hub: null,
    cameras: [],
    etag: null,
    previewOff: [],
    reachable: true,
    failure: null,
    sessionFailure: null,
    refreshing: false,
  });
});

function sessionCalls(): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.endsWith('/api/session'));
}

describe('openSession', () => {
  it('trades the token for a cookie in a browser', async () => {
    mockRunningInBrowser = true;
    useHubStore.setState({ baseUrl: 'http://hub.lan:8080', token: 'placeholder-token' });
    fetchMock.mockResolvedValue(answer(204));

    const result = await useHubStore.getState().openSession();

    expect(result).toEqual({ outcome: 'ok' });
    expect(sessionCalls()).toEqual(['http://hub.lan:8080/api/session']);
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('include');
    expect(useHubStore.getState().sessionFailure).toBeNull();
  });

  it('never runs on a phone, which has the bearer header on every request', async () => {
    useHubStore.setState({ baseUrl: 'http://hub.lan:8080', token: 'placeholder-token' });

    expect(await useHubStore.getState().openSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useHubStore.getState().sessionFailure).toBeNull();
  });

  it('does nothing without a hub or without a token', async () => {
    mockRunningInBrowser = true;
    useHubStore.setState({ baseUrl: '', token: 'placeholder-token' });
    expect(await useHubStore.getState().openSession()).toBeNull();

    useHubStore.setState({ baseUrl: 'http://hub.lan:8080', token: '' });
    expect(await useHubStore.getState().openSession()).toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the hub once when two callers want a cookie at the same moment', async () => {
    mockRunningInBrowser = true;
    useHubStore.setState({ baseUrl: 'http://hub.lan:8080', token: 'placeholder-token' });
    fetchMock.mockResolvedValue(answer(204));

    const [first, second] = await Promise.all([
      useHubStore.getState().openSession(),
      useHubStore.getState().openSession(),
    ]);

    expect(first).toEqual({ outcome: 'ok' });
    expect(second).toEqual({ outcome: 'ok' });
    expect(sessionCalls()).toHaveLength(1);

    // Once it has answered, a later renewal is a new request, not the old answer replayed.
    await useHubStore.getState().openSession();
    expect(sessionCalls()).toHaveLength(2);
  });

  it('records why the cookie is missing without touching the camera list', async () => {
    mockRunningInBrowser = true;
    useHubStore.setState({
      baseUrl: 'http://hub.lan:8080',
      token: 'placeholder-token',
      reachable: true,
      failure: null,
    });
    fetchMock.mockResolvedValue(answer(404));

    expect(await useHubStore.getState().openSession()).toEqual({ outcome: 'unsupported' });
    const state = useHubStore.getState();
    expect(state.sessionFailure).toContain('no browser streams');
    // The list arrived over the bearer token and is still good; only video is affected.
    expect(state.reachable).toBe(true);
    expect(state.failure).toBeNull();
  });
});

describe('connect', () => {
  it('asks for the stream cookie once the list is in hand, on web', async () => {
    mockRunningInBrowser = true;
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/api/session') ? answer(204) : answer(200, payload),
    );

    const result = await useHubStore.getState().connect('hub.lan:8080', 'placeholder-token');

    expect(result.outcome).toBe('ok');
    expect(sessionCalls()).toEqual(['http://hub.lan:8080/api/session']);
    expect(useHubStore.getState().cameras[0]?.mainWebUrl).toBe('/stream/garage/main.mp4');
  });

  it('connects without asking for a cookie on a phone', async () => {
    fetchMock.mockResolvedValue(answer(200, payload));

    const result = await useHubStore.getState().connect('hub.lan:8080', 'placeholder-token');

    expect(result.outcome).toBe('ok');
    expect(sessionCalls()).toEqual([]);
  });

  it('still connects when the browser cannot get a cookie, and says so', async () => {
    mockRunningInBrowser = true;
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/api/session') ? answer(401) : answer(200, payload),
    );

    const result = await useHubStore.getState().connect('hub.lan:8080', 'placeholder-token');

    expect(result.outcome).toBe('ok');
    expect(useHubStore.getState().cameras).toHaveLength(1);
    expect(useHubStore.getState().sessionFailure).toContain('rejected the token');
  });

  it('forgets a stale session failure when a later connect succeeds', async () => {
    mockRunningInBrowser = true;
    useHubStore.setState({ sessionFailure: 'something old' });
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/api/session') ? answer(204) : answer(200, payload),
    );

    await useHubStore.getState().connect('hub.lan:8080', 'placeholder-token');

    expect(useHubStore.getState().sessionFailure).toBeNull();
  });
});
