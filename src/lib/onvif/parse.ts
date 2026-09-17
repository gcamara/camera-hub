import { XMLParser } from 'fast-xml-parser';

export interface OnvifProfile {
  token: string;
  name: string;
  encoding?: string;
  width?: number;
  height?: number;
}

export interface DeviceInformation {
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  serialNumber?: string;
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Depth-first search for the first element with the given local name. */
export function findElement(root: unknown, name: string): unknown {
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findElement(item, name);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (!isNode(root)) return undefined;
  if (name in root) return root[name];
  for (const value of Object.values(root)) {
    const hit = findElement(value, name);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (isNode(value) && typeof value['#text'] === 'string') return value['#text'];
  return undefined;
}

function num(value: unknown): number | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

export interface SoapFault {
  reason: string;
  /** e.g. "ter:NotAuthorized"; empty when the camera sends none. */
  subcode: string;
}

export function parseSoapFault(xml: string): SoapFault | null {
  const fault = findElement(parseXml(xml), 'Fault');
  if (!isNode(fault)) return null;
  const reason = findElement(fault, 'Text') ?? findElement(fault, 'faultstring');
  const subcode = findElement(findElement(fault, 'Subcode'), 'Value');
  return { reason: text(reason) ?? 'SOAP fault', subcode: text(subcode) ?? '' };
}

export function isAuthFault(fault: SoapFault): boolean {
  return /NotAuthorized|Unauthorized|InvalidSecurity|FailedAuthentication/i.test(`${fault.subcode} ${fault.reason}`);
}

export function parseSystemDateAndTime(xml: string): Date | null {
  const utc = findElement(parseXml(xml), 'UTCDateTime');
  if (!isNode(utc)) return null;
  const date = utc['Date'];
  const time = utc['Time'];
  const year = num(findElement(date, 'Year'));
  const month = num(findElement(date, 'Month'));
  const day = num(findElement(date, 'Day'));
  const hour = num(findElement(time, 'Hour'));
  const minute = num(findElement(time, 'Minute'));
  const second = num(findElement(time, 'Second'));
  if ([year, month, day, hour, minute, second].some((v) => v === undefined)) return null;
  return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
}

export function parseDeviceInformation(xml: string): DeviceInformation {
  const response = findElement(parseXml(xml), 'GetDeviceInformationResponse');
  return {
    manufacturer: text(findElement(response, 'Manufacturer')),
    model: text(findElement(response, 'Model')),
    firmwareVersion: text(findElement(response, 'FirmwareVersion')),
    serialNumber: text(findElement(response, 'SerialNumber')),
  };
}

export function parseMediaXAddr(xml: string): string | null {
  const media = findElement(parseXml(xml), 'Media');
  const xaddr = text(findElement(media, 'XAddr'));
  return xaddr ?? null;
}

export function parseProfiles(xml: string): OnvifProfile[] {
  const response = findElement(parseXml(xml), 'GetProfilesResponse');
  if (!isNode(response)) return [];
  return asArray(response['Profiles'])
    .filter(isNode)
    .map((profile) => {
      const encoder = profile['VideoEncoderConfiguration'];
      const resolution = findElement(encoder, 'Resolution');
      return {
        token: text(profile['@_token']) ?? '',
        name: text(profile['Name']) ?? '',
        encoding: text(findElement(encoder, 'Encoding')),
        width: num(findElement(resolution, 'Width')),
        height: num(findElement(resolution, 'Height')),
      };
    })
    .filter((profile) => profile.token !== '');
}

export function parseStreamUri(xml: string): string | null {
  const response = findElement(parseXml(xml), 'GetStreamUriResponse');
  const uri = text(findElement(response, 'Uri'));
  return uri && uri.trim() !== '' ? uri.trim() : null;
}

export function pixelCount(profile: OnvifProfile): number {
  return (profile.width ?? 0) * (profile.height ?? 0);
}

/** Largest profile as main, smallest distinct profile as sub (or none). */
export function pickDefaultProfiles(profiles: OnvifProfile[]): { main?: OnvifProfile; sub?: OnvifProfile } {
  if (profiles.length === 0) return {};
  const sorted = [...profiles].sort((a, b) => pixelCount(b) - pixelCount(a));
  const main = sorted[0];
  const sub = sorted.length > 1 ? sorted[sorted.length - 1] : undefined;
  return { main, sub: sub && sub.token !== main?.token ? sub : undefined };
}
