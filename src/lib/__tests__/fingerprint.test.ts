import { describeDetection, detectBrand, matchFingerprint, snapshotHttp, type HttpSnapshot } from '../fingerprint';
import type { FetchLike } from '../onvif/client';

function snapshot(body: string, headers: Record<string, string> = {}, status = 200, url?: string): HttpSnapshot {
  return { status, headers, body, url };
}

function fakeResponse(status: number, text: string, headers: Record<string, string> = {}, url = ''): Response {
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => text,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

const envelope = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const deviceInformation = (manufacturer: string) =>
  envelope(`<tds:GetDeviceInformationResponse><tds:Manufacturer>${manufacturer}</tds:Manufacturer><tds:Model>C200</tds:Model></tds:GetDeviceInformationResponse>`);

const notAuthorized = envelope(
  '<SOAP-ENV:Fault><SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value><SOAP-ENV:Subcode><SOAP-ENV:Value>ter:NotAuthorized</SOAP-ENV:Value></SOAP-ENV:Subcode></SOAP-ENV:Code><SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">Sender not Authorized</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>',
);

const pages = {
  hikvisionIndex:
    '<!DOCTYPE html>\n<html><head><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>index</title></head>\n<body><script type="text/javascript">window.location.href = "/doc/page/login.asp?_" + (new Date()).getTime();</script></body></html>',
  dahuaLogin:
    '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>WEB SERVICE</title><link rel="stylesheet" href="/css/login.css"></head>\n<body><div id="login"><form action="/RPC2_Login" method="post"></form></div></body></html>',
  amcrestLogin:
    '<html><head><title></title></head><body><div class="login-box"><span class="brand">Amcrest Technologies</span><select id="loginType"><option value="LDAPUser">LDAP User</option></select></div></body></html>',
  reolinkClient: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reolink</title><link href="/css/app.css" rel="stylesheet"></head><body><div id="app"></div><script src="/js/chunk-vendors.js"></script></body></html>',
  reolinkApi: '[{"cmd":"GetDevInfo","code":1,"error":{"detail":"please login first","rspCode":-6}}]',
  axisHome: '<!DOCTYPE html>\n<html><head><title>AXIS M3045-V Network Camera</title></head><body><a href="/axis-cgi/mjpg/video.cgi">Live view</a></body></html>',
  foscamLogin: '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>IPCam Client</title><script src="js/jquery.js"></script></head>\n<body><div id="loginBox"><form id="loginForm"></form></div></body></html>',
  univiewLogin: '<!DOCTYPE html><html><head><title>IPC</title><script>var g_lapiPrefix = "/LAPI/V1.0/";</script></head><body><div class="login-logo">Uniview</div></body></html>',
  unifiCamera: '<!DOCTYPE html><html><head><title>UniFi Video Camera</title></head><body><div id="root"></div><script src="/static/js/ubnt.js"></script></body></html>',
  router: '<!DOCTYPE html><html><head><title>Router admin</title></head><body><form action="/login.cgi"><input name="user"></form></body></html>',
};

describe('matchFingerprint', () => {
  it.each([
    ['Hikvision by server header', snapshot('<html></html>', { server: 'App-webs/' }), 'hikvision', 'matched the Hikvision web server header'],
    ['Hikvision by the login redirect', snapshot(pages.hikvisionIndex), 'hikvision', 'matched the Hikvision login page'],
    ['Hikvision by the path it redirected to', snapshot('<html></html>', {}, 200, 'http://10.0.0.9/doc/page/login.asp?_1'), 'hikvision', 'matched the Hikvision login page'],
    ['Dahua by session cookie', snapshot('<html></html>', { 'set-cookie': 'DhWebClientSessionID=1259773813; path=/' }), 'dahua', 'matched the Dahua session cookie'],
    ['Dahua by WEB SERVICE title', snapshot(pages.dahuaLogin), 'dahua', 'matched the Dahua login page'],
    ['Amcrest by login page', snapshot(pages.amcrestLogin), 'dahua', 'matched the Dahua login page'],
    ['Reolink by web client', snapshot(pages.reolinkClient), 'reolink', 'matched the Reolink web client'],
    ['Reolink by api.cgi error', snapshot(pages.reolinkApi, {}, 200, 'http://10.0.0.9/cgi-bin/api.cgi'), 'reolink', 'matched the Reolink web client'],
    ['AXIS by realm', snapshot('', { 'www-authenticate': 'Digest realm="AXIS_ACCC8E123456", nonce="0000d3feY7", stale=FALSE, qop="auth"' }, 401), 'axis', 'matched the AXIS login realm'],
    ['AXIS by home page', snapshot(pages.axisHome), 'axis', 'matched the AXIS home page'],
    ['Foscam by IPCam Client title', snapshot(pages.foscamLogin), 'foscam', 'matched the Foscam login page'],
    ['Uniview by LAPI prefix', snapshot(pages.univiewLogin), 'uniview', 'matched the Uniview login page'],
    ['UniFi by camera page', snapshot(pages.unifiCamera), 'ubiquiti', 'matched the UniFi camera page'],
  ])('%s', (_name, input, brand, evidence) => {
    expect(matchFingerprint(input)).toMatchObject({ brand, evidence });
  });

  it('matches nothing on an ordinary web server', () => {
    expect(matchFingerprint(snapshot(pages.router, { server: 'lighttpd/1.4.59' }))).toBeNull();
    expect(matchFingerprint(snapshot('', {}, 404))).toBeNull();
  });

  it('ignores brand names that only appear in the hostname', () => {
    expect(matchFingerprint(snapshot('<html></html>', {}, 200, 'http://reolink-cam.local/'))).toBeNull();
  });
});

describe('snapshotHttp', () => {
  it('keeps status, the headers fingerprints read, the body and the final URL', async () => {
    const fetch: FetchLike = async () => fakeResponse(401, 'denied', { Server: 'Boa/0.94', 'WWW-Authenticate': 'Digest realm="AXIS_1"' }, 'http://h/index.html');
    expect(await snapshotHttp(fetch, 'http://h/', 100)).toEqual({
      status: 401,
      headers: { server: 'Boa/0.94', 'www-authenticate': 'Digest realm="AXIS_1"' },
      body: 'denied',
      url: 'http://h/index.html',
    });
  });

  it('returns null when the host is unreachable', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('Network request failed');
    };
    expect(await snapshotHttp(fetch, 'http://h/', 100)).toBeNull();
  });
});

