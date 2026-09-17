import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { VlcPlayerView } from '../../modules/vlc-player';

export type PlayerStatus = 'connecting' | 'buffering' | 'live' | 'error' | 'stopped';

interface CameraPlayerProps {
  uri: string;
  muted?: boolean;
  contentFit?: 'contain' | 'cover';
  /** Milliseconds without a frame before the stream is reported as an error. */
  connectTimeoutMs?: number;
  onStatus?: (status: PlayerStatus, detail?: string) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Thin adapter over the local VlcPlayer Expo module. Remount it (change its `key`)
 * to reconnect; the native view starts playing as soon as it receives a URI.
 */
export function CameraPlayer({
  uri,
  muted = true,
  contentFit = 'contain',
  connectTimeoutMs = 20000,
  onStatus,
  style,
}: CameraPlayerProps) {
  const statusRef = useRef<PlayerStatus>('connecting');
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const detailRef = useRef<string | undefined>(undefined);
  const lastStateRef = useRef<string>('none');

  const report = useCallback((status: PlayerStatus, detail?: string) => {
    if (statusRef.current === status && detailRef.current === detail && status !== 'error') return;
    statusRef.current = status;
    detailRef.current = detail;
    onStatusRef.current?.(status, detail);
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdog.current) {
      clearTimeout(watchdog.current);
      watchdog.current = null;
    }
  }, []);

  useEffect(() => {
    report('connecting');
    watchdog.current = setTimeout(() => {
      if (statusRef.current === 'connecting' || statusRef.current === 'buffering') {
        report('error', `No video after ${Math.round(connectTimeoutMs / 1000)} s (VLC state: ${lastStateRef.current}).`);
      }
    }, connectTimeoutMs);
    return clearWatchdog;
  }, [uri, connectTimeoutMs, report, clearWatchdog]);

  return (
    <VlcPlayerView
      uri={uri}
      muted={muted}
      contentFit={contentFit}
      style={[styles.view, style]}
      onPlaying={() => {
        lastStateRef.current = 'playing';
        clearWatchdog();
        report('live');
      }}
      onBuffering={({ nativeEvent }) => {
        lastStateRef.current = nativeEvent.state ?? lastStateRef.current;
        if (!nativeEvent.isBuffering || statusRef.current === 'live') return;
        report('buffering', nativeEvent.state === 'opening' ? 'Opening stream…' : 'Buffering…');
      }}
      onError={({ nativeEvent }) => {
        clearWatchdog();
        report('error', nativeEvent.message);
      }}
      onStopped={({ nativeEvent }) => {
        clearWatchdog();
        report('error', nativeEvent.state === 'ended' ? 'The stream ended.' : 'The camera closed the stream.');
      }}
      onPaused={() => report('stopped')}
    />
  );
}

const styles = StyleSheet.create({
  view: { backgroundColor: '#000000' },
});
