export type Sha1Base64 = (input: string) => Promise<string>;

export interface UsernameTokenInput {
  username: string;
  password: string;
  /** ASCII-only nonce; its UTF-8 bytes are what the camera hashes. */
  nonce: string;
  /** ISO-8601 timestamp already adjusted for the camera's clock. */
  created: string;
}

const NS = {
  soap: 'http://www.w3.org/2003/05/soap-envelope',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  passwordDigest:
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest',
  base64Binary:
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
  device: 'http://www.onvif.org/ver10/device/wsdl',
  media: 'http://www.onvif.org/ver10/media/wsdl',
  schema: 'http://www.onvif.org/ver10/schema',
} as const;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64FromAscii(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i) & 0xff;
    const b = i + 1 < input.length ? input.charCodeAt(i + 1) & 0xff : NaN;
    const c = i + 2 < input.length ? input.charCodeAt(i + 2) & 0xff : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    out += Number.isNaN(b) ? '=' : B64[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    out += Number.isNaN(c) ? '=' : B64[c & 63];
  }
  return out;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * WS-Security UsernameToken with PasswordDigest = Base64(SHA1(nonce + created + password)).
 * The nonce is restricted to printable ASCII so the string the hash sees is byte-identical
 * to the Base64-decoded Nonce element the camera reconstructs.
 */
export async function buildSecurityHeader(input: UsernameTokenInput, sha1: Sha1Base64): Promise<string> {
  const digest = await sha1(input.nonce + input.created + input.password);
  return (
    `<s:Header>` +
    `<wsse:Security s:mustUnderstand="1" xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}">` +
    `<wsse:UsernameToken>` +
    `<wsse:Username>${escapeXml(input.username)}</wsse:Username>` +
    `<wsse:Password Type="${NS.passwordDigest}">${digest}</wsse:Password>` +
    `<wsse:Nonce EncodingType="${NS.base64Binary}">${base64FromAscii(input.nonce)}</wsse:Nonce>` +
    `<wsu:Created>${input.created}</wsu:Created>` +
    `</wsse:UsernameToken>` +
    `</wsse:Security>` +
    `</s:Header>`
  );
}

export function buildEnvelope(body: string, header = ''): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="${NS.soap}">${header}<s:Body>${body}</s:Body></s:Envelope>`
  );
}

export const bodies = {
  getSystemDateAndTime: () => `<tds:GetSystemDateAndTime xmlns:tds="${NS.device}"/>`,
  getDeviceInformation: () => `<tds:GetDeviceInformation xmlns:tds="${NS.device}"/>`,
  getCapabilities: () =>
    `<tds:GetCapabilities xmlns:tds="${NS.device}"><tds:Category>Media</tds:Category></tds:GetCapabilities>`,
  getProfiles: () => `<trt:GetProfiles xmlns:trt="${NS.media}"/>`,
  getStreamUri: (profileToken: string) =>
    `<trt:GetStreamUri xmlns:trt="${NS.media}" xmlns:tt="${NS.schema}">` +
    `<trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup>` +
    `<trt:ProfileToken>${escapeXml(profileToken)}</trt:ProfileToken>` +
    `</trt:GetStreamUri>`,
};

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function nonceFromBytes(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += NONCE_ALPHABET[byte % NONCE_ALPHABET.length];
  return out;
}
