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
  livePreview: boolean;
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
    unreachable: false,
  };
}

export function playableFromHub(camera: HubCamera, hub: HubInfo, reachable: boolean): PlayableCamera {
  return {
    id: hubPlayableId(camera.id),
    name: camera.name,
    brand: camera.brand,
    origin: hub.name,
    source: 'hub',
    mainUrl: camera.mainUrl,
    subUrl: camera.subUrl,
    livePreview: camera.livePreview,
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
