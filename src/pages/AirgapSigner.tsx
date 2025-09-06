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
  ArrowLeft
} from 'lucide-react';
import { AnimatedQR } from '@/components/airgap/AnimatedQR';
import { AnimatedQRScanner } from '@/components/airgap/AnimatedQRScanner';
import { XdrDetails } from '@/components/XdrDetails';
import { SignerSelector } from '@/components/SignerSelector';
import { generateDetailedFingerprint } from '@/lib/xdr/fingerprint';
import { createSignaturePayload } from '@/lib/xdr/chunking';
import { useNetwork } from '@/contexts/NetworkContext';
import { useToast } from '@/hooks/use-toast';

export const AirgapSigner = () => {
  const { network, setNetwork } = useNetwork();
  const { toast } = useToast();
  const [xdr, setXdr] = useState<string>('');
  const [signedXdr, setSignedXdr] = useState<string>('');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [step, setStep] = useState<'scan' | 'review' | 'sign' | 'share'>('scan');

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
      setXdr(decodeURIComponent(xdrParam));
      setStep('review');
    }
    
    if (networkParam) {
      setNetwork(networkParam);
    }
  }, [setNetwork]);

  const handleXdrReceived = (receivedXdr: string) => {
    setXdr(receivedXdr);
    setStep('review');
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
      // Mock signed XDR for demonstration - in real implementation this would come from wallet
      const mockSignedXdr = xdr + '_SIGNED';
      setSignedXdr(mockSignedXdr);
      setStep('share');
      toast({
        title: 'Transaction Signed',
        description: 'Ready to share via QR code',
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
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="p-4 bg-stellar-yellow/10 rounded-full border border-stellar-yellow/20">
            <QrCode className="w-12 h-12 text-stellar-yellow" />
          </div>
        </div>
        
        <div className="space-y-2">
          <h2 className="text-xl md:text-2xl font-bold">Ready to Scan</h2>
          <p className="text-muted-foreground text-lg">
            Point your camera at the transaction QR code
          </p>
        </div>
      </div>

      <AnimatedQRScanner
        onDataReceived={handleXdrReceived}
        expectedType="xdr"
        title="Scan Transaction QR"
        description="Position QR code within the frame"
      />
    </div>
  );

  const renderReviewStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="p-4 bg-stellar-yellow/10 rounded-full border border-stellar-yellow/20">
            <Shield className="w-12 h-12 text-stellar-yellow" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-xl md:text-2xl font-bold">Review Transaction</h2>
          <p className="text-muted-foreground text-lg">
            Verify all details before proceeding to sign
          </p>
        </div>
      </div>

      <XdrDetails xdr={xdr} />

      <div className="flex flex-col sm:flex-row gap-3">
        <Button 
          variant="outline" 
          onClick={() => setStep('scan')}
          className="flex-1 py-3 border-stellar-yellow/30 text-stellar-yellow hover:bg-stellar-yellow/10"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Scan
        </Button>
        <Button 
          onClick={() => setStep('sign')}
          className="flex-1 py-3 bg-stellar-yellow text-black hover:bg-stellar-yellow/90"
        >
          Proceed to Sign
          <Shield className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );

  const renderSignStep = () => {
    // Mock account data for signing interface
    const mockAccountData = {
      balances: [],
      signers: [
        { key: 'SIGNER_KEY_1', weight: 1, type: 'ed25519_public_key' },
        { key: 'SIGNER_KEY_2', weight: 1, type: 'ed25519_public_key' },
      ],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }
    };

    return (
      <div className="space-y-6">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-4 bg-stellar-yellow/10 rounded-full border border-stellar-yellow/20">
              <Smartphone className="w-12 h-12 text-stellar-yellow" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl md:text-2xl font-bold">Sign Transaction</h2>
            <p className="text-muted-foreground text-lg">
              Connect your wallet to complete the signing process
            </p>
          </div>
        </div>

        <SignerSelector
          xdr={xdr}
          signers={mockAccountData.signers}
          currentAccountKey="MOCK_ACCOUNT_KEY"
          signedBy={[]}
          requiredWeight={1}
          onSignWithSigner={handleSignWithSigner}
          isSigning={false}
        />

        <div className="flex justify-center">
          <Button 
            variant="outline" 
            onClick={() => setStep('review')}
            className="px-6 py-3 border-stellar-yellow/30 text-stellar-yellow hover:bg-stellar-yellow/10"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Review
          </Button>
        </div>
      </div>
    );
  };

  const renderShareStep = () => {
    const signaturePayload = signedXdr ? JSON.stringify(createSignaturePayload(
      'SIGNER_KEY', // Would be actual signer key
      signedXdr
    )) : '';

    return (
      <div className="space-y-6">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-4 bg-stellar-yellow/10 rounded-full border border-stellar-yellow/20">
              <CheckCircle2 className="w-16 h-16 text-stellar-yellow" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl md:text-2xl font-bold">Transaction Signed!</h2>
            <p className="text-muted-foreground text-lg">
              Share this QR code with the transaction coordinator
            </p>
          </div>
        </div>

        <AnimatedQR
          data={signaturePayload}
          type="signature"
          title="Signed Transaction"
          description="Scan this QR to add signature to coordinator"
        />

        <div className="text-center space-y-6">
          <div className="bg-stellar-yellow/10 border border-stellar-yellow/20 rounded-xl p-4">
            <div className="flex items-center justify-center gap-2 text-stellar-yellow">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Ready to share with coordinator</span>
            </div>
          </div>

          <Button 
            onClick={() => {
              setXdr('');
              setSignedXdr('');
              setStep('scan');
            }}
            className="px-8 py-3 bg-stellar-yellow text-black hover:bg-stellar-yellow/90"
          >
            Sign Another Transaction
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
                <p className="text-sm text-muted-foreground">Secure offline transaction signing</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className="bg-stellar-yellow/10 text-stellar-yellow border-stellar-yellow/30">
                {isOffline ? <WifiOff className="w-3 h-3 mr-1" /> : <Wifi className="w-3 h-3 mr-1" />}
                {isOffline ? 'Offline' : 'Online'}
              </Badge>
              <div className="relative bg-muted/50 backdrop-blur-sm rounded-full p-0.5 flex border border-border/50">
                <button
                  onClick={() => setNetwork('mainnet')}
                  className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all ${network === 'mainnet' ? 'bg-success text-success-foreground shadow-lg shadow-success/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'}`}
                >
                  Mainnet
                </button>
                <button
                  onClick={() => setNetwork('testnet')}
                  className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all ${network === 'testnet' ? 'bg-success text-success-foreground shadow-lg shadow-success/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'}`}
                >
                  Testnet
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-2xl mx-auto">
            <div className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-2xl shadow-xl">
                <div className="p-4 md:p-6">
                {step === 'scan' && renderScanStep()}
                {step === 'review' && renderReviewStep()}
                {step === 'sign' && renderSignStep()}
                {step === 'share' && renderShareStep()}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AirgapSigner;