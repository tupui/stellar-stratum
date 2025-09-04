import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { pullFromRefractor } from '@/lib/stellar';

interface DeepLinkHandlerProps {
  onDeepLinkLoaded?: () => void;
}

export const DeepLinkHandler = ({ onDeepLinkLoaded }: DeepLinkHandlerProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const handleDeepLink = async () => {
      const urlParams = new URLSearchParams(location.search);
      const refractorId = urlParams.get('r');

      if (refractorId) {
        try {
          // Pull the transaction from Refractor
          const xdr = await pullFromRefractor(refractorId);
          
          sessionStorage.setItem('deeplink-xdr', xdr);
          sessionStorage.setItem('deeplink-refractor-id', refractorId);

          // Notify any listeners (e.g., TransactionBuilder already mounted)
          window.dispatchEvent(new CustomEvent('deeplink:xdr-loaded', { detail: { refractorId } }));
          
          toast({
            title: "Transaction Loaded",
            description: "Transaction imported from Refractor. You can now review and sign it.",
            duration: 5000,
          });

          // Clear the URL parameter to clean up the address bar
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete('r');
          window.history.replaceState({}, '', newUrl.toString());
          
          // Notify parent component that deep link was loaded
          onDeepLinkLoaded?.();
          
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
  }, [location.search, toast]);

  return null; // This component doesn't render anything
};