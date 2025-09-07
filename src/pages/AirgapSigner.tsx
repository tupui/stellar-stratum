import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Smartphone, 
  QrCode, 
  Shield, 
  CheckCircle2, 
  AlertCircle, 
  Wifi,
  WifiOff,
  ArrowLeft,
  ArrowRight
} from 'lucide-react';
import { AnimatedQRScanner } from '@/components/airgap/AnimatedQRScanner';
import { XdrDetails } from '@/components/XdrDetails';
import { SignerSelector } from '@/components/SignerSelector';
import { TransactionSubmitter } from '@/components/transaction/TransactionSubmitter';
import { SuccessModal } from '@/components/SuccessModal';
import { generateDetailedFingerprint } from '@/lib/xdr/fingerprint';
import { useNetwork } from '@/contexts/NetworkContext';
import { useToast } from '@/hooks/use-toast';
import { extractXdrFromData } from '@/lib/sep7';
import { tryParseTransaction } from '@/lib/xdr/parse';
import { signWithWallet } from '@/lib/walletKit';

export const AirgapSigner = () => {
  const { network, setNetwork } = useNetwork();
  const { toast } = useToast();
  const [xdr, setXdr] = useState<string>('');
  const [signedBy, setSignedBy] = useState<Array<{ signerKey: string; signedAt: Date }>>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [step, setStep] = useState<'scan' | 'loaded'>('scan');
  const [successData, setSuccessData] = useState<{ hash: string; network: 'mainnet' | 'testnet'; type: 'offline'; xdr?: string } | null>(null);

  // Disable network features for true air-gapped operation
  useEffect(() => {
    // Disable service workers
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => registration.unregister());
      });
    }
    
    // Block network requests for security
    const originalFetch = window.fetch;
    const originalXHR = window.XMLHttpRequest;
    
    window.fetch = () => Promise.reject(new Error('Network requests disabled in air-gapped mode'));
    window.XMLHttpRequest = function() {
      throw new Error('Network requests disabled in air-gapped mode');
    } as any;
    
    return () => {
      window.fetch = originalFetch;
      window.XMLHttpRequest = originalXHR;
    };
  }, []);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check URL parameters for XDR
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const xdrParam = urlParams.get('xdr');
    const networkParam = urlParams.get('network') as 'mainnet' | 'testnet';
    
    if (xdrParam) {
      const extractedXdr = extractXdrFromData(decodeURIComponent(xdrParam));
      if (extractedXdr) {
        // Validate XDR before setting
        const parsed = tryParseTransaction(extractedXdr);
        if (parsed) {
          setXdr(extractedXdr);
          setStep('loaded');
        } else {
          toast({
            title: 'Invalid URL Parameter',
            description: 'The XDR in the URL is not a valid transaction.',
            variant: 'destructive',
          });
        }
      }
    }
    
    if (networkParam) {
      setNetwork(networkParam);
    }
  }, [setNetwork, toast]);

  const handleXdrReceived = (receivedXdr: string) => {
    console.log('XDR received:', receivedXdr);
    
    // Validate XDR
    const parsed = tryParseTransaction(receivedXdr);
    if (!parsed) {
      toast({
        title: 'Invalid Transaction',
        description: 'Invalid transaction payload. Ensure it\'s a SEP-7 tx QR or base64 XDR.',
        variant: 'destructive',
      });
      return;
    }
    
    setXdr(receivedXdr);
    setStep('loaded');
    toast({
      title: 'Transaction Received',
      description: 'Ready for review and signing',
    });
  };

  const handleSignWithSigner = async (
    signerKey: string,
    walletId: string
  ) => {
    try {
      // Actually sign the transaction with the wallet
      const { signedXdr, address } = await signWithWallet(xdr, walletId, network);
      
      // Update the XDR with the new signature
      setXdr(signedXdr);
      
      // Add signature to signedBy array using the actual wallet address
      const newSignature = { signerKey: address, signedAt: new Date() };
      setSignedBy(prev => [...prev, newSignature]);
      
      toast({
        title: 'Transaction Signed',
        description: `Signature added from ${address.slice(0, 8)}...${address.slice(-8)}`,
      });
    } catch (error) {
      toast({
        title: 'Signing Failed',
        description: error instanceof Error ? error.message : 'Failed to sign transaction',
        variant: 'destructive',
      });
    }
  };

  const fingerprint = xdr ? generateDetailedFingerprint(xdr, network) : null;

  const renderScanStep = () => (
    <div className="space-y-6">
      <AnimatedQRScanner
        onDataReceived={handleXdrReceived}
        expectedType="xdr"
        embedded
      />
      <div className="text-sm text-muted-foreground text-center">
        Scan a transaction QR code to begin
      </div>
    </div>
  );

  const renderLoadedStep = () => {
    return (
      <div className="space-y-6">
        {/* Advanced Transaction Details - Expanded by default */}
        <XdrDetails xdr={xdr} defaultExpanded={true} />

        {/* Signature Management - Use free mode for air-gapped signing */}
        <SignerSelector
          xdr={xdr}
          signers={[]} // No predefined signers needed in free mode
          currentAccountKey=""
          signedBy={signedBy}
          requiredWeight={0} // Not relevant in free mode
          onSignWithSigner={handleSignWithSigner}
          isSigning={false}
          freeMode={true}
        />

        {/* Transaction Submitter - Offline only mode */}
        <TransactionSubmitter
          xdrOutput={xdr}
          signedBy={signedBy}
          currentWeight={0} // Not relevant for offline
          requiredWeight={0} // Not relevant for offline
          canSubmitToNetwork={false}
          canSubmitToRefractor={false}
          isSubmittingToNetwork={false}
          isSubmittingToRefractor={false}
          successData={null}
          onCopyXdr={() => {}}
          onSubmitToNetwork={async () => {}}
          onSubmitToRefractor={async () => {}}
          onShowOfflineModal={() => {
            const fingerprint = generateDetailedFingerprint(xdr, network);
            setSuccessData({ 
              type: 'offline', 
              hash: fingerprint.hash, 
              network,
              xdr
            });
          }}
          copied={false}
          offlineOnly={true}
        />

        <div className="flex justify-center">
          <Button 
            variant="outline" 
            onClick={() => setStep('scan')}
            className="px-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Scanner
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/50 to-stellar-yellow/5 relative overflow-hidden">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute top-20 right-10 w-32 h-32 border border-stellar-yellow/20 rounded-full"></div>
        <div className="absolute bottom-32 left-10 w-24 h-24 border border-stellar-yellow/10 rounded-full"></div>
        <div className="absolute top-1/2 left-1/3 w-16 h-16 border border-stellar-yellow/15 rounded-full"></div>
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="p-4 md:p-6 border-b border-border/50 bg-background/80 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-stellar-yellow/10 rounded-xl">
                <Smartphone className="w-6 h-6 text-stellar-yellow" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Air-Gapped Signer</h1>
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className="bg-stellar-yellow/10 text-stellar-yellow border-stellar-yellow/30">
                {isOffline ? <WifiOff className="w-3 h-3 mr-1" /> : <Wifi className="w-3 h-3 mr-1" />}
                {isOffline ? 'Offline' : 'Online'}
              </Badge>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-2xl mx-auto">
            <div className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-2xl shadow-xl">
                <div className="p-4 md:p-6">
                {step === 'scan' && renderScanStep()}
                {step === 'loaded' && renderLoadedStep()}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Success Modal */}
      {successData && (
        <SuccessModal
          type={successData.type}
          hash={successData.hash}
          xdr={successData.xdr}
          network={successData.network}
          onClose={() => setSuccessData(null)}
        />
      )}
    </div>
  );
};

export default AirgapSigner;