interface Call {
  url: string;
  method: string;
}

function makeFetch(handler: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, method: init.method ?? 'GET' };
      calls.push(call);
      return handler(call);
    },
  };
}

const refused = (): never => {
  throw new TypeError('Network request failed');
};

describe('detectBrand', () => {
  it('stops at an ONVIF manufacturer answer without touching HTTP', async () => {
    const { fetch, calls } = makeFetch(({ url }) => (url === 'http://10.0.0.2:2020/onvif/device_service' ? fakeResponse(200, deviceInformation('TP-Link')) : refused()));
    const result = await detectBrand('10.0.0.2', { fetch });

    expect(result).toEqual({ brand: 'tapo', evidence: 'ONVIF on 2020 says “TP-Link”', onvifPort: 2020, rtspPort: 554 });
    expect(calls.every((call) => call.method === 'POST')).toBe(true);
    expect(describeDetection(result)).toBe('Detected TP-Link Tapo · ONVIF on 2020 says “TP-Link”');
  });

  it('falls back to the web page when ONVIF wants a login, keeping the ONVIF port that answered', async () => {
    const { fetch, calls } = makeFetch(({ url, method }) => {
      if (url === 'http://10.0.0.3/onvif/device_service') return fakeResponse(400, notAuthorized);
      if (method === 'GET' && url === 'http://10.0.0.3/') return fakeResponse(200, pages.hikvisionIndex, { server: 'App-webs/' });
      return refused();
    });
    const result = await detectBrand('10.0.0.3', { fetch });

    expect(result).toEqual({ brand: 'hikvision', evidence: 'matched the Hikvision web server header', onvifPort: 80, rtspPort: 554 });
    expect(calls.filter((call) => call.method === 'GET').map((call) => call.url).sort()).toEqual(['http://10.0.0.3/', 'http://10.0.0.3:8080/', 'http://10.0.0.3:88/']);
  });

  it('ignores an ONVIF answer from an unknown maker and reads the web page instead', async () => {
    const { fetch } = makeFetch(({ url, method }) => {
      if (url === 'http://10.0.0.4:8080/onvif/device_service') return fakeResponse(200, deviceInformation('Acme Cams'));
      if (method === 'GET' && url === 'http://10.0.0.4:88/') return fakeResponse(200, pages.foscamLogin);
      return refused();
    });
    expect(await detectBrand('10.0.0.4', { fetch })).toEqual({ brand: 'foscam', evidence: 'matched the Foscam login page', onvifPort: 8080, rtspPort: 88 });
  });

  it('uses a brand-specific port as the last resort', async () => {
    const tapo = makeFetch(({ url }) => (url === 'http://10.0.0.5:2020/onvif/device_service' ? fakeResponse(401, '') : refused()));
    expect(await detectBrand('10.0.0.5', { fetch: tapo.fetch })).toEqual({ brand: 'tapo', evidence: 'ONVIF on 2020, a port only Tapo uses', onvifPort: 2020, rtspPort: 554 });

    const reolink = makeFetch(({ url }) => (url === 'http://10.0.0.6:8000/onvif/device_service' ? fakeResponse(401, '') : refused()));
    expect(await detectBrand('10.0.0.6', { fetch: reolink.fetch })).toEqual({ brand: 'reolink', evidence: "ONVIF on 8000, Reolink's default", onvifPort: 8000, rtspPort: 554 });

    const foscam = makeFetch(({ url }) => (url === 'http://10.0.0.7:88/' ? fakeResponse(200, '<html><title>Loading</title></html>') : refused()));
    expect(await detectBrand('10.0.0.7', { fetch: foscam.fetch })).toEqual({ brand: 'foscam', evidence: "a web server on 88, Foscam's port", rtspPort: 88 });
  });

  it('returns null when nothing matched', async () => {
    const { fetch, calls } = makeFetch(({ url }) => (url === 'http://10.0.0.8/' ? fakeResponse(200, pages.router, { server: 'lighttpd/1.4.59' }) : refused()));
    const result = await detectBrand('10.0.0.8', { fetch });

    expect(result).toBeNull();
    expect(calls).toHaveLength(8);
    expect(describeDetection(result)).toBe('Couldn’t identify this camera — pick a brand');
  });

  it('probes only the ONVIF ports it is given', async () => {
    const { fetch, calls } = makeFetch(() => refused());
    await detectBrand('10.0.0.9', { fetch, onvifPorts: [8080], httpPorts: [] });
    expect(calls.map((call) => call.url)).toEqual(['http://10.0.0.9:8080/onvif/device_service']);
  });

  it('gives up once the budget is spent', async () => {
    const { fetch, calls } = makeFetch(() => refused());
    expect(await detectBrand('10.0.0.10', { fetch, budgetMs: 0 })).toBeNull();
    expect(calls.every((call) => call.method === 'POST')).toBe(true);
  });
});
