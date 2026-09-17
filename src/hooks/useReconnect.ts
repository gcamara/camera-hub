import { useCallback, useEffect, useRef, useState } from 'react';

import type { PlayerStatus } from '@/components/CameraPlayer';

// Cameras hold an abandoned RTSP session for their session timeout (15 s on a Tapo
// C200) and refuse new ones until it lapses, so a retry any sooner just queues
// behind the session the failed attempt left behind.
const RETRY_BASE_MS = 8000;
const RETRY_MAX_MS = 60000;

export interface ReconnectState {
  status: PlayerStatus;
  detail?: string;
  /** Seconds until the next automatic attempt, or null when not waiting. */
  retryIn: number | null;
  /** Changes on every attempt; use it as the player's `key` to force a fresh connection. */
  attempt: number;
  handleStatus: (status: PlayerStatus, detail?: string) => void;
  retryNow: () => void;
}

/** Exponential back-off reconnect loop driven by CameraPlayer status events. */
export function useReconnect(enabled: boolean): ReconnectState {
  const [status, setStatus] = useState<PlayerStatus>('connecting');
  const [detail, setDetail] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const failures = useRef(0);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; fire?: ReturnType<typeof setTimeout> }>({});

  const clearTimers = useCallback(() => {
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.fire) clearTimeout(timers.current.fire);
    timers.current = {};
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const retryNow = useCallback(() => {
    clearTimers();
    setRetryIn(null);
    setDetail(undefined);
    setStatus('connecting');
    setAttempt((n) => n + 1);
  }, [clearTimers]);

  const handleStatus = useCallback(
    (next: PlayerStatus, nextDetail?: string) => {
      setStatus(next);
      setDetail(nextDetail);
      if (next === 'live') failures.current = 0;
      if (next !== 'error' || !enabled) return;
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** failures.current);
      failures.current += 1;
      const deadline = Date.now() + delay;
      clearTimers();
      setRetryIn(Math.ceil(delay / 1000));
      timers.current.tick = setInterval(
        () => setRetryIn(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
        1000,
      );
      timers.current.fire = setTimeout(retryNow, delay);
    },
    [enabled, clearTimers, retryNow],
  );

  const wasEnabled = useRef(enabled);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      setRetryIn(null);
      setStatus('stopped');
    } else if (!wasEnabled.current) {
      // Re-enabled after a pause. The player was unmounted while disabled, so the
      // remount that comes with `enabled` is already a fresh connection; bumping
      // `attempt` here would replace that player within the same frame and leave
      // the first one streaming with no view.
      failures.current = 0;
      setDetail(undefined);
      setStatus('connecting');
    }
    wasEnabled.current = enabled;
  }, [enabled, clearTimers]);

  return { status, detail, retryIn, attempt, handleStatus, retryNow };
}
