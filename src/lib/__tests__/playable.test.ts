import type { HubCamera, HubInfo } from '../hub';
import {
  hasStream,
  hubStreamUrl,
  playableFromCamera,
  playableFromHub,
  previewUrl,
  resolveWebUrl,
  shouldPreview,
  type HubStreamContext,
  type PlayableCamera,
} from '../playable';
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
  mainWebUrl: '/stream/garage/main.mp4',
  subWebUrl: '/stream/garage/sub.mp4',
  ptz: false,
};

const phone: HubStreamContext = { baseUrl: 'http://hub.lan:8080', web: false };
const browser: HubStreamContext = { baseUrl: 'http://hub.lan:8080', web: true };

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
    const playable = playableFromHub(hubCamera, hub, phone, true, false);
    expect(playable.id).toBe('hub-garage');
    expect(playable.origin).toBe('Attic hub');
    expect(playable.source).toBe('hub');
    expect(playable.unreachable).toBe(false);
  });

  it('marks the camera unreachable when the hub did not answer', () => {
    expect(playableFromHub(hubCamera, hub, phone, false, false).unreachable).toBe(true);
  });

  it("lets this phone turn a preview off without claiming the hub did", () => {
    const off = playableFromHub(hubCamera, hub, phone, true, true);
    expect(off.livePreview).toBe(false);
    expect(off.previewVetoed).toBe(false);
  });

  it('keeps a preview the hub vetoed off, whatever this phone says', () => {
    const vetoed = { ...hubCamera, livePreview: false };
    for (const previewOff of [false, true]) {
      const playable = playableFromHub(vetoed, hub, phone, true, previewOff);
      expect(playable.livePreview).toBe(false);
      expect(playable.previewVetoed).toBe(true);
    }
  });
});

describe('resolveWebUrl', () => {
  it('hangs the hub path off the hub origin', () => {
    expect(resolveWebUrl('http://hub.lan:8080', '/stream/garage/main.mp4')).toBe(
      'http://hub.lan:8080/stream/garage/main.mp4',
    );
  });

  it('normalises the origin it is given', () => {
    expect(resolveWebUrl('hub.lan:8080/', '/stream/garage/main.mp4')).toBe('http://hub.lan:8080/stream/garage/main.mp4');
  });

  it('resolves to nothing without a path or without a hub', () => {
    expect(resolveWebUrl('http://hub.lan:8080', '')).toBe('');
    expect(resolveWebUrl('', '/stream/garage/main.mp4')).toBe('');
  });
});

describe('hubStreamUrl', () => {
  it('gives a phone the RTSP URL and a browser the resolved web URL', () => {
    expect(hubStreamUrl('rtsp://hub.lan/garage', '/stream/garage/main.mp4', phone)).toBe('rtsp://hub.lan/garage');
    expect(hubStreamUrl('rtsp://hub.lan/garage', '/stream/garage/main.mp4', browser)).toBe(
      'http://hub.lan:8080/stream/garage/main.mp4',
    );
  });

  it('never hands a browser an RTSP URL it cannot play', () => {
    expect(hubStreamUrl('rtsp://hub.lan/garage', '', browser)).toBe('');
  });
});

describe('playableFromHub on web', () => {
  it('plays the hub’s browser streams instead of its RTSP ones', () => {
    const playable = playableFromHub(hubCamera, hub, browser, true, false);
    expect(playable.mainUrl).toBe('http://hub.lan:8080/stream/garage/main.mp4');
    expect(playable.subUrl).toBe('http://hub.lan:8080/stream/garage/sub.mp4');
    expect(hasStream(playable)).toBe(true);
  });

  it('leaves a camera the hub serves over RTSP only with nothing to play', () => {
    const rtspOnly = { ...hubCamera, mainWebUrl: '', subWebUrl: '' };
    const playable = playableFromHub(rtspOnly, hub, browser, true, false);
    expect(playable.mainUrl).toBe('');
    expect(playable.subUrl).toBe('');
    expect(hasStream(playable)).toBe(false);
    // Reachable and not vetoed, and still never dialled: there is no URL to dial.
    expect(playable.unreachable).toBe(false);
    expect(shouldPreview(playable, true)).toBe(false);
  });

  it('falls back to the main web stream when the hub restreams one quality', () => {
    const single = { ...hubCamera, subUrl: '', subWebUrl: '' };
    expect(previewUrl(playableFromHub(single, hub, browser, true, false))).toBe(
      'http://hub.lan:8080/stream/garage/main.mp4',
    );
  });
});

describe('previewUrl', () => {
  it('prefers the sub stream and falls back to the main one', () => {
    expect(previewUrl(playableFromHub(hubCamera, hub, phone, true, false))).toBe(hubCamera.subUrl);
    expect(previewUrl(playableFromHub({ ...hubCamera, subUrl: '', subWebUrl: '' }, hub, phone, true, false))).toBe(hubCamera.mainUrl);
  });
});

describe('shouldPreview', () => {
  const playable = playableFromHub(hubCamera, hub, phone, true, false);

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
