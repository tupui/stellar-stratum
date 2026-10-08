import { useEffect, useState } from 'react';
import type { Horizon } from '@stellar/stellar-sdk';
import { createHorizonServer } from '@/lib/stellar';
import { baseAccountId } from '@/lib/signatures';
import { isContractAddress, isMuxedAddress, isValidPaymentDestination } from '@/lib/validation';

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
  /** A contract (C…): paid through the asset's contract, with no account to look up. */
  | { status: 'contract' }
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
    if (!isValidPaymentDestination(address)) {
      setLookup({ status: 'idle' });
      return;
    }
    if (isContractAddress(address)) {
      setLookup({ status: 'contract' });
      return;
    }
    let cancelled = false;
    setLookup({ status: 'loading' });
    const timer = setTimeout(async () => {
      try {
        // Horizon only knows accounts by their G… address.
        const account = await createHorizonServer(network).loadAccount(baseAccountId(address));
        if (cancelled) return;
        const assets: DestinationAsset[] = account.balances.flatMap((b) => {
          if (b.asset_type === 'native') return [{ code: 'XLM', balance: b.balance }];
          if ('asset_code' in b) return [{ code: b.asset_code, issuer: b.asset_issuer, balance: b.balance }];
          return [];
        });
        // A muxed address already says whose deposit this is: its ID stands in for the memo.
        setLookup({ status: 'exists', assets, memoRequired: requiresMemo(account) && !isMuxedAddress(address) });
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
