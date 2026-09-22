import type { HubCamera, HubInfo } from '../hub';
import { playableFromCamera, playableFromHub, previewUrl, shouldPreview, type PlayableCamera } from '../playable';
import type { Camera } from '../types';

const local: Camera = {
  id: 'local-1',
  name: 'Front door',
  brand: 'reolink',
  host: '192.168.1.20',
  rtspPort: 554,
  username: 'viewer',
  channel: 1,
  mainPath: '/h264Preview_01_main',
  subPath: '/h264Preview_01_sub',
  livePreview: true,
  createdAt: 0,
};

const hub: HubInfo = { name: 'Attic hub', version: '0.4.1' };

const hubCamera: HubCamera = {
  id: 'garage',
  name: 'Garage',
  brand: 'dahua',
  livePreview: true,
  mainUrl: 'rtsp://go2rtc:placeholder@hub.lan:8654/garage',
  subUrl: 'rtsp://go2rtc:placeholder@hub.lan:8654/garage_sub',
  ptz: false,
};

describe('playableFromCamera', () => {
  it('builds both stream URLs from the saved camera and its password', () => {
    const playable = playableFromCamera(local, 'placeholder');
    expect(playable.mainUrl).toBe('rtsp://viewer:placeholder@192.168.1.20/h264Preview_01_main');
    expect(playable.subUrl).toBe('rtsp://viewer:placeholder@192.168.1.20/h264Preview_01_sub');
    expect(playable.origin).toBe('192.168.1.20');
    expect(playable.source).toBe('local');
    expect(playable.unreachable).toBe(false);
  });

  it('leaves the sub URL empty when the camera has no sub stream', () => {
    expect(playableFromCamera({ ...local, subPath: '' }, 'placeholder').subUrl).toBe('');
  });

  it('carries the per-camera preview flag', () => {
    expect(playableFromCamera({ ...local, livePreview: false }, '').livePreview).toBe(false);
  });
});

describe('playableFromHub', () => {
  it('namespaces the hub id and shows the hub as the origin', () => {
    const playable = playableFromHub(hubCamera, hub, true);
    expect(playable.id).toBe('hub-garage');
    expect(playable.origin).toBe('Attic hub');
    expect(playable.source).toBe('hub');
    expect(playable.unreachable).toBe(false);
  });

  it('marks the camera unreachable when the hub did not answer', () => {
    expect(playableFromHub(hubCamera, hub, false).unreachable).toBe(true);
  });
});

describe('previewUrl', () => {
  it('prefers the sub stream and falls back to the main one', () => {
    expect(previewUrl(playableFromHub(hubCamera, hub, true))).toBe(hubCamera.subUrl);
    expect(previewUrl(playableFromHub({ ...hubCamera, subUrl: '' }, hub, true))).toBe(hubCamera.mainUrl);
  });
});

describe('shouldPreview', () => {
  const playable = playableFromHub(hubCamera, hub, true);

  it('streams only when the global switch and the camera agree', () => {
    const matrix: Array<[boolean, boolean, boolean]> = [
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [false, false, false],
    ];
    for (const [livePreviews, livePreview, expected] of matrix) {
      expect(shouldPreview({ ...playable, livePreview }, livePreviews)).toBe(expected);
    }
  });

  it('never dials a hub camera the hub cannot serve', () => {
    expect(shouldPreview({ ...playable, unreachable: true }, true)).toBe(false);
  });

  it('never dials a camera with nothing to play', () => {
    const empty: PlayableCamera = { ...playable, mainUrl: '', subUrl: '' };
    expect(shouldPreview(empty, true)).toBe(false);
  });
});
