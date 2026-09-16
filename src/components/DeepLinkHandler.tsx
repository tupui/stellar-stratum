import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { pullFromRefractor } from '@/lib/stellar';
import { Transaction, Networks } from '@stellar/stellar-sdk';
import { useNetwork } from '@/contexts/NetworkContext';

interface DeepLinkHandlerProps {
  onDeepLinkLoaded?: (sourceAccount: string) => void;
}

export const DeepLinkHandler = ({ onDeepLinkLoaded }: DeepLinkHandlerProps) => {
  const location = useLocation();
  const { toast } = useToast();
  const { setNetwork } = useNetwork();
  // The ?r= param stays in the address bar so the link remains shareable, so guard on the
  // id itself instead of relying on the param disappearing to stop a second import.
  const handledRefractorId = useRef<string | null>(null);

  useEffect(() => {
    const handleDeepLink = async () => {
      const urlParams = new URLSearchParams(location.search);
      const refractorId = urlParams.get('r');

      if (refractorId && handledRefractorId.current !== refractorId) {
        handledRefractorId.current = refractorId;
        try {
          // Pull the transaction from Refractor
          const xdr = await pullFromRefractor(refractorId);

          // Extract source account; detect which network the XDR belongs to and align UI
          let sourceAccount = '';
          let detectedNetwork: 'mainnet' | 'testnet' | null = null;
          try {
            const tx = new Transaction(xdr, Networks.PUBLIC);
            sourceAccount = tx.source;
            detectedNetwork = 'mainnet';
          } catch {
            try {
              const tx = new Transaction(xdr, Networks.TESTNET);
              sourceAccount = tx.source;
              detectedNetwork = 'testnet';
            } catch {
              throw new Error('Could not parse XDR to extract source account');
            }
          }

          // Align UI network to the XDR's network so signing/submission don't mismatch
          if (detectedNetwork) {
            setNetwork(detectedNetwork);
          }

          sessionStorage.setItem('deeplink-xdr', xdr);
          sessionStorage.setItem('deeplink-refractor-id', refractorId);
          sessionStorage.setItem('deeplink-source-account', sourceAccount);

          // Notify any listeners (e.g., TransactionBuilder already mounted)
          window.dispatchEvent(new CustomEvent('deeplink:xdr-loaded', { detail: { refractorId, sourceAccount } }));

          toast({
            title: 'Transaction Loaded',
            description: 'Transaction imported from Refractor. Loading account data...',
            duration: 5000,
          });

          // Notify parent component that deep link was loaded with source account
          onDeepLinkLoaded?.(sourceAccount);
        } catch (error) {
          toast({
            title: 'Failed to Load Transaction',
            description: error instanceof Error ? error.message : 'Could not import transaction from Refractor',
            variant: 'destructive',
            duration: 5000,
          });
        }
      }
    };

    handleDeepLink();
  }, [location.search, toast, onDeepLinkLoaded, setNetwork]);

  return null;
};
