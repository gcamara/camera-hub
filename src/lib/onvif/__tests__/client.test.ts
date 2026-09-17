import { createHash } from 'node:crypto';

import { OnvifDevice, OnvifError, deviceServiceUrl, rewriteHost, type FetchLike, type OnvifDeps } from '../client';

const NS_DEV = 'xmlns:tds="http://www.onvif.org/ver10/device/wsdl"';
const NS_TT = 'xmlns:tt="http://www.onvif.org/ver10/schema"';

const envelope = (body: string) =>
  `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" ${NS_DEV} ${NS_TT} xmlns:trt="http://www.onvif.org/ver10/media/wsdl"><s:Body>${body}</s:Body></s:Envelope>`;

interface Call {
  url: string;
  body: string;
}

function fakeResponse(status: number, text: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => text } as unknown as Response;
}

function makeDeps(handler: (call: Call) => Response | Promise<Response>): { deps: OnvifDeps; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, body: String(init.body) };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    deps: {
      fetch,
      sha1: async (input) => createHash('sha1').update(input, 'utf8').digest('base64'),
      nonce: () => 'fixednonce',
      now: () => Date.UTC(2026, 8, 17, 8, 0, 0),
      timeoutMs: 1000,
    },
  };
}

const clockBody =
  '<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:UTCDateTime><tt:Time><tt:Hour>9</tt:Hour><tt:Minute>0</tt:Minute><tt:Second>0</tt:Second></tt:Time><tt:Date><tt:Year>2026</tt:Year><tt:Month>9</tt:Month><tt:Day>17</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>';

describe('deviceServiceUrl / rewriteHost', () => {
  it('omits port 80 and keeps others', () => {
    expect(deviceServiceUrl('10.0.0.1', 80)).toBe('http://10.0.0.1/onvif/device_service');
    expect(deviceServiceUrl('10.0.0.1', 2020)).toBe('http://10.0.0.1:2020/onvif/device_service');
  });

  it('replaces only the host of an XAddr', () => {
    expect(rewriteHost('http://camera.lan:8000/onvif/media_service', '10.0.0.7')).toBe('http://10.0.0.7:8000/onvif/media_service');
    expect(rewriteHost('http://172.16.0.2/onvif/media', '10.0.0.7')).toBe('http://10.0.0.7/onvif/media');
  });
});

describe('OnvifDevice', () => {
  it('shifts Created by the camera clock offset and signs authenticated calls', async () => {
    const { deps, calls } = makeDeps(({ body }) => {
      if (body.includes('GetSystemDateAndTime')) return fakeResponse(200, envelope(clockBody));
      return fakeResponse(200, envelope('<tds:GetDeviceInformationResponse><tds:Manufacturer>Acme</tds:Manufacturer></tds:GetDeviceInformationResponse>'));
    });
    const device = new OnvifDevice('10.0.0.5', 8080, { username: 'admin', password: 'pw' }, deps);
    await device.syncClock();
    const info = await device.getDeviceInformation();

    expect(info.manufacturer).toBe('Acme');
    expect(calls[0]!.body).not.toContain('wsse:Security');
    expect(calls[1]!.url).toBe('http://10.0.0.5:8080/onvif/device_service');
    expect(calls[1]!.body).toContain('<wsu:Created>2026-09-17T09:00:00.000Z</wsu:Created>');
    const digest = createHash('sha1').update('fixednonce2026-09-17T09:00:00.000Zpw', 'utf8').digest('base64');
    expect(calls[1]!.body).toContain(`>${digest}</wsse:Password>`);
  });

  it('resolves the media service from GetCapabilities, rewriting the host, then fetches profiles and stream URIs', async () => {
    const { deps, calls } = makeDeps(({ url, body }) => {
      if (body.includes('GetCapabilities')) {
        return fakeResponse(200, envelope('<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>http://192.168.99.99:8000/onvif/media_service</tt:XAddr></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>'));
      }
      if (body.includes('GetProfiles')) {
        expect(url).toBe('http://10.0.0.5:8000/onvif/media_service');
        return fakeResponse(200, envelope('<trt:GetProfilesResponse><trt:Profiles token="p0"><tt:Name>main</tt:Name></trt:Profiles></trt:GetProfilesResponse>'));
      }
      if (body.includes('GetStreamUri')) {
        expect(body).toContain('<trt:ProfileToken>p0</trt:ProfileToken>');
        return fakeResponse(200, envelope('<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://10.0.0.5:554/main</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse>'));
      }
      throw new Error(`unexpected call ${body}`);
    });
    const device = new OnvifDevice('10.0.0.5', 8000, { username: 'u', password: 'p' }, deps);
    const profiles = await device.getProfiles();
    const uri = await device.getStreamUri('p0');

    expect(profiles).toEqual([{ token: 'p0', name: 'main', encoding: undefined, width: undefined, height: undefined }]);
    expect(uri).toBe('rtsp://10.0.0.5:554/main');
    expect(calls.filter((c) => c.body.includes('GetCapabilities'))).toHaveLength(1);
  });

  it('falls back to /onvif/media_service when capabilities are unavailable', async () => {
    const { deps, calls } = makeDeps(({ body }) => {
      if (body.includes('GetCapabilities')) return fakeResponse(500, 'nope');
      return fakeResponse(200, envelope('<trt:GetProfilesResponse><trt:Profiles token="x"><tt:Name>x</tt:Name></trt:Profiles></trt:GetProfilesResponse>'));
    });
    const device = new OnvifDevice('10.0.0.5', 80, null, deps);
    await device.getProfiles();
    expect(calls[1]!.url).toBe('http://10.0.0.5/onvif/media_service');
  });

  it('maps 401 and NotAuthorized faults to auth errors', async () => {
    const unauthorized = makeDeps(() => fakeResponse(401, ''));
    await expect(new OnvifDevice('h', 80, { username: 'u', password: 'p' }, unauthorized.deps).getDeviceInformation()).rejects.toMatchObject({ kind: 'auth' });

    const fault = makeDeps(() =>
      fakeResponse(400, envelope('<s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:NotAuthorized</s:Value></s:Subcode></s:Code><s:Reason><s:Text>The action requested requires authorization</s:Text></s:Reason></s:Fault>')),
    );
    await expect(new OnvifDevice('h', 80, { username: 'u', password: 'p' }, fault.deps).getDeviceInformation()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('reports unreachable hosts as network errors', async () => {
    const { deps } = makeDeps(() => {
      throw new TypeError('Network request failed');
    });
    const device = new OnvifDevice('10.0.0.9', 80, null, deps);
    await expect(device.getDeviceInformation()).rejects.toBeInstanceOf(OnvifError);
    await expect(device.getDeviceInformation()).rejects.toMatchObject({ kind: 'network', message: '10.0.0.9:80 unreachable.' });
  });

  it('throws when no profiles come back', async () => {
    const { deps } = makeDeps(({ body }) =>
      fakeResponse(200, envelope(body.includes('GetCapabilities') ? '<tds:GetCapabilitiesResponse/>' : '<trt:GetProfilesResponse/>')),
    );
    await expect(new OnvifDevice('h', 80, null, deps).getProfiles()).rejects.toMatchObject({ kind: 'parse' });
  });
});
