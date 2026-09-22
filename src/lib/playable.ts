import { normalizeBaseUrl, type HubCamera, type HubInfo } from './hub';
import { buildStreamUrl, hasSubStream } from './rtsp';
import type { BrandId, Camera } from './types';

export type CameraSource = 'local' | 'hub';

/**
 * Where a hub camera's streams are read from, and by what. This is the single seam where the
 * app decides what each platform plays; every screen downstream reads `mainUrl`/`subUrl`
 * and never asks which platform it is on.
 *
 * Both play the hub's fragmented MP4 over HTTP. A phone does not use the hub's RTSP: iOS
 * VLCKit's bundled live555 (2016) idles ~10 s between DESCRIBE and the first SETUP, and
 * go2rtc closes an RTSP connection after 5 s of silence (not configurable), so the video
 * SETUP always lands on a dead connection and only the audio track survives a reconnect.
 */
export interface HubStreamContext {
  /** The hub's origin, as the hub store normalised it. */
  baseUrl: string;
  /** True in a browser, which authenticates the stream with the hub's session cookie. */
  web: boolean;
  /**
   * The hub's API token. libVLC cannot add a header to a request, so a phone carries it
   * as the Basic password in the URL, which the hub accepts on its stream route only.
   */
  token: string;
}

/**
 * The hub sends a root-relative path because only the client knows which origin it reached
 * the hub on. Resolving it against the hub's own base URL rather than `location` gives the
 * same answer in the deployment this is built for — the hub serves the page too — and keeps
 * a development build on another port pointed at the hub instead of at itself.
 */
export function resolveWebUrl(baseUrl: string, path: string): string {
  if (path === '') return '';
  const origin = normalizeBaseUrl(baseUrl);
  return origin === '' ? '' : `${origin}${path}`;
}

/**
 * The URL this platform can actually play. A browser gets an empty string when the hub
 * offered no web stream, which reads downstream exactly like a camera with no sub stream:
 * nothing is dialled and the tile says why.
 */
export function hubStreamUrl(rtspUrl: string, webPath: string, context: HubStreamContext): string {
  const http = resolveWebUrl(context.baseUrl, webPath);
  if (context.web) return http;
  // A hub too old to offer web streams still has RTSP; that is better than nothing.
  if (http === '' || context.token === '') return rtspUrl;
  return http.replace(/^(https?:\/\/)/, `$1hub:${encodeURIComponent(context.token)}@`);
}

/**
 * One camera the app can play, whether it is saved on this phone or served by the hub.
 * The grid and the viewer read this and never care which of the two it came from.
 */
export interface PlayableCamera {
  id: string;
  name: string;
  brand: BrandId;
  /** Where the camera answers: its own host for a local camera, the hub's name for a hub camera. */
  origin: string;
  source: CameraSource;
  mainUrl: string;
  /** Empty when there is only one quality; the grid then plays the main stream. */
  subUrl: string;
  /** The effective answer, after both the hub's setting and this phone's own. */
  livePreview: boolean;
  /**
   * The hub itself keeps this camera out of the grid — usually because it tolerates a
   * single viewer — and this phone cannot switch it back on. A phone may only subtract.
   */
  previewVetoed: boolean;
  /**
   * The hub did not answer. A hub camera has no fallback: the app holds none of its
   * credentials, only go2rtc's, so there is nothing to connect to directly.
   */
  unreachable: boolean;
}

const HUB_PREFIX = 'hub-';

/** Hub ids are the hub's own strings; the prefix keeps them from colliding with a local camera's UUID. */
export function hubPlayableId(hubCameraId: string): string {
  return `${HUB_PREFIX}${hubCameraId}`;
}

/** The hub's own id again, for talking back to the hub store about one of its cameras. */
export function hubCameraId(playableId: string): string {
  return playableId.startsWith(HUB_PREFIX) ? playableId.slice(HUB_PREFIX.length) : playableId;
}

export function playableFromCamera(camera: Camera, password: string): PlayableCamera {
  return {
    id: camera.id,
    name: camera.name,
    brand: camera.brand,
    origin: camera.host,
    source: 'local',
    mainUrl: buildStreamUrl(camera, password, 'main'),
    subUrl: hasSubStream(camera) ? buildStreamUrl(camera, password, 'sub') : '',
    livePreview: camera.livePreview,
    previewVetoed: false,
    unreachable: false,
  };
}

/**
 * `previewOff` is this phone's own choice, which may only turn a preview off: whether a
 * camera can afford a second viewer is the hub's to know, but whether you want it on
 * your grid is yours, and the two answers belong to different devices.
 */
export function playableFromHub(
  camera: HubCamera,
  hub: HubInfo,
  context: HubStreamContext,
  reachable: boolean,
  previewOff: boolean,
): PlayableCamera {
  return {
    id: hubPlayableId(camera.id),
    name: camera.name,
    brand: camera.brand,
    origin: hub.name,
    source: 'hub',
    mainUrl: hubStreamUrl(camera.mainUrl, camera.mainWebUrl, context),
    subUrl: hubStreamUrl(camera.subUrl, camera.subWebUrl, context),
    livePreview: camera.livePreview && !previewOff,
    previewVetoed: !camera.livePreview,
    unreachable: !reachable,
  };
}

/** The stream the grid plays: the sub stream when there is one, so the main stream stays free. */
export function previewUrl(camera: PlayableCamera): string {
  return camera.subUrl !== '' ? camera.subUrl : camera.mainUrl;
}

/**
 * Whether there is anything at all to dial. In a browser this is false for a hub camera the
 * hub restreams only over RTSP, which is a camera that exists and is reachable and still
 * cannot be shown here — a third thing to say, and not the same as "offline".
 */
export function hasStream(camera: PlayableCamera): boolean {
  return previewUrl(camera) !== '';
}

/**
 * The grid streams a camera only when the global switch and the camera's own flag agree.
 * A hub camera the hub cannot serve is never dialled, because nothing would answer.
 */
export function shouldPreview(camera: PlayableCamera, livePreviews: boolean): boolean {
  return livePreviews && camera.livePreview && !camera.unreachable && hasStream(camera);
}
