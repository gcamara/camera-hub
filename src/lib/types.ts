export type StreamKind = 'main' | 'sub';

export type BrandId =
  | 'generic'
  | 'hikvision'
  | 'dahua'
  | 'reolink'
  | 'tapo'
  | 'wyze'
  | 'ubiquiti'
  | 'axis'
  | 'foscam'
  | 'uniview'
  | 'eufy'
  | 'onvif';

export interface OnvifInfo {
  port: number;
  manufacturer?: string;
  model?: string;
  mainProfile?: string;
  subProfile?: string;
}

export interface Camera {
  id: string;
  name: string;
  brand: BrandId;
  host: string;
  rtspPort: number;
  username: string;
  channel: number;
  /** RTSP path (may include a query string) for the full-resolution stream. */
  mainPath: string;
  /** RTSP path for the low-resolution stream; empty string when the camera has none. */
  subPath: string;
  /** Off for a camera that tolerates a single RTSP session, so the grid leaves it to the viewer. */
  livePreview: boolean;
  onvif?: OnvifInfo;
  createdAt: number;
}

export type CameraInput = Omit<Camera, 'id' | 'createdAt'>;

export interface Settings {
  columns: 1 | 2 | 3;
  livePreviews: boolean;
  keepAwake: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  columns: 1,
  livePreviews: true,
  keepAwake: false,
};
