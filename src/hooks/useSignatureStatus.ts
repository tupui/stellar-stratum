import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAccountData, type AccountData } from '@/lib/stellar';
import { tryParseTransaction, type NetworkId } from '@/lib/xdr/parse';
import { computeSignatureStatus, involvedAccounts, type AccountAuth, type SignerInfo } from '@/lib/signatures';

/**
 * Signature status of an envelope. The account the user is working with is passed in; the
 * signers of any other account the transaction involves (an imported transaction for another
 * account, an operation with its own source) are loaded from Horizon.
 */
export const useSignatureStatus = (xdr: string, network: NetworkId, account: AccountData | null) => {
  const parsed = useMemo(() => tryParseTransaction(xdr, network), [xdr, network]);
  const accountIds = useMemo(() => (parsed ? involvedAccounts(parsed.tx) : []), [parsed]);
  const missingKey = accountIds.filter((id) => id !== account?.publicKey).join(',');

  // Keyed by network and account so switching networks never mixes signer sets. A failed
  // lookup is stored as null: the account then shows as unknown instead of loading forever.
  const [fetched, setFetched] = useState<Record<string, AccountData | null>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    for (const id of missingKey ? missingKey.split(',') : []) {
      const key = `${network}:${id}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      fetchAccountData(id, network)
        .catch(() => null)
        .then((data) => setFetched((prev) => ({ ...prev, [key]: data })));
    }
  }, [missingKey, network]);

  return useMemo(() => {
    const key = (id: string) => `${network}:${id}`;
    const accounts = new Map<string, AccountAuth>();
    if (account) accounts.set(account.publicKey, account);
    for (const id of accountIds) {
      const data = fetched[key(id)];
      if (data) accounts.set(id, data);
    }

    // Everyone who can contribute a signature, listed once.
    const signers = new Map<string, SignerInfo>();
    for (const id of accountIds) {
      for (const signer of accounts.get(id)?.signers ?? []) {
        if (signer.weight > 0 && !signers.has(signer.key)) signers.set(signer.key, signer);
      }
    }

    return {
      parsed,
      status: parsed ? computeSignatureStatus(parsed.tx, accounts) : null,
      loading: accountIds.some((id) => id !== account?.publicKey && !(key(id) in fetched)),
      signers: [...signers.values()],
    };
  }, [parsed, account, accountIds, fetched, network]);
};
