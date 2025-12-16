import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { pullFromRefractor } from '@/lib/stellar';
import { Transaction, Networks } from '@stellar/stellar-sdk';

interface DeepLinkHandlerProps {
  onDeepLinkLoaded?: (sourceAccount: string) => void;
}

export const DeepLinkHandler = ({ onDeepLinkLoaded }: DeepLinkHandlerProps) => {
  const location = useLocation();

  const { toast } = useToast();

  useEffect(() => {
    const handleDeepLink = async () => {
      const urlParams = new URLSearchParams(location.search);
      const refractorId = urlParams.get('r');

      if (refractorId) {
        try {
          // Pull the transaction from Refractor
          const xdr = await pullFromRefractor(refractorId);
          
          // Extract source account from XDR (try both networks)
          let sourceAccount = '';
          try {
            const tx = new Transaction(xdr, Networks.PUBLIC);
            sourceAccount = tx.source;
          } catch (e1) {
            try {
              const tx = new Transaction(xdr, Networks.TESTNET);
              sourceAccount = tx.source;
            } catch (e2) {
              throw new Error('Could not parse XDR to extract source account');
            }
          }
          
          sessionStorage.setItem('deeplink-xdr', xdr);
          sessionStorage.setItem('deeplink-refractor-id', refractorId);
          sessionStorage.setItem('deeplink-source-account', sourceAccount);

          // Notify any listeners (e.g., TransactionBuilder already mounted)
          window.dispatchEvent(new CustomEvent('deeplink:xdr-loaded', { detail: { refractorId, sourceAccount } }));
          
          toast({
            title: "Transaction Loaded",
            description: "Transaction imported from Refractor. Loading account data...",
            duration: 5000,
          });

          // Clear the URL parameter to clean up the address bar
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete('r');
          window.history.replaceState({}, '', newUrl.toString());
          
          // Notify parent component that deep link was loaded with source account
          onDeepLinkLoaded?.(sourceAccount);
          
        } catch (error) {
          toast({
            title: "Failed to Load Transaction",
            description: error instanceof Error ? error.message : "Could not import transaction from Refractor",
            variant: "destructive",
            duration: 5000,
          });
        }
      }
    };

    handleDeepLink();
  }, [location.search, toast, onDeepLinkLoaded]);

  return null; // This component doesn't render anything
};