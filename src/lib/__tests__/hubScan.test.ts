import {
  classify409,
  describeScanFailure,
  entryClipboardText,
  parseScanPayload,
  SCAN_TIMEOUT_MS,
  scanEndpoint,
  scanHub,
  type ScanResult,
} from '../hubScan';
import type { FetchLike } from '../onvif/client';

interface Call {
  url: string;
  method?: string;
  headers: Record<string, string>;
  credentials?: RequestCredentials;
  signal?: AbortSignal | null;
}

function fakeResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
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
      signal: init.signal,
    };
    calls.push(call);
    return answer(call);
  };
  return { fetch, calls };
}

const entry = {
  id: 'cam_192_168_100_28',
  name: 'Camera 192.168.100.28',
  brand: 'generic',
  host: '192.168.100.28',
  username: 'REPLACE_ME',
  password: 'REPLACE_ME',
  streams: { main: { path: '/main' } },
};

const payload = {
  subnets: ['192.168.100.0/24'],
  durationMs: 8123,
  candidates: [
    {
      host: '192.168.100.28',
      ports: [554],
      brand: 'generic',
      evidence: ['rtsp:554 Server: H264DVR 1.0'],
      onHub: false,
      suggestedPaths: { main: '/main', sub: '/sub' },
      suggestedEntry: entry,
    },
    {
      host: '192.168.100.40',
      ports: [554, 80],
      brand: 'reolink',
      evidence: ['onvif:80 Manufacturer: Reolink'],
      onHub: true,
      hubCameraId: 'living_room',
      suggestedPaths: { main: '/h264Preview_01_main' },
      suggestedEntry: {},
    },
  ],
};

const request = { baseUrl: 'hub.lan:8080', token: 'placeholder-token' };

describe('scanEndpoint', () => {
  it('normalizes the address', () => {
    expect(scanEndpoint('hub.lan:8080/')).toBe('http://hub.lan:8080/api/scan');
  });
});

describe('parseScanPayload', () => {
  it('reads a valid answer', () => {
    const result = parseScanPayload(payload);
    if (result.outcome !== 'ok') throw new Error(result.outcome);
    const { report } = result;
    expect(report.subnets).toEqual(['192.168.100.0/24']);
    expect(report.durationMs).toBe(8123);
    expect(report.skipped).toBe(0);
    expect(report.candidates[0]).toEqual({
      host: '192.168.100.28',
      ports: [554],
      brand: 'generic',
      evidence: ['rtsp:554 Server: H264DVR 1.0'],
      onHub: false,
      hubCameraId: null,
      suggestedPaths: { main: '/main', sub: '/sub' },
      suggestedEntry: entry,
    });
    expect(report.candidates[1]!.onHub).toBe(true);
    expect(report.candidates[1]!.hubCameraId).toBe('living_room');
    expect(report.candidates[1]!.brand).toBe('reolink');
  });

  it('defaults a missing sub path to empty', () => {
    const result = parseScanPayload(payload);
    if (result.outcome !== 'ok') throw new Error(result.outcome);
    expect(result.report.candidates[1]!.suggestedPaths).toEqual({ main: '/h264Preview_01_main', sub: '' });
  });

  it('drops malformed candidates and counts them', () => {
    const result = parseScanPayload({
      ...payload,
      candidates: [null, 'x', { ports: [554] }, { host: '  ' }, { host: 'bad host' }, payload.candidates[0]],
    });
    if (result.outcome !== 'ok') throw new Error(result.outcome);
    expect(result.report.candidates.map((c) => c.host)).toEqual(['192.168.100.28']);
    expect(result.report.skipped).toBe(5);
  });

  it('maps an unknown brand to generic and filters junk ports and evidence', () => {
    const result = parseScanPayload({
      candidates: [{ host: '10.0.0.9', brand: 'acme-cam', ports: [554, '80', 0, 70000, 8.5], evidence: ['ok', 3, ''] }],
    });
    if (result.outcome !== 'ok') throw new Error(result.outcome);
    const [candidate] = result.report.candidates;
    expect(candidate!.brand).toBe('generic');
    expect(candidate!.ports).toEqual([554]);
    expect(candidate!.evidence).toEqual(['ok']);
    expect(candidate!.onHub).toBe(false);
    expect(candidate!.suggestedEntry).toBeNull();
    expect(candidate!.suggestedPaths).toEqual({ main: '', sub: '' });
    expect(result.report.subnets).toEqual([]);
    expect(result.report.durationMs).toBe(0);
  });

  it('ignores hubCameraId on a host that is not on the hub', () => {
    const result = parseScanPayload({ candidates: [{ host: '10.0.0.9', onHub: false, hubCameraId: 'x' }] });
    if (result.outcome !== 'ok') throw new Error(result.outcome);
    expect(result.report.candidates[0]!.hubCameraId).toBeNull();
  });

  it('rejects an answer without a candidates list', () => {
    expect(parseScanPayload([]).outcome).toBe('malformed');
    expect(parseScanPayload({ subnets: [] }).outcome).toBe('malformed');
  });

  it('keeps the suggested entry opaque and copies it pretty-printed', () => {
    const result = parseScanPayload(payload);
    if (result.outcome !== 'ok') throw new Error(result.outcome);
    const candidate = result.report.candidates[0]!;
    expect(candidate.suggestedEntry).toBe(payload.candidates[0]!.suggestedEntry);
    expect(entryClipboardText(candidate)).toBe(JSON.stringify(entry, null, 2));
  });
});

