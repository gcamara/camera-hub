import type { HubCamera, HubInfo } from './hub';
import { buildStreamUrl, hasSubStream } from './rtsp';
import type { BrandId, Camera } from './types';

export type CameraSource = 'local' | 'hub';

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
  reachable: boolean,
  previewOff: boolean,
): PlayableCamera {
  return {
    id: hubPlayableId(camera.id),
    name: camera.name,
    brand: camera.brand,
    origin: hub.name,
    source: 'hub',
    mainUrl: camera.mainUrl,
    subUrl: camera.subUrl,
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
 * The grid streams a camera only when the global switch and the camera's own flag agree.
 * A hub camera the hub cannot serve is never dialled, because nothing would answer.
 */
export function shouldPreview(camera: PlayableCamera, livePreviews: boolean): boolean {
  return livePreviews && camera.livePreview && !camera.unreachable && previewUrl(camera) !== '';
}
