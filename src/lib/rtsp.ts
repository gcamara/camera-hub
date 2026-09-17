import { resolvePathTemplate } from './brands';
import type { Camera, StreamKind } from './types';

export interface RtspParts {
  host: string;
  port: number;
  username: string;
  password: string;
  path: string;
}

const RTSP_RE = /^rtsps?:\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#\s]+)(?::(\d{1,5}))?(\/[^\s]*)?$/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '') return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function parseRtspUrl(url: string): RtspParts | null {
  const match = RTSP_RE.exec(url.trim());
  if (!match) return null;
  const [, user = '', pass = '', host = '', port, path = '/'] = match;
  const portNumber = port ? Number(port) : 554;
  if (portNumber < 1 || portNumber > 65535) return null;
  return {
    host,
    port: portNumber,
    username: safeDecode(user),
    password: safeDecode(pass),
    path: normalizePath(path),
  };
}

export function composeRtspUrl(parts: RtspParts): string {
  const auth =
    parts.username !== ''
      ? `${encodeURIComponent(parts.username)}:${encodeURIComponent(parts.password)}@`
      : '';
  const port = parts.port === 554 ? '' : `:${parts.port}`;
  return `rtsp://${auth}${parts.host}${port}${normalizePath(parts.path)}`;
}

export function streamPath(camera: Pick<Camera, 'mainPath' | 'subPath' | 'channel'>, kind: StreamKind): string {
  const template = kind === 'sub' && camera.subPath !== '' ? camera.subPath : camera.mainPath;
  return resolvePathTemplate(template, camera.channel);
}

export function buildStreamUrl(
  camera: Pick<Camera, 'host' | 'rtspPort' | 'username' | 'mainPath' | 'subPath' | 'channel'>,
  password: string,
  kind: StreamKind,
): string {
  return composeRtspUrl({
    host: camera.host,
    port: camera.rtspPort,
    username: camera.username,
    password,
    path: streamPath(camera, kind),
  });
}

export function redactUrl(url: string): string {
  return url.replace(/^(rtsps?:\/\/[^:@/]*:)[^@/]*@/i, '$1•••@');
}

export function hasSubStream(camera: Pick<Camera, 'subPath'>): boolean {
  return camera.subPath.trim() !== '';
}
