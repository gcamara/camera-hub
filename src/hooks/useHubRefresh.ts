import { useEffect } from 'react';

import { useAppActive } from './useVisibility';
import { useHubStore } from '@/store/hubStore';

/**
 * How often a browser that never leaves the foreground renews its stream cookie. The hub
 * issues it for 12 h, and a camera wall on a desktop can stay visible far longer than that;
 * without renewal every tile would start failing with a 401 that no reconnect can cure. The
 * cookie is httpOnly, so its real expiry is unreadable here — renewing well inside it is the
 * only safe answer, and one small POST an hour costs nothing.
 */
const SESSION_RENEW_MS = 60 * 60 * 1000;

/**
 * Pulls the hub list once the store is hydrated and again every time the app returns to the
 * foreground, which is when a hub that was out of reach — asleep phone, tailnet down — is
 * worth asking again. It rides the app-state listener `useAppActive` already owns; in a
 * browser that listener follows the tab's visibility.
 *
 * The same moments are when a browser asks for its stream cookie: the one it had may have
 * expired while the tab was hidden, and a tile that starts playing before the cookie exists
 * gets a 401 it cannot retry its way out of. `openSession` returns at once on a phone, so this
 * stays one code path for both platforms.
 */
export function useHubRefresh(): void {
  const active = useAppActive();
  const hydrated = useHubStore((state) => state.hydrated);
  const connected = useHubStore((state) => state.baseUrl !== '');
  const refresh = useHubStore((state) => state.refresh);
  const openSession = useHubStore((state) => state.openSession);

  useEffect(() => {
    if (!hydrated || !connected || !active) return;
    void openSession();
    void refresh();
    const renew = setInterval(() => void openSession(), SESSION_RENEW_MS);
    return () => clearInterval(renew);
  }, [active, hydrated, connected, refresh, openSession]);
}
