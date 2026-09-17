import type { FetchLike } from '../client';
import { intToIp, ipToInt, probeHttp, probeOnvif, scanHosts, subnetHosts } from '../discovery';

function fakeResponse(status: number, text: string, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

const hikvisionIndex = '<!DOCTYPE html><html><head><title>index</title></head><body><script>window.location.href = "/doc/page/login.asp?_" + (new Date()).getTime();</script></body></html>';

describe('ip helpers', () => {
  it('converts both ways', () => {
    expect(ipToInt('192.168.1.23')).toBe(3232235799);
    expect(intToIp(3232235799)).toBe('192.168.1.23');
    expect(ipToInt('300.1.1.1')).toBeNull();
    expect(ipToInt('1.2.3')).toBeNull();
  });

  it('enumerates the usable hosts of a /24 and clamps wide prefixes', () => {
    const hosts = subnetHosts('192.168.1.23', 24);
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts[253]).toBe('192.168.1.254');
    expect(subnetHosts('10.0.5.9', 30)).toEqual(['10.0.5.9', '10.0.5.10']);
    expect(subnetHosts('10.0.0.1', 8)).toHaveLength(1022);
    expect(subnetHosts('bad', 24)).toEqual([]);
  });
});

describe('probeOnvif', () => {
  it('recognises a device that answers GetSystemDateAndTime', async () => {
    const fetch: FetchLike = async (url) => {
      expect(url).toBe('http://10.0.0.2:2020/onvif/device_service');
      return fakeResponse(200, '<Envelope><Body><GetSystemDateAndTimeResponse><SystemDateAndTime/></GetSystemDateAndTimeResponse></Body></Envelope>');
    };
    expect(await probeOnvif('10.0.0.2', 2020, fetch)).toEqual({ kind: 'onvif', host: '10.0.0.2', port: 2020, authRequired: false });
  });

  it('recognises devices that demand auth, via 401 or a SOAP fault', async () => {
    expect(await probeOnvif('h', 80, async () => fakeResponse(401, ''))).toEqual({ kind: 'onvif', host: 'h', port: 80, authRequired: true });
    expect(await probeOnvif('h', 80, async () => fakeResponse(400, '<Envelope><Fault>NotAuthorized</Fault></Envelope>'))).toEqual({ kind: 'onvif', host: 'h', port: 80, authRequired: true });
  });

  it('ignores ordinary web servers and unreachable hosts', async () => {
    expect(await probeOnvif('h', 80, async () => fakeResponse(404, '<html>Not found</html>'))).toBeNull();
    expect(
      await probeOnvif('h', 80, async () => {
        throw new TypeError('Network request failed');
      }),
    ).toBeNull();
  });
});

describe('probeHttp', () => {
  it('lists a host whose web page carries a brand fingerprint', async () => {
    const fetch: FetchLike = async (url, init) => {
      expect(url).toBe('http://10.0.0.4/');
      expect(init.method).toBe('GET');
      return fakeResponse(200, hikvisionIndex, { server: 'App-webs/' });
    };
    expect(await probeHttp('10.0.0.4', 80, fetch)).toEqual({
      kind: 'http',
      host: '10.0.0.4',
      port: 80,
      authRequired: false,
      brand: 'hikvision',
      evidence: 'matched the Hikvision web server header',
    });
  });

  it('ignores web servers that are not cameras', async () => {
    expect(await probeHttp('h', 80, async () => fakeResponse(200, '<html><title>Router admin</title></html>'))).toBeNull();
    expect(await probeHttp('h', 8080, async () => fakeResponse(200, '<html><title>Router admin</title></html>'))).toBeNull();
  });
});

describe('scanHosts', () => {
  it('probes every host/port pair with bounded concurrency, dedupes per host and reports progress', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetch: FetchLike = async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      if (url.startsWith('http://10.0.0.3')) return fakeResponse(200, '<SystemDateAndTime/>');
      if (url === 'http://10.0.0.1:8080/onvif/device_service') return fakeResponse(401, '');
      throw new Error('down');
    };
    const progress: number[] = [];
    const found = await scanHosts(['10.0.0.3', '10.0.0.1', '10.0.0.2'], [80, 8080], {
      fetch,
      concurrency: 2,
      timeoutMs: 100,
      onProgress: (done) => progress.push(done),
    });

    expect(found).toEqual([
      { kind: 'onvif', host: '10.0.0.1', port: 8080, authRequired: true },
      { kind: 'onvif', host: '10.0.0.3', port: 80, authRequired: false },
    ]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('adds one web-page task per host, lists HTTP-only cameras and folds a fingerprint into an ONVIF hit', async () => {
    const fetch: FetchLike = async (url, init) => {
      if (init.method === 'GET') {
        if (url === 'http://10.0.0.5/') return fakeResponse(200, '<html><head><title>WEB SERVICE</title></head></html>');
        if (url === 'http://10.0.0.6/') return fakeResponse(200, hikvisionIndex);
        throw new Error('down');
      }
      if (url === 'http://10.0.0.6:8080/onvif/device_service') return fakeResponse(401, '');
      throw new Error('down');
    };
    const progress: number[] = [];
    const found = await scanHosts(['10.0.0.5', '10.0.0.6', '10.0.0.7'], [8080], {
      fetch,
      httpPorts: [80],
      concurrency: 1,
      onProgress: (done, total) => progress.push(total - done),
    });

    expect(found).toEqual([
      { kind: 'http', host: '10.0.0.5', port: 80, authRequired: false, brand: 'dahua', evidence: 'matched the Dahua login page' },
      { kind: 'onvif', host: '10.0.0.6', port: 8080, authRequired: true, brand: 'hikvision', evidence: 'matched the Hikvision login page' },
    ]);
    expect(progress).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it('stops early when aborted', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      controller.abort();
      return fakeResponse(404, '');
    };
    await scanHosts(['a', 'b', 'c', 'd'], [80], { fetch, concurrency: 1, signal: controller.signal });
    expect(calls).toBe(1);
  });
});
