import { useEffect, useState } from 'react';
import type { Horizon } from '@stellar/stellar-sdk';
import { createHorizonServer } from '@/lib/stellar';
import { isValidPublicKey } from '@/lib/validation';

export interface DestinationAsset {
  code: string;
  issuer?: string;
  balance: string;
}

export type DestinationLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  /** The account does not exist yet: only a createAccount with XLM can reach it. */
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'exists'; assets: DestinationAsset[]; memoRequired: boolean };

/** SEP-29: exchanges flag deposit accounts that cannot credit a payment without a memo. */
const requiresMemo = (account: Horizon.AccountResponse) => {
  const value = account.data_attr?.['config.memo_required'];
  return value !== undefined && atob(value) === '1';
};

const isNotFound = (error: unknown) => {
  const err = error as { name?: string; response?: { status?: number } };
  return err?.name === 'NotFoundError' || err?.response?.status === 404;
};

/** Look a payment destination up on the user's configured Horizon, debounced while typing. */
export const useDestinationAccount = (destination: string, network: 'mainnet' | 'testnet'): DestinationLookup => {
  const [lookup, setLookup] = useState<DestinationLookup>({ status: 'idle' });

  useEffect(() => {
    const address = destination.trim();
    if (!isValidPublicKey(address)) {
      setLookup({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setLookup({ status: 'loading' });
    const timer = setTimeout(async () => {
      try {
        const account = await createHorizonServer(network).loadAccount(address);
        if (cancelled) return;
        const assets: DestinationAsset[] = account.balances.flatMap((b) => {
          if (b.asset_type === 'native') return [{ code: 'XLM', balance: b.balance }];
          if ('asset_code' in b) return [{ code: b.asset_code, issuer: b.asset_issuer, balance: b.balance }];
          return [];
        });
        setLookup({ status: 'exists', assets, memoRequired: requiresMemo(account) });
      } catch (error) {
        if (cancelled) return;
        setLookup(
          isNotFound(error)
            ? { status: 'missing' }
            : { status: 'error', message: 'Could not check the destination account. Check your connection and try again.' },
        );
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [destination, network]);

  return lookup;
};
