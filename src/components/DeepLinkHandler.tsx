import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { pullFromRefractor } from '@/lib/stellar';
import { baseAccountId } from '@/lib/signatures';
import { getInnerTransaction, tryParseTransaction, type NetworkId } from '@/lib/xdr/parse';
import { useNetwork } from '@/contexts/NetworkContext';

interface DeepLinkHandlerProps {
  onDeepLinkLoaded?: (sourceAccount: string, network: NetworkId) => void;
}

export const DeepLinkHandler = ({ onDeepLinkLoaded }: DeepLinkHandlerProps) => {
  const location = useLocation();
  const { toast } = useToast();
  const { setNetwork } = useNetwork();
  // The ?r= param stays in the address bar so the link remains shareable, so guard on the
  // id itself instead of relying on the param disappearing to stop a second import.
  const handledRefractorId = useRef<string | null>(null);

  useEffect(() => {
    const refractorId = new URLSearchParams(location.search).get('r');
    if (!refractorId || handledRefractorId.current === refractorId) return;
    handledRefractorId.current = refractorId;

    const handleDeepLink = async () => {
      try {
        // Refractor records which network the transaction was posted for; the XDR itself
        // does not say, and signing it for the wrong network would produce useless signatures.
        const { xdr, network } = await pullFromRefractor(refractorId);
        const parsed = tryParseTransaction(xdr, network);
        if (!parsed) throw new Error('Could not read the transaction from Refractor');
        const sourceAccount = baseAccountId(getInnerTransaction(parsed.tx).source);

        setNetwork(network, { fromLink: true });
        sessionStorage.setItem('deeplink-xdr', xdr);
        sessionStorage.setItem('deeplink-refractor-id', refractorId);
        sessionStorage.setItem('deeplink-source-account', sourceAccount);

        // Notify any listeners (e.g., TransactionBuilder already mounted)
        window.dispatchEvent(new CustomEvent('deeplink:xdr-loaded', { detail: { refractorId, sourceAccount } }));

        toast({
          title: 'Transaction Loaded',
          description: `Transaction imported from Refractor (${network === 'testnet' ? 'Testnet' : 'Mainnet'}). Loading account data...`,
          duration: 5000,
        });

        onDeepLinkLoaded?.(sourceAccount, network);
      } catch (error) {
        toast({
          title: 'Failed to Load Transaction',
          description: error instanceof Error ? error.message : 'Could not import transaction from Refractor',
          variant: 'destructive',
          duration: 5000,
        });
      }
    };

    handleDeepLink();
  }, [location.search, toast, onDeepLinkLoaded, setNetwork]);

  return null;
};
