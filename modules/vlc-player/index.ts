import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

type NativeEvent<T> = { nativeEvent: T };

/** libVLC state name as reported by the native side; useful in diagnostics. */
export type VlcState = 'opening' | 'buffering' | 'playing' | 'stopped' | 'ended' | 'error' | 'invalid';

export interface VlcPlayerViewProps extends ViewProps {
  uri?: string;
  muted?: boolean;
  paused?: boolean;
  contentFit?: 'contain' | 'cover';
  onPlaying?: (event: NativeEvent<Record<string, never>>) => void;
  onBuffering?: (event: NativeEvent<{ isBuffering: boolean; state?: VlcState }>) => void;
  onError?: (event: NativeEvent<{ message: string; state?: VlcState }>) => void;
  onStopped?: (event: NativeEvent<{ state?: VlcState }>) => void;
  onPaused?: (event: NativeEvent<Record<string, never>>) => void;
}

interface VlcPlayerNativeModule {
  getLog(): Promise<string[]>;
  clearLog(): void;
}

/** Native view backed by libVLC (MobileVLCKit on iOS, libvlc-all on Android); see modules/vlc-player. */
export const VlcPlayerView: ComponentType<VlcPlayerViewProps> = requireNativeViewManager('VlcPlayer');

const nativeModule = requireNativeModule<VlcPlayerNativeModule>('VlcPlayer');

/** The last few hundred libVLC log lines, for diagnosing a stream that will not start. */
export function getVlcLog(): Promise<string[]> {
  return nativeModule.getLog();
}

export function clearVlcLog(): void {
  nativeModule.clearLog();
}
