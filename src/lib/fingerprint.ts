import { brandFromManufacturer, getBrand } from './brands';
import { deviceServiceUrl, fetchWithTimeout, type FetchLike } from './onvif/client';
import { parseDeviceInformation } from './onvif/parse';
import { bodies, buildEnvelope } from './onvif/soap';
import type { BrandId } from './types';

/** Ordered by how often a home camera answers ONVIF there without a login. */
export const DETECT_ONVIF_PORTS = [2020, 8000, 80, 8080, 8899];
/** 80 and 8080 host most web logins; 88 is Foscam's. 443 is skipped: self-signed certificates fail in fetch. */
export const DETECT_HTTP_PORTS = [80, 8080, 88];

export interface HttpSnapshot {
  status: number;
  /** Header names lower-cased; only the ones fingerprints read. */
  headers: Record<string, string>;
  body: string;
  /** Final URL after redirects, when the fetch implementation reports one. */
  url?: string;
}

export interface Fingerprint {
  brand: BrandId;
  evidence: string;
  match: (snapshot: HttpSnapshot) => boolean;
}

export interface Detection {
  brand: BrandId;
  evidence: string;
  onvifPort?: number;
  rtspPort?: number;
}

export interface DetectDeps {
  fetch: FetchLike;
  /** Per request; the whole detection is additionally capped by `budgetMs`. */
  timeoutMs?: number;
  budgetMs?: number;
  onvifPorts?: number[];
  httpPorts?: number[];
  signal?: AbortSignal;
}

const SNAPSHOT_HEADERS = ['server', 'www-authenticate', 'set-cookie', 'location'];
const MAX_BODY = 65536;

function header(snapshot: HttpSnapshot, name: string): string {
  return snapshot.headers[name] ?? '';
}

/** Body plus the path the device redirected to; the origin is dropped so a hostname like reolink-cam.local cannot match. */
function page(snapshot: HttpSnapshot): string {
  const path = (snapshot.url ?? '').replace(/^[a-z]+:\/\/[^/]*/i, '');
  return `${path}\n${snapshot.body}`;
}

/**
 * Markers seen in the unauthenticated root page of each brand's web UI, most specific first.
 * Tapo has no web UI on 80 and Wyze's RTSP firmware has none at all; both are only ever found through ONVIF or their ports.
 */
export const FINGERPRINTS: Fingerprint[] = [
  {
    brand: 'hikvision',
    evidence: 'matched the Hikvision web server header',
    match: (s) => /App-webs|DNVRS-Webs|Hikvision-Webs/i.test(header(s, 'server')),
  },
  {
    brand: 'hikvision',
    evidence: 'matched the Hikvision login page',
    match: (s) => /doc\/page\/login\.asp|hikvision|hik-?connect/i.test(page(s)),
  },
  {
    brand: 'dahua',
    evidence: 'matched the Dahua session cookie',
    match: (s) => /DhWebClientSessionID|DHLangCookie/i.test(header(s, 'set-cookie')),
  },
  {
    brand: 'dahua',
    evidence: 'matched the Dahua login page',
    match: (s) => /RPC2_Login|<title>\s*WEB (?:SERVICE|VIEW)\s*<\/title>|dahua|amcrest|lorex|\bimou\b/i.test(page(s)),
  },
  {
    brand: 'axis',
    evidence: 'matched the AXIS login realm',
    match: (s) => /realm="AXIS_/i.test(header(s, 'www-authenticate')),
  },
  {
    brand: 'axis',
    evidence: 'matched the AXIS home page',
    match: (s) => /axis-cgi|AXIS [^<]{0,40}Network Camera/i.test(page(s)),
  },
  {
    brand: 'reolink',
    evidence: 'matched the Reolink web client',
    match: (s) => /reolink/i.test(page(s)) || (/api\.cgi/i.test(page(s)) && /rspCode/.test(s.body)),
  },
  {
    brand: 'foscam',
    evidence: 'matched the Foscam login page',
    match: (s) => /IPCam Client|CGIProxy\.fcgi|foscam/i.test(page(s)),
  },
  {
    brand: 'uniview',
    evidence: 'matched the Uniview login page',
    match: (s) => /\/LAPI\/|uniview|\bUNV\b/i.test(page(s)),
  },
  {
    brand: 'ubiquiti',
    evidence: 'matched the UniFi camera page',
    match: (s) => /unifi|ubiquiti|\bubnt\b/i.test(page(s)),
  },
];

export function matchFingerprint(snapshot: HttpSnapshot): Fingerprint | null {
  return FINGERPRINTS.find((fingerprint) => fingerprint.match(snapshot)) ?? null;
}

export function httpRootUrl(host: string, port: number): string {
  return `http://${host}${port === 80 ? '' : `:${port}`}/`;
}

function readHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of SNAPSHOT_HEADERS) {
    let value: string | null | undefined;
    try {
      value = response.headers?.get(name);
    } catch {
      value = undefined;
    }
    if (value) headers[name] = value;
  }
  return headers;
}

export async function snapshotHttp(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<HttpSnapshot | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, { method: 'GET', headers: { Accept: 'text/html,*/*' } }, timeoutMs);
  } catch {
    return null;
  }
  let body = '';
  try {
    body = (await response.text()).slice(0, MAX_BODY);
  } catch {
    body = '';
  }
  return { status: response.status, headers: readHeaders(response), body, url: response.url || undefined };
}

interface OnvifAnswer {
  port: number;
  manufacturer?: string;
}

const deviceInformationBody = buildEnvelope(bodies.getDeviceInformation());

async function probeDeviceInformation(host: string, port: number, fetchImpl: FetchLike, timeoutMs: number): Promise<OnvifAnswer | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      deviceServiceUrl(host, port),
      { method: 'POST', headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' }, body: deviceInformationBody },
      timeoutMs,
    );
  } catch {
    return null;
  }
  if (response.status === 401) return { port };
  let text = '';
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (/GetDeviceInformationResponse/i.test(text)) return { port, manufacturer: parseDeviceInformation(text).manufacturer };
  if (/Envelope/i.test(text) && /Fault|NotAuthorized|Unauthorized/i.test(text)) return { port };
  return null;
}

/** Resolves with the first task that yields a value, or null once every task has settled without one. */
function firstOf<T>(tasks: Array<Promise<T | null>>): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = tasks.length;
    if (pending === 0) resolve(null);
    const settle = () => {
      pending -= 1;
      if (pending === 0) resolve(null);
    };
    for (const task of tasks) {
      task.then((value) => (value ? resolve(value) : settle()), settle);
    }
  });
}

function detection(brand: BrandId, evidence: string, onvifPort?: number): Detection {
  const result: Detection = { brand, evidence, rtspPort: getBrand(brand).rtspPort };
  if (onvifPort !== undefined) result.onvifPort = onvifPort;
  return result;
}

function fromManufacturer(answer: OnvifAnswer): Detection | null {
  const brand = brandFromManufacturer(answer.manufacturer);
  if (brand === 'onvif') return null;
  return detection(brand, `ONVIF on ${answer.port} says “${answer.manufacturer}”`, answer.port);
}

/** Some ports belong to one brand alone; used only when neither ONVIF nor the web page named the maker. */
function corroborate(onvifPorts: number[], httpPorts: number[]): Detection | null {
  if (onvifPorts.includes(2020)) return detection('tapo', 'ONVIF on 2020, a port only Tapo uses', 2020);
  if (onvifPorts.includes(8000)) return detection('reolink', "ONVIF on 8000, Reolink's default", 8000);
  if (httpPorts.includes(88)) return detection('foscam', "a web server on 88, Foscam's port");
  return null;
}

function pickOnvifPort(brand: BrandId, answered: number[]): number | undefined {
  const preferred = getBrand(brand).onvifPort;
  return answered.includes(preferred) ? preferred : answered[0];
}

export async function detectBrand(host: string, deps: DetectDeps): Promise<Detection | null> {
  const started = Date.now();
  const budget = deps.budgetMs ?? 4000;
  const perRequest = deps.timeoutMs ?? 1500;
  const timeout = () => Math.min(perRequest, Math.max(0, budget - (Date.now() - started)));
  const aborted = () => deps.signal?.aborted === true;

  const onvifAnswered: number[] = [];
  const onvifHit = await firstOf(
    (deps.onvifPorts ?? DETECT_ONVIF_PORTS).map(async (port) => {
      const answer = await probeDeviceInformation(host, port, deps.fetch, timeout());
      if (answer) onvifAnswered.push(answer.port);
      return answer ? fromManufacturer(answer) : null;
    }),
  );
  if (onvifHit || aborted()) return onvifHit;
  if (timeout() === 0) return corroborate(onvifAnswered, []);

  const httpAnswered: number[] = [];
  const httpHit = await firstOf(
    (deps.httpPorts ?? DETECT_HTTP_PORTS).map(async (port) => {
      const snapshot = await snapshotHttp(deps.fetch, httpRootUrl(host, port), timeout());
      if (!snapshot) return null;
      httpAnswered.push(port);
      const fingerprint = matchFingerprint(snapshot);
      return fingerprint ? detection(fingerprint.brand, fingerprint.evidence, pickOnvifPort(fingerprint.brand, onvifAnswered)) : null;
    }),
  );
  if (httpHit || aborted()) return httpHit;
  return corroborate(onvifAnswered, httpAnswered);
}

export function describeDetection(result: Detection | null): string {
  if (!result) return 'Couldn’t identify this camera — pick a brand';
  return `Detected ${getBrand(result.brand).label} · ${result.evidence}`;
}
