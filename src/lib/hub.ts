import { isBrandId } from './brands';
import { fetchWithTimeout, type FetchLike } from './onvif/client';
import type { BrandId } from './types';

const DEFAULT_TIMEOUT_MS = 8000;

export interface HubInfo {
  name: string;
  version: string;
}

/**
 * A camera the hub owns. Its URLs point at the hub's go2rtc restream and carry go2rtc's
 * credentials, never the camera's own, which the app is never told.
 */
export interface HubCamera {
  id: string;
  name: string;
  brand: BrandId;
  livePreview: boolean;
  mainUrl: string;
  /** Empty when the hub restreams a single quality. */
  subUrl: string;
  /**
   * Path of the fragmented MP4 a browser can play, as the hub sent it: root-relative,
   * because only the client knows which origin it reached the hub on. Empty when the hub
   * serves no browser stream for this quality, which is also what an older hub looks like.
   */
  mainWebUrl: string;
  subWebUrl: string;
  ptz: boolean;
}

export interface HubSnapshot {
  hub: HubInfo;
  cameras: HubCamera[];
  etag: string | null;
  /** Entries the hub sent without a usable id or main stream, dropped rather than shown as dead tiles. */
  skipped: number;
}

export type HubResult =
  | { outcome: 'ok'; snapshot: HubSnapshot }
  | { outcome: 'unchanged' }
  | { outcome: 'unauthorized' }
  | { outcome: 'malformed'; detail: string }
  | { outcome: 'unreachable'; detail: string };

export interface HubRequest {
  baseUrl: string;
  token: string;
  /** The ETag of the cached list; the hub answers 304 when it still matches. */
  etag?: string | null;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** Accepts what someone types — `hub.tailnet.ts.net`, a trailing slash, a scheme — and returns an origin. */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function camerasEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/cameras`;
}

export function sessionEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/session`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function streamUrl(streams: Record<string, unknown> | null, kind: string): string {
  const url = asString(asRecord(streams?.[kind])?.url).trim();
  return /^rtsps?:\/\/\S+$/i.test(url) ? url : '';
}

/**
 * A single leading slash and no whitespace. The second slash of `//evil.example/x` would make
 * the browser resolve the path against another host entirely, so a protocol-relative URL is
 * rejected along with absolute ones: the hub's own origin is the only one this app will dial.
 */
const WEB_PATH = /^\/(?!\/)\S*$/;

function streamWebUrl(streams: Record<string, unknown> | null, kind: string): string {
  const path = asString(asRecord(streams?.[kind])?.webUrl).trim();
  return WEB_PATH.test(path) ? path : '';
}

/** Everything here comes off the network, so every field is treated as absent until it proves otherwise. */
function parseCamera(value: unknown): HubCamera | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = asString(raw.id).trim();
  const streams = asRecord(raw.streams);
  const mainUrl = streamUrl(streams, 'main');
  if (id === '' || mainUrl === '') return null;
  const brand = asString(raw.brand);
  return {
    id,
    name: asString(raw.name).trim() || id,
    brand: isBrandId(brand) ? brand : 'generic',
    livePreview: typeof raw.livePreview === 'boolean' ? raw.livePreview : true,
    mainUrl,
    subUrl: streamUrl(streams, 'sub'),
    mainWebUrl: streamWebUrl(streams, 'main'),
    subWebUrl: streamWebUrl(streams, 'sub'),
    ptz: asRecord(raw.capabilities)?.ptz === true,
  };
}

export function parseHubPayload(payload: unknown, etag: string | null): HubResult {
  const root = asRecord(payload);
  if (!root) return { outcome: 'malformed', detail: 'the hub did not answer with a JSON object' };
  const hub = asRecord(root.hub);
  if (!hub) return { outcome: 'malformed', detail: 'the answer has no “hub” object' };
  if (!Array.isArray(root.cameras)) return { outcome: 'malformed', detail: 'the answer has no “cameras” list' };

  const cameras: HubCamera[] = [];
  let skipped = 0;
  for (const entry of root.cameras) {
    const camera = parseCamera(entry);
    if (camera) cameras.push(camera);
    else skipped += 1;
  }
  return {
    outcome: 'ok',
    snapshot: {
      hub: { name: asString(hub.name).trim() || 'Hub', version: asString(hub.version).trim() || 'unknown' },
      cameras,
      etag,
      skipped,
    },
  };
}

