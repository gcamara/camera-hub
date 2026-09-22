import {
  camerasEndpoint,
  describeSessionResult,
  fetchHubCameras,
  needsHubSession,
  normalizeBaseUrl,
  openHubSession,
  parseHubPayload,
  sessionEndpoint,
  type HubRequest,
} from '../hub';
import type { FetchLike } from '../onvif/client';

interface Call {
  url: string;
  method?: string;
  headers: Record<string, string>;
  credentials?: RequestCredentials;
}

function fakeResponse(status: number, body?: unknown, etag?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' && etag ? etag : null) },
    json: async () => {
      if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
      return body;
    },
  } as unknown as Response;
}

function recorder(answer: (call: Call) => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init.method,
      headers: (init.headers ?? {}) as Record<string, string>,
      credentials: init.credentials,
    };
    calls.push(call);
    return answer(call);
  };
  return { fetch, calls };
}

const payload = {
  hub: { name: 'Attic hub', version: '0.4.1' },
  cameras: [
    {
      id: 'front-door',
      name: 'Front door',
      brand: 'reolink',
      livePreview: true,
      streams: {
        main: { url: 'rtsp://go2rtc:placeholder@hub.lan:8654/front', webUrl: '/stream/front-door/main.mp4' },
        sub: { url: 'rtsp://go2rtc:placeholder@hub.lan:8654/front_sub', webUrl: '/stream/front-door/sub.mp4' },
      },
      capabilities: { ptz: false },
    },
  ],
};

function request(overrides: Partial<HubRequest> = {}): HubRequest {
  return { baseUrl: 'http://hub.lan:8080', token: 'placeholder-token', ...overrides };
}

describe('normalizeBaseUrl / camerasEndpoint', () => {
  it('adds a scheme, drops trailing slashes and keeps an explicit https', () => {
    expect(normalizeBaseUrl('hub.tailnet.ts.net:8080')).toBe('http://hub.tailnet.ts.net:8080');
    expect(normalizeBaseUrl('http://hub.lan/')).toBe('http://hub.lan');
    expect(normalizeBaseUrl('https://hub.lan//')).toBe('https://hub.lan');
    expect(normalizeBaseUrl('   ')).toBe('');
  });

  it('builds the contract endpoint', () => {
    expect(camerasEndpoint('hub.lan:8080/')).toBe('http://hub.lan:8080/api/cameras');
  });
});

describe('fetchHubCameras', () => {
  it('sends the bearer token and maps a 200 with its ETag', async () => {
    const { fetch, calls } = recorder(() => fakeResponse(200, payload, 'W/"7"'));
    const result = await fetchHubCameras(request({ fetch }));

    expect(calls[0]?.url).toBe('http://hub.lan:8080/api/cameras');
    expect(calls[0]?.headers.Authorization).toBe('Bearer placeholder-token');
    expect(calls[0]?.headers['If-None-Match']).toBeUndefined();
    if (result.outcome !== 'ok') throw new Error(`expected ok, got ${result.outcome}`);
    expect(result.snapshot.hub).toEqual({ name: 'Attic hub', version: '0.4.1' });
    expect(result.snapshot.etag).toBe('W/"7"');
    expect(result.snapshot.skipped).toBe(0);
    expect(result.snapshot.cameras[0]).toEqual({
      id: 'front-door',
      name: 'Front door',
      brand: 'reolink',
      livePreview: true,
      mainUrl: 'rtsp://go2rtc:placeholder@hub.lan:8654/front',
      subUrl: 'rtsp://go2rtc:placeholder@hub.lan:8654/front_sub',
      mainWebUrl: '/stream/front-door/main.mp4',
      subWebUrl: '/stream/front-door/sub.mp4',
      ptz: false,
    });
  });

  it('asks for credentials so the browser sends the stream cookie it was given', async () => {
    const { fetch, calls } = recorder(() => fakeResponse(200, payload));
    await fetchHubCameras(request({ fetch }));
    expect(calls[0]?.credentials).toBe('include');
  });

  it('sends the cached ETag and reports 304 as unchanged', async () => {
    const { fetch, calls } = recorder(() => fakeResponse(304));
    const result = await fetchHubCameras(request({ fetch, etag: 'W/"7"' }));

    expect(calls[0]?.headers['If-None-Match']).toBe('W/"7"');
    expect(result).toEqual({ outcome: 'unchanged' });
  });

  it('reports a rejected token', async () => {
    const { fetch } = recorder(() => fakeResponse(401, { error: 'bad token' }));
    expect(await fetchHubCameras(request({ fetch }))).toEqual({ outcome: 'unauthorized' });
  });

  it('reports any other status as unreachable and names it', async () => {
    const { fetch } = recorder(() => fakeResponse(503, {}));
    const result = await fetchHubCameras(request({ fetch }));
    expect(result).toEqual({ outcome: 'unreachable', detail: 'the hub answered 503' });
  });

  it('reports a refused connection as unreachable', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('Network request failed');
    };
    const result = await fetchHubCameras(request({ fetch }));
    expect(result).toEqual({ outcome: 'unreachable', detail: 'Network request failed' });
  });

  it('times out instead of hanging', async () => {
    jest.useFakeTimers();
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    const pending = fetchHubCameras(request({ fetch, timeoutMs: 2000 }));
    jest.advanceTimersByTime(2000);
    expect(await pending).toEqual({ outcome: 'unreachable', detail: 'the hub did not answer within 2 s' });
    jest.useRealTimers();
  });

  it('reports a body that is not JSON as malformed', async () => {
    const { fetch } = recorder(() => fakeResponse(200));
    const result = await fetchHubCameras(request({ fetch }));
    expect(result).toEqual({ outcome: 'malformed', detail: 'the answer was not JSON' });
  });

  it('refuses a hub address it cannot use', async () => {
    expect(await fetchHubCameras(request({ baseUrl: '  ' }))).toEqual({ outcome: 'unreachable', detail: 'no hub address' });
  });
});

