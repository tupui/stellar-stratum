import { useEffect, useRef } from 'react';
import { getTransactionHashFromXdr, type NetworkId } from '@/lib/xdr/parse';

/**
 * Reload the account whenever a different transaction comes up for review. The review checks
 * the transaction's sequence number against the account's, and a co-signer may have used one
 * since the account was loaded. Signatures do not change the hash, so signing does not reload.
 */
export const useRefreshOnNewTransaction = (xdr: string, network: NetworkId, refresh?: () => Promise<void>) => {
  const hash = xdr ? getTransactionHashFromXdr(xdr, network) : '';
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!hash) return;
    refreshRef.current?.().catch(() => {
      // The review then compares against the last known state.
    });
  }, [hash]);
};