function readEtag(response: Response): string | null {
  try {
    return response.headers?.get('etag') ?? null;
  } catch {
    return null;
  }
}

function describeFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return `the hub did not answer within ${Math.round(timeoutMs / 1000)} s`;
    if (error.message) return error.message;
  }
  return 'the hub could not be reached';
}

export async function fetchHubCameras(request: HubRequest): Promise<HubResult> {
  const baseUrl = normalizeBaseUrl(request.baseUrl);
  if (baseUrl === '') return { outcome: 'unreachable', detail: 'no hub address' };

  const fetchImpl: FetchLike = request.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${request.token}`,
  };
  if (request.etag) headers['If-None-Match'] = request.etag;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `${baseUrl}/api/cameras`,
      // The cookie `openHubSession` obtained is what the browser's <video> requests carry, and
      // it only rides along when credentials are asked for; a phone ignores this and sends the
      // bearer header above, which is the only credential it ever has.
      { method: 'GET', headers, credentials: 'include' },
      timeoutMs,
    );
  } catch (error) {
    return { outcome: 'unreachable', detail: describeFailure(error, timeoutMs) };
  }

  if (response.status === 304) return { outcome: 'unchanged' };
  if (response.status === 401) return { outcome: 'unauthorized' };
  if (!response.ok) return { outcome: 'unreachable', detail: `the hub answered ${response.status}` };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { outcome: 'malformed', detail: 'the answer was not JSON' };
  }
  return parseHubPayload(payload, readEtag(response));
}

export type SessionResult =
  | { outcome: 'ok' }
  | { outcome: 'unauthorized' }
  /** The hub has no /api/session — an older build, or one that was never meant to serve a browser. */
  | { outcome: 'unsupported' }
  | { outcome: 'failed'; detail: string };

/**
 * Only a browser needs the cookie. A `<video>` element sends whatever headers the browser
 * decides to send and nothing this app can add, so the bearer token has to become an
 * httpOnly cookie before the first stream request. A phone puts the token on every request
 * itself and has no element to work around, so it must never call this.
 */
export function needsHubSession(web: boolean, baseUrl: string, token: string): boolean {
  return web && normalizeBaseUrl(baseUrl) !== '' && token.trim() !== '';
}

/**
 * Trades the bearer token for the hub's session cookie. Its failure is reported apart from
 * the camera list's: the list can be perfectly healthy over the bearer header while every
 * stream 401s, and that is a different sentence to put in front of someone.
 */
export async function openHubSession(request: HubRequest): Promise<SessionResult> {
  const baseUrl = normalizeBaseUrl(request.baseUrl);
  if (baseUrl === '') return { outcome: 'failed', detail: 'no hub address' };

  const fetchImpl: FetchLike = request.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `${baseUrl}/api/session`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${request.token}` },
        credentials: 'include',
      },
      timeoutMs,
    );
  } catch (error) {
    return { outcome: 'failed', detail: describeFailure(error, timeoutMs) };
  }

  if (response.status === 401 || response.status === 403) return { outcome: 'unauthorized' };
  if (response.status === 404 || response.status === 405) return { outcome: 'unsupported' };
  if (!response.ok) return { outcome: 'failed', detail: `the hub answered ${response.status}` };
  return { outcome: 'ok' };
}

/** One sentence for the hub screen, or null when there is nothing to say. */
export function describeSessionResult(result: SessionResult): string | null {
  switch (result.outcome) {
    case 'ok':
      return null;
    case 'unauthorized':
      return 'The hub rejected the token when this browser asked for a stream cookie, so no video will play.';
    case 'unsupported':
      return 'This hub serves no browser streams: it does not offer the session endpoint a browser needs.';
    case 'failed':
      return `This browser could not get a stream cookie from the hub: ${result.detail}.`;
  }
}

/** One sentence naming which of the four failures happened, for the hub screen. */
export function describeHubResult(result: HubResult): string {
  switch (result.outcome) {
    case 'ok':
      return `Connected to ${result.snapshot.hub.name} ${result.snapshot.hub.version}`;
    case 'unchanged':
      return 'The hub reports no change.';
    case 'unauthorized':
      return 'The hub rejected the token.';
    case 'malformed':
      return `The hub answered something this app cannot read: ${result.detail}.`;
    case 'unreachable':
      return `The hub could not be reached: ${result.detail}.`;
  }
}