describe('parseHubPayload', () => {
  it('rejects a shape that is not the contract', () => {
    expect(parseHubPayload('nope', null).outcome).toBe('malformed');
    expect(parseHubPayload([], null).outcome).toBe('malformed');
    expect(parseHubPayload({ cameras: [] }, null).outcome).toBe('malformed');
    expect(parseHubPayload({ hub: { name: 'h', version: '1' } }, null).outcome).toBe('malformed');
    expect(parseHubPayload({ hub: { name: 'h', version: '1' }, cameras: {} }, null).outcome).toBe('malformed');
  });

  it('degrades an unknown brand to the generic preset instead of throwing', () => {
    const result = parseHubPayload(
      {
        hub: { name: 'h', version: '1' },
        cameras: [{ id: 'a', name: 'A', brand: 'nokia-doorbell', streams: { main: { url: 'rtsp://hub/a' } } }],
      },
      null,
    );
    if (result.outcome !== 'ok') throw new Error(`expected ok, got ${result.outcome}`);
    expect(result.snapshot.cameras[0]?.brand).toBe('generic');
  });

  it('treats a missing livePreview as on and honours an explicit false', () => {
    const result = parseHubPayload(
      {
        hub: { name: 'h', version: '1' },
        cameras: [
          { id: 'a', streams: { main: { url: 'rtsp://hub/a' } } },
          { id: 'b', livePreview: false, streams: { main: { url: 'rtsp://hub/b' } } },
          { id: 'c', livePreview: 'yes', streams: { main: { url: 'rtsp://hub/c' } } },
        ],
      },
      null,
    );
    if (result.outcome !== 'ok') throw new Error(`expected ok, got ${result.outcome}`);
    expect(result.snapshot.cameras.map((camera) => camera.livePreview)).toEqual([true, false, true]);
  });

  it('drops entries with no id or no playable main stream and counts them', () => {
    const result = parseHubPayload(
      {
        hub: {},
        cameras: [
          null,
          'string',
          { name: 'no id', streams: { main: { url: 'rtsp://hub/x' } } },
          { id: 'no-streams' },
          { id: 'http-only', streams: { main: { url: 'http://hub/x' } } },
          { id: 'ok', streams: { main: { url: 'rtsp://hub/ok' }, sub: { url: 42 } } },
        ],
      },
      'W/"2"',
    );
    if (result.outcome !== 'ok') throw new Error(`expected ok, got ${result.outcome}`);
    expect(result.snapshot.cameras.map((camera) => camera.id)).toEqual(['ok']);
    expect(result.snapshot.skipped).toBe(5);
    expect(result.snapshot.cameras[0]?.subUrl).toBe('');
    expect(result.snapshot.cameras[0]?.name).toBe('ok');
    expect(result.snapshot.hub).toEqual({ name: 'Hub', version: 'unknown' });
    expect(result.snapshot.etag).toBe('W/"2"');
  });
});

