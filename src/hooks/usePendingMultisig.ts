import { useEffect, useState } from 'react';
import { listPendingTx, PendingMultisigTx } from '@/lib/multisig-store';

/**
 * Reactive hook to get the list of pending multisig envelopes from localStorage.
 * It listens to storage events and polls every 10s to stay fresh across tabs.
 */
export const usePendingMultisig = () => {
  const [pending, setPending] = useState<PendingMultisigTx[]>(() => listPendingTx());

  useEffect(() => {
    const handle = () => setPending(listPendingTx());
    // Storage event from other tabs
    window.addEventListener('storage', handle);
    // Polling fallback (some browsers don’t fire storage in same tab)
    const interval = setInterval(handle, 10_000);
    return () => {
      window.removeEventListener('storage', handle);
      clearInterval(interval);
    };
  }, []);

  return {
    pending,
    count: pending.length,
  };
};
