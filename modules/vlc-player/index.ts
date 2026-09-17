import { requireNativeViewManager } from 'expo-modules-core';
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

/** Native view backed by MobileVLCKit; see modules/vlc-player/ios. iOS only. */
export const VlcPlayerView: ComponentType<VlcPlayerViewProps> = requireNativeViewManager('VlcPlayer');
