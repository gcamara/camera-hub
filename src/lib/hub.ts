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
    response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/cameras`, { method: 'GET', headers }, timeoutMs);
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
