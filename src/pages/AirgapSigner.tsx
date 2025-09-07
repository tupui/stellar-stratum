import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Smartphone } from 'lucide-react';
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

  // Removed online/offline indicator and listeners

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
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          <span className="text-foreground font-medium">Air‑gapped signing</span> lets you approve transactions on an offline device. This page blocks network requests for safety.
        </p>
        <div className="grid gap-1">
          <p className="text-foreground font-medium">What you need</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>Device A (online): build the transaction and display its QR</li>
            <li>Device B (offline): this page to scan and sign</li>
          </ul>
        </div>
        <div className="grid gap-1">
          <p className="text-foreground font-medium">Steps</p>
          <ol className="list-decimal pl-5 text-muted-foreground">
            <li>Scan the transaction QR below.</li>
            <li>Review details and add signatures on this device.</li>
            <li>Show the Signature QR back to Device A to merge and submit.</li>
          </ol>
        </div>
        <div className="grid gap-1">
          <p className="text-foreground font-medium">Safety tips</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>Compare the transaction fingerprint on both devices before signing.</li>
            <li>Keep this device offline for the entire flow.</li>
          </ul>
        </div>
      </div>

      <AnimatedQRScanner
        onDataReceived={handleXdrReceived}
        expectedType="xdr"
        embedded
      />
    </div>
  );

  const renderLoadedStep = () => {
    return (
      <div className="space-y-6">
        {/* Advanced Transaction Details - Expanded by default */}
        <XdrDetails xdr={xdr} defaultExpanded={true} />

        <div className="p-3 border border-border/50 rounded-lg text-sm">
          <p className="font-medium text-foreground">Verify before signing</p>
          <p className="text-muted-foreground">
            Compare the transaction fingerprint and key fields on both devices.
            They must match exactly before you add your signature.
          </p>
        </div>

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

        
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/50 to-stellar-yellow/5 relative overflow-hidden">
      {/* Subtle background pattern */}
      {/* Background decorations removed */}

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
              {step === 'loaded' && (
                <Button 
                  onClick={() => setStep('scan')}
                  size="sm"
                  className="self-start bg-success hover:bg-success/90 text-success-foreground"
                >
                  Back to Scanner
                </Button>
              )}
            </div>
            
            <div className="flex items-center gap-3 flex-wrap" />
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