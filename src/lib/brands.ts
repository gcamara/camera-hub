import type { BrandId } from './types';

export interface BrandPreset {
  id: BrandId;
  label: string;
  /** Path template. `{ch}` is the channel number, `{ch2}` the same zero-padded to two digits. */
  mainPath: string;
  subPath: string;
  rtspPort: number;
  onvifPort: number;
  usesChannel: boolean;
  hint?: string;
}

export const BRANDS: BrandPreset[] = [
  {
    id: 'generic',
    label: 'Generic RTSP',
    mainPath: '/',
    subPath: '',
    rtspPort: 554,
    onvifPort: 80,
    usesChannel: false,
    hint: 'Type the stream path exactly as your camera documents it.',
  },
  {
    id: 'hikvision',
    label: 'Hikvision / Annke / HiLook',
    mainPath: '/Streaming/Channels/{ch}01',
    subPath: '/Streaming/Channels/{ch}02',
    rtspPort: 554,
    onvifPort: 80,
    usesChannel: true,
  },
  {
    id: 'dahua',
    label: 'Dahua / Amcrest / Lorex / Imou',
    mainPath: '/cam/realmonitor?channel={ch}&subtype=0',
    subPath: '/cam/realmonitor?channel={ch}&subtype=1',
    rtspPort: 554,
    onvifPort: 80,
    usesChannel: true,
  },
  {
    id: 'reolink',
    label: 'Reolink',
    mainPath: '/h264Preview_{ch2}_main',
    subPath: '/h264Preview_{ch2}_sub',
    rtspPort: 554,
    onvifPort: 8000,
    usesChannel: true,
    hint: 'Newer models encode the main stream in H.265; the sub stream is always H.264.',
  },
  {
    id: 'tapo',
    label: 'TP-Link Tapo',
    mainPath: '/stream1',
    subPath: '/stream2',
    rtspPort: 554,
    onvifPort: 2020,
    usesChannel: false,
    hint: 'Use the "Camera Account" created in the Tapo app, not your TP-Link login.',
  },
  {
    id: 'wyze',
    label: 'Wyze (RTSP firmware)',
    mainPath: '/live',
    subPath: '',
    rtspPort: 554,
    onvifPort: 80,
    usesChannel: false,
  },
  {
    id: 'ubiquiti',
    label: 'Ubiquiti UniFi (standalone)',
    mainPath: '/s0',
    subPath: '/s2',
    rtspPort: 554,
    onvifPort: 80,
    usesChannel: false,
  },
  {
    id: 'axis',
    label: 'Axis',
    mainPath: '/axis-media/media.amp',
    subPath: '/axis-media/media.amp?resolution=640x360',
    rtspPort: 554,
    onvifPort: 80,
    usesChannel: false,
  },
  {
    id: 'foscam',
    label: 'Foscam',
    mainPath: '/videoMain',
    subPath: '/videoSub',
    rtspPort: 88,
    onvifPort: 888,
    usesChannel: false,
  },
  {
    id: 'uniview',
    label: 'Uniview',
    mainPath: '/media/video1',
    subPath: '/media/video2',
    rtspPort: 554,
    onvifPort: 80,
    usesChannel: false,
  },
  {
    id: 'eufy',
    label: 'Eufy (RTSP enabled)',
    mainPath: '/live0',
    subPath: '/live1',
    rtspPort: 554,
    onvifPort: 80,
    usesChannel: false,
  },
  {
    id: 'onvif',
    label: 'Discovered via ONVIF',
    mainPath: '/',
    subPath: '',
    rtspPort: 554,
    onvifPort: 80,
    usesChannel: false,
  },
];

export function getBrand(id: BrandId): BrandPreset {
  return BRANDS.find((b) => b.id === id) ?? BRANDS[0]!;
}

export function isBrandId(value: string | undefined): value is BrandId {
  return BRANDS.some((b) => b.id === value);
}

export function resolvePathTemplate(template: string, channel: number): string {
  const ch = Math.max(1, Math.floor(channel) || 1);
  return template.replace(/\{ch2\}/g, String(ch).padStart(2, '0')).replace(/\{ch\}/g, String(ch));
}

const MANUFACTURER_PATTERNS: Array<[RegExp, BrandId]> = [
  [/tp-?link|tapo/i, 'tapo'],
  [/reolink/i, 'reolink'],
  [/hikvision|hik-?vision|annke|hilook|ezviz/i, 'hikvision'],
  [/dahua|amcrest|lorex|imou/i, 'dahua'],
  [/axis/i, 'axis'],
  [/foscam/i, 'foscam'],
  [/uniview|\bunv\b/i, 'uniview'],
  [/ubiquiti|unifi/i, 'ubiquiti'],
  [/wyze/i, 'wyze'],
  [/eufy|anker/i, 'eufy'],
];

/** Maps the Manufacturer string an ONVIF GetDeviceInformation returns onto a preset; 'onvif' when unknown. */
export function brandFromManufacturer(manufacturer: string | undefined): BrandId {
  if (!manufacturer) return 'onvif';
  const hit = MANUFACTURER_PATTERNS.find(([pattern]) => pattern.test(manufacturer));
  return hit ? hit[1] : 'onvif';
}
