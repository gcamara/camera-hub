import { httpRootUrl, matchFingerprint, snapshotHttp } from '../fingerprint';
import type { BrandId } from '../types';
import { deviceServiceUrl, fetchWithTimeout, type FetchLike } from './client';
import { bodies, buildEnvelope } from './soap';

export const DEFAULT_ONVIF_PORTS = [80, 8080, 2020, 8000];
/** Web logins fingerprinted during a scan so cameras without ONVIF still show up. */
export const DEFAULT_HTTP_PORTS = [80];

export interface DiscoveredDevice {
  /** 'onvif' answered an ONVIF call; 'http' only has a web page that looks like a camera brand. */
  kind: 'onvif' | 'http';
  host: string;
  port: number;
  authRequired: boolean;
  brand?: BrandId;
  evidence?: string;
}

export interface ScanOptions {
  fetch: FetchLike;
  timeoutMs?: number;
  concurrency?: number;
  /** Extra ports whose web page is fingerprinted; none unless given. */
  httpPorts?: number[];
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

/** Usable host addresses of the network containing `ip`; prefixes shorter than /22 are clamped to keep scans sane. */
export function subnetHosts(ip: string, prefix = 24): string[] {
  const base = ipToInt(ip);
  if (base === null) return [];
  const bits = Math.min(30, Math.max(22, Math.floor(prefix)));
  const size = 2 ** (32 - bits);
  const network = Math.floor(base / size) * size;
  const hosts: string[] = [];
  for (let offset = 1; offset < size - 1; offset += 1) hosts.push(intToIp(network + offset));
  return hosts;
}

const probeBody = buildEnvelope(bodies.getSystemDateAndTime());

export async function probeOnvif(
  host: string,
  port: number,
  fetchImpl: FetchLike,
  timeoutMs = 1500,
): Promise<DiscoveredDevice | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      deviceServiceUrl(host, port),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
        body: probeBody,
      },
      timeoutMs,
    );
  } catch {
    return null;
  }
  if (response.status === 401) return { kind: 'onvif', host, port, authRequired: true };
  let text = '';
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (/SystemDateAndTime/i.test(text)) return { kind: 'onvif', host, port, authRequired: false };
  if (/Envelope/i.test(text) && /Fault|NotAuthorized|Unauthorized/i.test(text)) return { kind: 'onvif', host, port, authRequired: true };
  return null;
}

/** Lists a host only when its web page carries a known camera brand's fingerprint. */
export async function probeHttp(host: string, port: number, fetchImpl: FetchLike, timeoutMs = 1500): Promise<DiscoveredDevice | null> {
  const snapshot = await snapshotHttp(fetchImpl, httpRootUrl(host, port), timeoutMs);
  const fingerprint = snapshot ? matchFingerprint(snapshot) : null;
  if (!fingerprint) return null;
  return { kind: 'http', host, port, authRequired: false, brand: fingerprint.brand, evidence: fingerprint.evidence };
}

/** One entry per host: ONVIF wins over a web page, and whichever came second contributes the brand it found. */
function mergeDevices(existing: DiscoveredDevice | undefined, device: DiscoveredDevice): DiscoveredDevice {
  if (!existing) return device;
  const [primary, secondary] = existing.kind === 'http' && device.kind === 'onvif' ? [device, existing] : [existing, device];
  if (primary.brand || !secondary.brand) return primary;
  return { ...primary, brand: secondary.brand, evidence: secondary.evidence };
}

export async function scanHosts(hosts: string[], ports: number[], options: ScanOptions): Promise<DiscoveredDevice[]> {
  const tasks: Array<{ host: string; port: number; kind: DiscoveredDevice['kind'] }> = [];
  for (const host of hosts) {
    for (const port of ports) tasks.push({ host, port, kind: 'onvif' });
    for (const port of options.httpPorts ?? []) tasks.push({ host, port, kind: 'http' });
  }

  const found = new Map<string, DiscoveredDevice>();
  const concurrency = Math.max(1, options.concurrency ?? 32);
  const total = tasks.length;
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length && !options.signal?.aborted) {
      const task = tasks[next++]!;
      const device =
        task.kind === 'onvif'
          ? await probeOnvif(task.host, task.port, options.fetch, options.timeoutMs)
          : await probeHttp(task.host, task.port, options.fetch, options.timeoutMs);
      if (device) found.set(device.host, mergeDevices(found.get(device.host), device));
      done += 1;
      options.onProgress?.(done, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return [...found.values()].sort((a, b) => ipToInt(a.host)! - ipToInt(b.host)!);
}
