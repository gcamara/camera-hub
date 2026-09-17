import * as Crypto from 'expo-crypto';

import { OnvifDevice, type OnvifCredentials, type OnvifDeps } from './client';
import { nonceFromBytes, type Sha1Base64 } from './soap';

export { OnvifDevice, OnvifError, rewriteHost } from './client';
export type { OnvifCredentials } from './client';
export { DEFAULT_ONVIF_PORTS, scanHosts, subnetHosts, type DiscoveredDevice } from './discovery';
export { pickDefaultProfiles, type DeviceInformation, type OnvifProfile } from './parse';

const sha1Base64: Sha1Base64 = (input) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, input, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });

function randomNonce(): string {
  return nonceFromBytes(Crypto.getRandomBytes(20));
}

export function nativeOnvifDeps(timeoutMs = 6000): OnvifDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    sha1: sha1Base64,
    nonce: randomNonce,
    now: () => Date.now(),
    timeoutMs,
  };
}

export function createOnvifDevice(host: string, port: number, credentials: OnvifCredentials | null): OnvifDevice {
  return new OnvifDevice(host, port, credentials, nativeOnvifDeps());
}