describe('scanHub', () => {
  it('POSTs to /api/scan with the bearer header for a phone and credentials for the browser cookie', async () => {
    const { fetch, calls } = recorder(() => fakeResponse(200, payload));
    const result = await scanHub({ ...request, fetch });
    expect(result.outcome).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://hub.lan:8080/api/scan');
    expect(calls[0]!.method).toBe('POST');
    // Native authenticates with this header…
    expect(calls[0]!.headers.Authorization).toBe('Bearer placeholder-token');
    // …and a browser with the hub_session cookie, which only rides along when asked for.
    expect(calls[0]!.credentials).toBe('include');
  });

  it('uses the long scan timeout, not the camera list’s 8 s', async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | null | undefined;
      const fetch: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          signal = init.signal;
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      const pending = scanHub({ ...request, fetch });
      await jest.advanceTimersByTimeAsync(8_000);
      expect(signal!.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS - 8_000);
      expect(signal!.aborted).toBe(true);
      const result = await pending;
      expect(result).toEqual({ outcome: 'unreachable', detail: 'the hub did not answer within 60 s' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('tells the two 409s apart by their error text', async () => {
    const disabled = recorder(() =>
      fakeResponse(409, { error: 'scanning is disabled: set hub.scanSubnets in cameras.json' }),
    );
    const busy = recorder(() => fakeResponse(409, { error: 'a scan is already running' }));
    expect((await scanHub({ ...request, fetch: disabled.fetch })).outcome).toBe('disabled');
    expect((await scanHub({ ...request, fetch: busy.fetch })).outcome).toBe('busy');
  });

  it('does not guess at a 409 it does not recognise', async () => {
    const odd = recorder(() => fakeResponse(409, { error: 'something new' }));
    const empty = recorder(() => fakeResponse(409));
    expect(await scanHub({ ...request, fetch: odd.fetch })).toEqual({
      outcome: 'unreachable',
      detail: 'the hub refused the scan: something new',
    });
    expect((await scanHub({ ...request, fetch: empty.fetch })).outcome).toBe('unreachable');
    expect(classify409('A scan is ALREADY RUNNING').outcome).toBe('busy');
  });

  it('maps 401, other errors, bad JSON and network failures', async () => {
    const cases: Array<[() => Response | Promise<Response>, ScanResult['outcome']]> = [
      [() => fakeResponse(401), 'unauthorized'],
      [() => fakeResponse(404), 'unreachable'],
      [() => fakeResponse(500), 'unreachable'],
      [() => fakeResponse(200), 'malformed'],
      [() => fakeResponse(200, { candidates: 'nope' }), 'malformed'],
      [() => Promise.reject(new TypeError('Network request failed')), 'unreachable'],
    ];
    for (const [answer, outcome] of cases) {
      const { fetch } = recorder(answer);
      expect((await scanHub({ ...request, fetch })).outcome).toBe(outcome);
    }
  });

  it('never dials without an address', async () => {
    const { fetch, calls } = recorder(() => fakeResponse(200, payload));
    expect(await scanHub({ baseUrl: '  ', token: 't', fetch })).toEqual({ outcome: 'unreachable', detail: 'no hub address' });
    expect(calls).toHaveLength(0);
  });
});

describe('describeScanFailure', () => {
  it('has a sentence for every failure and none for success', () => {
    expect(describeScanFailure({ outcome: 'disabled', detail: '' })).toContain('hub.scanSubnets');
    expect(describeScanFailure({ outcome: 'busy', detail: '' })).toContain('already scanning');
    expect(describeScanFailure({ outcome: 'unauthorized' })).toContain('rejected the token');
    expect(describeScanFailure({ outcome: 'unreachable', detail: 'x' })).toContain('x');
    expect(describeScanFailure({ outcome: 'malformed', detail: 'y' })).toContain('y');
    const ok = parseScanPayload(payload);
    expect(describeScanFailure(ok)).toBeNull();
  });
});
