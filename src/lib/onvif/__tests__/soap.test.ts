import { createHash } from 'node:crypto';

import { base64FromAscii, buildEnvelope, buildSecurityHeader, escapeXml, nonceFromBytes, type Sha1Base64 } from '../soap';

const nodeSha1: Sha1Base64 = async (input) => createHash('sha1').update(input, 'utf8').digest('base64');

describe('base64FromAscii', () => {
  it.each(['', 'a', 'ab', 'abc', 'abcd', 'QmFzZTY0IHJvdW5kIHRyaXA=', 'zyx0987654321!@#'])('matches Buffer for %j', (input) => {
    expect(base64FromAscii(input)).toBe(Buffer.from(input, 'latin1').toString('base64'));
  });
});

describe('buildSecurityHeader', () => {
  const input = { username: 'admin', password: 'p<ss&w"rd', nonce: 'LKqI6G/AikKCQrN0zqZFlg', created: '2026-09-17T08:00:00.000Z' };

  it('emits Base64(SHA1(nonce + created + password)) as the digest', async () => {
    const header = await buildSecurityHeader(input, nodeSha1);
    const expected = createHash('sha1').update(input.nonce + input.created + input.password, 'utf8').digest('base64');
    expect(header).toContain(`#PasswordDigest">${expected}</wsse:Password>`);
  });

  it('carries the nonce Base64-encoded and the username escaped', async () => {
    const header = await buildSecurityHeader({ ...input, username: 'a&b' }, nodeSha1);
    expect(header).toContain(`<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${Buffer.from(input.nonce).toString('base64')}</wsse:Nonce>`);
    expect(header).toContain('<wsse:Username>a&amp;b</wsse:Username>');
    expect(header).toContain(`<wsu:Created>${input.created}</wsu:Created>`);
    expect(header).toContain('s:mustUnderstand="1"');
  });
});

describe('buildEnvelope', () => {
  it('wraps body and header in a SOAP 1.2 envelope', () => {
    const xml = buildEnvelope('<x/>', '<s:Header/>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header/><s:Body><x/></s:Body></s:Envelope>')).toBe(true);
  });
});

describe('escapeXml / nonceFromBytes', () => {
  it('escapes the five XML specials', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  });

  it('maps bytes onto the alphanumeric alphabet', () => {
    const nonce = nonceFromBytes(new Uint8Array([0, 25, 26, 61, 62, 255]));
    expect(nonce).toHaveLength(6);
    expect(nonce).toMatch(/^[A-Za-z0-9]+$/);
  });
});