describe('parseHubPayload · webUrl', () => {
  function webUrls(streams: unknown): { mainWebUrl: string; subWebUrl: string } {
    const result = parseHubPayload(
      { hub: { name: 'h', version: '1' }, cameras: [{ id: 'a', streams }] },
      null,
    );
    if (result.outcome !== 'ok') throw new Error(`expected ok, got ${result.outcome}`);
    const camera = result.snapshot.cameras[0];
    if (!camera) throw new Error('expected the camera to survive parsing');
    return { mainWebUrl: camera.mainWebUrl, subWebUrl: camera.subWebUrl };
  }

  it('keeps a root-relative path on each stream', () => {
    expect(
      webUrls({
        main: { url: 'rtsp://hub/a', webUrl: '/stream/a/main.mp4' },
        sub: { url: 'rtsp://hub/a_sub', webUrl: '/stream/a/sub.mp4?start=live' },
      }),
    ).toEqual({ mainWebUrl: '/stream/a/main.mp4', subWebUrl: '/stream/a/sub.mp4?start=live' });
  });

  it('treats an absent webUrl as normal — an older hub sends none', () => {
    expect(webUrls({ main: { url: 'rtsp://hub/a' }, sub: { url: 'rtsp://hub/a_sub' } })).toEqual({
      mainWebUrl: '',
      subWebUrl: '',
    });
  });

  it('keeps the browser stream even when only one quality has one', () => {
    expect(webUrls({ main: { url: 'rtsp://hub/a', webUrl: '/stream/a/main.mp4' }, sub: { url: 'rtsp://hub/a_sub' } })).toEqual(
      { mainWebUrl: '/stream/a/main.mp4', subWebUrl: '' },
    );
  });

  it('refuses anything that is not a path on the hub itself', () => {
    const rejected = [
      // Protocol-relative: the browser would resolve this against another host entirely.
      '//evil.example/stream.mp4',
      'https://evil.example/stream.mp4',
      'javascript:alert(1)',
      'stream/a/main.mp4',
      '/stream/a /main.mp4',
      '',
      42,
      null,
      { url: '/stream/a/main.mp4' },
    ];
    for (const webUrl of rejected) {
      expect(webUrls({ main: { url: 'rtsp://hub/a', webUrl } }).mainWebUrl).toBe('');
    }
  });

  it('trims what the hub sent before judging it', () => {
    expect(webUrls({ main: { url: 'rtsp://hub/a', webUrl: '  /stream/a/main.mp4  ' } }).mainWebUrl).toBe(
      '/stream/a/main.mp4',
    );
  });

  it('survives a stream entry that is not an object', () => {
    expect(webUrls({ main: { url: 'rtsp://hub/a' }, sub: 'nonsense' })).toEqual({ mainWebUrl: '', subWebUrl: '' });
  });
});

describe('needsHubSession', () => {
  it('is true only in a browser with a hub and a token', () => {
    expect(needsHubSession(true, 'http://hub.lan:8080', 'placeholder-token')).toBe(true);
    // A phone puts the token on every request itself and must never ask for a cookie.
    expect(needsHubSession(false, 'http://hub.lan:8080', 'placeholder-token')).toBe(false);
    expect(needsHubSession(true, '', 'placeholder-token')).toBe(false);
    expect(needsHubSession(true, '   ', 'placeholder-token')).toBe(false);
    expect(needsHubSession(true, 'http://hub.lan:8080', '')).toBe(false);
    expect(needsHubSession(true, 'http://hub.lan:8080', '   ')).toBe(false);
  });
});

describe('openHubSession', () => {
  it('posts the bearer token to /api/session and asks for credentials', async () => {
    const { fetch, calls } = recorder(() => fakeResponse(204));
    const result = await openHubSession(request({ fetch }));

    expect(result).toEqual({ outcome: 'ok' });
    expect(calls[0]?.url).toBe('http://hub.lan:8080/api/session');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.Authorization).toBe('Bearer placeholder-token');
    // Without this the browser would throw the Set-Cookie away and every <video> would 401.
    expect(calls[0]?.credentials).toBe('include');
  });

  it('separates a rejected token from a hub that has no session endpoint', async () => {
    for (const status of [401, 403]) {
      const { fetch } = recorder(() => fakeResponse(status));
      expect(await openHubSession(request({ fetch }))).toEqual({ outcome: 'unauthorized' });
    }
    for (const status of [404, 405]) {
      const { fetch } = recorder(() => fakeResponse(status));
      expect(await openHubSession(request({ fetch }))).toEqual({ outcome: 'unsupported' });
    }
  });

  it('names any other status and any transport failure', async () => {
    const { fetch } = recorder(() => fakeResponse(503));
    expect(await openHubSession(request({ fetch }))).toEqual({ outcome: 'failed', detail: 'the hub answered 503' });

    const throwing: FetchLike = async () => {
      throw new TypeError('Network request failed');
    };
    expect(await openHubSession(request({ fetch: throwing }))).toEqual({
      outcome: 'failed',
      detail: 'Network request failed',
    });
  });

  it('refuses a hub address it cannot use', async () => {
    expect(await openHubSession(request({ baseUrl: '  ' }))).toEqual({ outcome: 'failed', detail: 'no hub address' });
  });

  it('says nothing when the cookie arrived and something specific when it did not', () => {
    expect(describeSessionResult({ outcome: 'ok' })).toBeNull();
    expect(describeSessionResult({ outcome: 'unauthorized' })).toContain('rejected the token');
    expect(describeSessionResult({ outcome: 'unsupported' })).toContain('no browser streams');
    expect(describeSessionResult({ outcome: 'failed', detail: 'the hub answered 503' })).toContain(
      'the hub answered 503',
    );
  });
});

describe('sessionEndpoint', () => {
  it('builds the contract endpoint', () => {
    expect(sessionEndpoint('hub.lan:8080/')).toBe('http://hub.lan:8080/api/session');
  });
});
