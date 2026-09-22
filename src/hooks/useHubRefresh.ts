import { useEffect } from 'react';

import { useAppActive } from './useVisibility';
import { useHubStore } from '@/store/hubStore';

/**
 * Pulls the hub list once the store is hydrated and again every time the app returns to the
 * foreground, which is when a hub that was out of reach — asleep phone, tailnet down — is
 * worth asking again. It rides the app-state listener `useAppActive` already owns.
 */
export function useHubRefresh(): void {
  const active = useAppActive();
  const hydrated = useHubStore((state) => state.hydrated);
  const connected = useHubStore((state) => state.baseUrl !== '');
  const refresh = useHubStore((state) => state.refresh);

  useEffect(() => {
    if (!hydrated || !connected || !active) return;
    void refresh();
  }, [active, hydrated, connected, refresh]);
}
