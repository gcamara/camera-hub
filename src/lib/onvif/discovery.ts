import { deviceServiceUrl, fetchWithTimeout, type FetchLike } from './client';
import { bodies, buildEnvelope } from './soap';

export const DEFAULT_ONVIF_PORTS = [80, 8080, 2020, 8000];

export interface DiscoveredDevice {
  host: string;
  port: number;
  authRequired: boolean;
}

export interface ScanOptions {
  fetch: FetchLike;
  timeoutMs?: number;
  concurrency?: number;
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
  if (response.status === 401) return { host, port, authRequired: true };
  let text = '';
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (/SystemDateAndTime/i.test(text)) return { host, port, authRequired: false };
  if (/Envelope/i.test(text) && /Fault|NotAuthorized|Unauthorized/i.test(text)) return { host, port, authRequired: true };
  return null;
}

export async function scanHosts(hosts: string[], ports: number[], options: ScanOptions): Promise<DiscoveredDevice[]> {
  const tasks: Array<{ host: string; port: number }> = [];
  for (const host of hosts) for (const port of ports) tasks.push({ host, port });

  const found = new Map<string, DiscoveredDevice>();
  const concurrency = Math.max(1, options.concurrency ?? 32);
  const total = tasks.length;
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length && !options.signal?.aborted) {
      const task = tasks[next++]!;
      const device = await probeOnvif(task.host, task.port, options.fetch, options.timeoutMs);
      if (device && !found.has(device.host)) found.set(device.host, device);
      done += 1;
      options.onProgress?.(done, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return [...found.values()].sort((a, b) => ipToInt(a.host)! - ipToInt(b.host)!);
}
