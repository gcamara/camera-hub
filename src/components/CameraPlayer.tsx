import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { VlcPlayerView } from '../../modules/vlc-player';

export type PlayerStatus = 'connecting' | 'buffering' | 'live' | 'error' | 'stopped';

interface CameraPlayerProps {
  uri: string;
  muted?: boolean;
  contentFit?: 'contain' | 'cover';
  /** Milliseconds without any progress from libVLC before the stream is reported as an error. */
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
  connectTimeoutMs = 25000,
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

  /**
   * Fires only after the connection has gone quiet, not after a fixed deadline:
   * a busy camera can take three times this long to hand out a session, and
   * every attempt cut short leaves a stale session behind that makes the next
   * one slower still. Each state libVLC reports is progress and starts it over.
   */
  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdog.current = setTimeout(() => {
      if (statusRef.current === 'connecting' || statusRef.current === 'buffering') {
        report('error', `No video for ${Math.round(connectTimeoutMs / 1000)} s (VLC state: ${lastStateRef.current}).`);
      }
    }, connectTimeoutMs);
  }, [clearWatchdog, connectTimeoutMs, report]);

  useEffect(() => {
    report('connecting');
    armWatchdog();
    return clearWatchdog;
  }, [uri, report, armWatchdog, clearWatchdog]);

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
        if (nativeEvent.state && nativeEvent.state !== lastStateRef.current) {
          lastStateRef.current = nativeEvent.state;
          armWatchdog();
        }
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
