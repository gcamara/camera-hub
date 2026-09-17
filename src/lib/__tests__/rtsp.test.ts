import { BRANDS, resolvePathTemplate } from '../brands';
import { buildStreamUrl, composeRtspUrl, hasSubStream, normalizePath, parseRtspUrl, redactUrl, streamPath } from '../rtsp';

const camera = {
  host: '192.168.1.23',
  rtspPort: 554,
  username: 'admin',
  channel: 1,
  mainPath: '/h264Preview_{ch2}_main',
  subPath: '/h264Preview_{ch2}_sub',
};

describe('buildStreamUrl', () => {
  it('composes credentials, host and the resolved main path', () => {
    expect(buildStreamUrl(camera, 'secret', 'main')).toBe('rtsp://admin:secret@192.168.1.23/h264Preview_01_main');
  });

  it('uses the sub path for the sub stream and falls back to main when there is none', () => {
    expect(buildStreamUrl(camera, 'secret', 'sub')).toBe('rtsp://admin:secret@192.168.1.23/h264Preview_01_sub');
    expect(buildStreamUrl({ ...camera, subPath: '' }, 'secret', 'sub')).toBe('rtsp://admin:secret@192.168.1.23/h264Preview_01_main');
  });

  it('percent-encodes reserved characters in credentials', () => {
    expect(buildStreamUrl({ ...camera, username: 'me@home' }, 'p@ss/w:rd#1', 'main')).toBe(
      'rtsp://me%40home:p%40ss%2Fw%3Ard%231@192.168.1.23/h264Preview_01_main',
    );
  });

  it('omits the default port and keeps a custom one', () => {
    expect(buildStreamUrl({ ...camera, rtspPort: 8554 }, 'x', 'main')).toContain('@192.168.1.23:8554/');
    expect(buildStreamUrl({ ...camera, username: '' }, '', 'main')).toBe('rtsp://192.168.1.23/h264Preview_01_main');
  });

  it('keeps query strings in paths', () => {
    const dahua = { ...camera, mainPath: '/cam/realmonitor?channel={ch}&subtype=0', channel: 3 };
    expect(streamPath(dahua, 'main')).toBe('/cam/realmonitor?channel=3&subtype=0');
  });
});

describe('parseRtspUrl', () => {
  it('splits a full URL into parts and decodes credentials', () => {
    expect(parseRtspUrl('rtsp://me%40home:p%40ss@10.0.0.5:8554/live/ch0?x=1')).toEqual({
      host: '10.0.0.5',
      port: 8554,
      username: 'me@home',
      password: 'p@ss',
      path: '/live/ch0?x=1',
    });
  });

  it('defaults port and path', () => {
    expect(parseRtspUrl('rtsp://cam.local')).toEqual({ host: 'cam.local', port: 554, username: '', password: '', path: '/' });
  });

  it('rejects non-RTSP input', () => {
    expect(parseRtspUrl('http://example.com/stream')).toBeNull();
    expect(parseRtspUrl('rtsp://host:99999/x')).toBeNull();
    expect(parseRtspUrl('nonsense')).toBeNull();
  });

  it('round-trips through composeRtspUrl', () => {
    const url = 'rtsp://user:pa%3Ass@192.168.0.9:1554/Streaming/Channels/101';
    expect(composeRtspUrl(parseRtspUrl(url)!)).toBe(url);
  });
});

describe('helpers', () => {
  it('normalizes paths', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('  stream1 ')).toBe('/stream1');
    expect(normalizePath('/x')).toBe('/x');
  });

  it('redacts the password only', () => {
    expect(redactUrl('rtsp://admin:hunter2@1.2.3.4/live')).toBe('rtsp://admin:•••@1.2.3.4/live');
    expect(redactUrl('rtsp://1.2.3.4/live')).toBe('rtsp://1.2.3.4/live');
  });

  it('reports sub stream presence', () => {
    expect(hasSubStream({ subPath: '/sub' })).toBe(true);
    expect(hasSubStream({ subPath: '  ' })).toBe(false);
  });
});

describe('brand presets', () => {
  it('resolve channel placeholders', () => {
    expect(resolvePathTemplate('/Streaming/Channels/{ch}01', 2)).toBe('/Streaming/Channels/201');
    expect(resolvePathTemplate('/h264Preview_{ch2}_main', 7)).toBe('/h264Preview_07_main');
    expect(resolvePathTemplate('/stream1', 0)).toBe('/stream1');
  });

  it.each(BRANDS.map((b) => [b.id, b]))('%s produces a parseable main URL', (_id, brand) => {
    const url = buildStreamUrl(
      { host: '10.1.1.1', rtspPort: brand.rtspPort, username: 'u', channel: 1, mainPath: brand.mainPath, subPath: brand.subPath },
      'p',
      'main',
    );
    const parsed = parseRtspUrl(url);
    expect(parsed).not.toBeNull();
    expect(parsed!.path).not.toContain('{');
  });
});
