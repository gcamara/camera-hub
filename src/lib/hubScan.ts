import { isBrandId } from './brands';
import { asRecord, asString, describeFailure, normalizeBaseUrl, type HubRequest } from './hub';
import { fetchWithTimeout, type FetchLike } from './onvif/client';
import type { BrandId } from './types';

/**
 * A scan probes every host on the hub's subnets before it answers, which takes seconds, not
 * the fraction of one a camera list does. The camera list's 8 s would abort a healthy scan.
 */
export const SCAN_TIMEOUT_MS = 60_000;

export interface ScanCandidate {
  host: string;
  ports: number[];
  brand: BrandId;
  /** What the hub saw on the wire, one line each, to show as-is. */
  evidence: string[];
  onHub: boolean;
  /** The id the hub already serves this host under; null for a new one. */
  hubCameraId: string | null;
  suggestedPaths: { main: string; sub: string };
  /**
   * A cameras.json entry the hub drafted, credentials left as placeholders. Never read or
   * reshaped here: it is only ever copied back to the hub's config verbatim. Null when the
   * hub sent none.
   */
  suggestedEntry: Record<string, unknown> | null;
}

export interface ScanReport {
  subnets: string[];
  durationMs: number;
  candidates: ScanCandidate[];
  /** Candidates the hub sent without a usable host, dropped rather than shown half-empty. */
  skipped: number;
}

export type ScanResult =
  | { outcome: 'ok'; report: ScanReport }
  /** The hub has no subnets to scan configured. */
  | { outcome: 'disabled'; detail: string }
  /** Someone else's scan is still running on the hub. */
  | { outcome: 'busy'; detail: string }
  | { outcome: 'unauthorized' }
  | { outcome: 'malformed'; detail: string }
  | { outcome: 'unreachable'; detail: string };

export function scanEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/scan`;
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((s) => s.trim());
}

function parseCandidate(value: unknown): ScanCandidate | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const host = asString(raw.host).trim();
  if (host === '' || /\s/.test(host)) return null;
  const brand = asString(raw.brand);
  const onHub = raw.onHub === true;
  const hubCameraId = onHub ? asString(raw.hubCameraId).trim() || null : null;
  const paths = asRecord(raw.suggestedPaths);
  return {
    host,
    ports: Array.isArray(raw.ports) ? raw.ports.filter(isPort) : [],
    brand: isBrandId(brand) ? brand : 'generic',
    evidence: strings(raw.evidence),
    onHub,
    hubCameraId,
    suggestedPaths: { main: asString(paths?.main).trim(), sub: asString(paths?.sub).trim() },
    suggestedEntry: asRecord(raw.suggestedEntry),
  };
}

export function parseScanPayload(payload: unknown): ScanResult {
  const root = asRecord(payload);
  if (!root) return { outcome: 'malformed', detail: 'the hub did not answer with a JSON object' };
  if (!Array.isArray(root.candidates)) return { outcome: 'malformed', detail: 'the answer has no “candidates” list' };

  const candidates: ScanCandidate[] = [];
  let skipped = 0;
  for (const entry of root.candidates) {
    const candidate = parseCandidate(entry);
    if (candidate) candidates.push(candidate);
    else skipped += 1;
  }
  const durationMs = typeof root.durationMs === 'number' && Number.isFinite(root.durationMs) ? root.durationMs : 0;
  return {
    outcome: 'ok',
    report: { subnets: strings(root.subnets), durationMs: Math.max(0, durationMs), candidates, skipped },
  };
}

async function readError(response: Response): Promise<string> {
  try {
    return asString(asRecord(await response.json())?.error).trim();
  } catch {
    return '';
  }
}

/**
 * The hub answers 409 for two unrelated reasons, and only its error text tells them apart:
 * one needs the hub's config edited, the other only needs a moment's patience.
 */
export function classify409(error: string): ScanResult {
  if (/already running/i.test(error)) return { outcome: 'busy', detail: error };
  if (/disabled|scanSubnets/i.test(error)) return { outcome: 'disabled', detail: error };
  return { outcome: 'unreachable', detail: error ? `the hub refused the scan: ${error}` : 'the hub refused the scan' };
}

/** Same credentials as the camera list: the bearer header a phone holds, the cookie a browser holds. */
export async function scanHub(request: Omit<HubRequest, 'etag'>): Promise<ScanResult> {
  const baseUrl = normalizeBaseUrl(request.baseUrl);
  if (baseUrl === '') return { outcome: 'unreachable', detail: 'no hub address' };

  const fetchImpl: FetchLike = request.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = request.timeoutMs ?? SCAN_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `${baseUrl}/api/scan`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${request.token}` },
        credentials: 'include',
      },
      timeoutMs,
    );
  } catch (error) {
    return { outcome: 'unreachable', detail: describeFailure(error, timeoutMs) };
  }

  if (response.status === 401) return { outcome: 'unauthorized' };
  if (response.status === 409) return classify409(await readError(response));
  if (response.status === 404 || response.status === 405) {
    return { outcome: 'unreachable', detail: 'this hub has no scan endpoint; it needs a newer build' };
  }
  if (!response.ok) return { outcome: 'unreachable', detail: `the hub answered ${response.status}` };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { outcome: 'malformed', detail: 'the answer was not JSON' };
  }
  return parseScanPayload(payload);
}

/** One sentence for a scan that produced no list; null for one that did. */
export function describeScanFailure(result: ScanResult): string | null {
  switch (result.outcome) {
    case 'ok':
      return null;
    case 'disabled':
      return 'Scanning is off on this hub. Set hub.scanSubnets in config/cameras.json on the hub to the subnets it may probe, for example ["192.168.1.0/24"].';
    case 'busy':
      return 'The hub is already scanning. Wait a few seconds and try again.';
    case 'unauthorized':
      return 'The hub rejected the token, so it will not scan. Disconnect and connect again with a valid token.';
    case 'malformed':
      return `The hub answered something this app cannot read: ${result.detail}.`;
    case 'unreachable':
      return `The scan did not complete: ${result.detail}.`;
  }
}

/** The text the Copy entry button puts on the clipboard, or null when there is nothing to copy. */
export function entryClipboardText(candidate: ScanCandidate): string | null {
  return candidate.suggestedEntry ? JSON.stringify(candidate.suggestedEntry, null, 2) : null;
}
