import { requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

type NativeEvent<T> = { nativeEvent: T };

export interface VlcPlayerViewProps extends ViewProps {
  uri?: string;
  muted?: boolean;
  paused?: boolean;
  contentFit?: 'contain' | 'cover';
  onPlaying?: (event: NativeEvent<Record<string, never>>) => void;
  onBuffering?: (event: NativeEvent<{ isBuffering: boolean }>) => void;
  onError?: (event: NativeEvent<{ message: string }>) => void;
  onStopped?: (event: NativeEvent<Record<string, never>>) => void;
  onPaused?: (event: NativeEvent<Record<string, never>>) => void;
}

/** Native view backed by MobileVLCKit; see modules/vlc-player/ios. iOS only. */
export const VlcPlayerView: ComponentType<VlcPlayerViewProps> = requireNativeViewManager('VlcPlayer');
