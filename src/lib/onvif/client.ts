import {
  isAuthFault,
  parseDeviceInformation,
  parseMediaXAddr,
  parseProfiles,
  parseSoapFault,
  parseStreamUri,
  parseSystemDateAndTime,
  type DeviceInformation,
  type OnvifProfile,
} from './parse';
import { bodies, buildEnvelope, buildSecurityHeader, type Sha1Base64 } from './soap';

export interface OnvifCredentials {
  username: string;
  password: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OnvifDeps {
  fetch: FetchLike;
  sha1: Sha1Base64;
  nonce: () => string;
  now: () => number;
  timeoutMs: number;
}

export class OnvifError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'auth' | 'fault' | 'parse',
  ) {
    super(message);
    this.name = 'OnvifError';
  }
}

export function deviceServiceUrl(host: string, port: number): string {
  const portPart = port === 80 ? '' : `:${port}`;
  return `http://${host}${portPart}/onvif/device_service`;
}

export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Cameras frequently advertise a media XAddr with a hostname or NAT'd IP we cannot reach; keep our host. */
export function rewriteHost(xaddr: string, host: string): string {
  return xaddr.replace(/^(https?:\/\/)([^/:]+)/i, `$1${host}`);
}

export class OnvifDevice {
  private clockOffsetMs = 0;
  private mediaUrl: string | null = null;

  constructor(
    public readonly host: string,
    public readonly port: number,
    private readonly credentials: OnvifCredentials | null,
    private readonly deps: OnvifDeps,
  ) {}

  get deviceUrl(): string {
    return deviceServiceUrl(this.host, this.port);
  }

  /** ONVIF rejects digests whose Created timestamp drifts from the camera clock; align to it first. */
  async syncClock(): Promise<void> {
    try {
      const xml = await this.call(this.deviceUrl, bodies.getSystemDateAndTime(), false);
      const cameraTime = parseSystemDateAndTime(xml);
      if (cameraTime) this.clockOffsetMs = cameraTime.getTime() - this.deps.now();
    } catch {
      this.clockOffsetMs = 0;
    }
  }

  async getDeviceInformation(): Promise<DeviceInformation> {
    const xml = await this.call(this.deviceUrl, bodies.getDeviceInformation(), true);
    return parseDeviceInformation(xml);
  }

  async getMediaUrl(): Promise<string> {
    if (this.mediaUrl) return this.mediaUrl;
    try {
      const xml = await this.call(this.deviceUrl, bodies.getCapabilities(), true);
      const xaddr = parseMediaXAddr(xml);
      this.mediaUrl = xaddr ? rewriteHost(xaddr, this.host) : this.deviceUrl.replace(/device_service$/, 'media_service');
    } catch (error) {
      if (error instanceof OnvifError && error.kind === 'auth') throw error;
      this.mediaUrl = this.deviceUrl.replace(/device_service$/, 'media_service');
    }
    return this.mediaUrl;
  }

  async getProfiles(): Promise<OnvifProfile[]> {
    const xml = await this.call(await this.getMediaUrl(), bodies.getProfiles(), true);
    const profiles = parseProfiles(xml);
    if (profiles.length === 0) throw new OnvifError('The camera returned no media profiles.', 'parse');
    return profiles;
  }

  async getStreamUri(profileToken: string): Promise<string> {
    const xml = await this.call(await this.getMediaUrl(), bodies.getStreamUri(profileToken), true);
    const uri = parseStreamUri(xml);
    if (!uri) throw new OnvifError('The camera returned no stream URI for this profile.', 'parse');
    return uri;
  }

  private async call(url: string, body: string, authenticated: boolean): Promise<string> {
    const header =
      authenticated && this.credentials
        ? await buildSecurityHeader(
            {
              username: this.credentials.username,
              password: this.credentials.password,
              nonce: this.deps.nonce(),
              created: new Date(this.deps.now() + this.clockOffsetMs).toISOString(),
            },
            this.deps.sha1,
          )
        : '';
    const envelope = buildEnvelope(body, header);

    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.deps.fetch,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
          body: envelope,
        },
        this.deps.timeoutMs,
      );
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError' ? 'timed out' : 'unreachable';
      throw new OnvifError(`${this.host}:${this.port} ${reason}.`, 'network');
    }

    const xml = await response.text();
    if (response.status === 401) throw new OnvifError('The camera rejected the credentials.', 'auth');
    const fault = xml.includes('Fault') ? parseSoapFault(xml) : null;
    if (fault) {
      if (authenticated && isAuthFault(fault)) throw new OnvifError('The camera rejected the credentials.', 'auth');
      throw new OnvifError(fault.reason, 'fault');
    }
    if (!response.ok) throw new OnvifError(`HTTP ${response.status} from ${url}`, 'network');
    return xml;
  }
}
