import { createElement, useEffect, useRef, type ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { VlcPlayerViewProps } from './index';

export type { VlcPlayerViewProps, VlcState } from './index';

/**
 * Browser stand-in for the native VLC view. Browsers cannot play RTSP, so this
 * walks the same state sequence (opening → buffering → playing) on a timer and
 * says so on screen, which lets every screen around the player be exercised on web.
 */
export const VlcPlayerView: ComponentType<VlcPlayerViewProps> = function VlcPlayerViewWeb({
  uri,
  style,
  onBuffering,
  onPlaying,
  onError,
}) {
  // Callbacks live in a ref so a parent re-render (which every state report
  // causes) does not restart the timeline; only a new URI does.
  const handlers = useRef({ onBuffering, onPlaying, onError });
  handlers.current = { onBuffering, onPlaying, onError };

  useEffect(() => {
    if (!uri) return;
    if (!/^rtsps?:\/\//i.test(uri)) {
      handlers.current.onError?.({ nativeEvent: { message: 'Invalid stream URL', state: 'invalid' } });
      return;
    }
    const timers = [
      setTimeout(() => handlers.current.onBuffering?.({ nativeEvent: { isBuffering: true, state: 'opening' } }), 200),
      setTimeout(() => handlers.current.onBuffering?.({ nativeEvent: { isBuffering: true, state: 'buffering' } }), 900),
      setTimeout(() => {
        handlers.current.onBuffering?.({ nativeEvent: { isBuffering: false, state: 'playing' } });
        handlers.current.onPlaying?.({ nativeEvent: {} });
      }, 1600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [uri]);

  return createElement(
    View,
    { style: [styles.box, style] },
    createElement(Text, { style: styles.label }, 'SIMULATED · RTSP is not playable in a browser'),
  );
};

const styles = StyleSheet.create({
  box: { backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' },
  label: { color: '#8A8A8A', fontSize: 11, letterSpacing: 0.4, textAlign: 'center', padding: 8 },
});
