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
import { AnimatedQR } from '@/components/airgap/AnimatedQR';
import { AnimatedQRScanner } from '@/components/airgap/AnimatedQRScanner';
import { XdrDetails } from '@/components/XdrDetails';
import { SignerSelector } from '@/components/SignerSelector';
import { TransactionSummary } from '@/components/TransactionSummary';
import { generateDetailedFingerprint } from '@/lib/xdr/fingerprint';
import { useNetwork } from '@/contexts/NetworkContext';
import { useToast } from '@/hooks/use-toast';
import { extractXdrFromData } from '@/lib/sep7';
import { tryParseTransaction } from '@/lib/xdr/parse';

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
      const extractedXdr = extractXdrFromData(decodeURIComponent(xdrParam));
      if (extractedXdr) {
        // Validate XDR before setting
        const parsed = tryParseTransaction(extractedXdr);
        if (parsed) {
          setXdr(extractedXdr);
          setStep('review');
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

  const renderReviewStep = () => (
    <div className="space-y-6">
      {/* Transaction Summary - Always visible */}
      <TransactionSummary xdr={xdr} />

      {/* Detailed XDR Information - Collapsed by default */}
      <XdrDetails xdr={xdr} />

      <div className="flex flex-col sm:flex-row gap-3">
        <Button 
          variant="outline" 
          onClick={() => setStep('scan')}
          className="flex-1"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button 
          onClick={() => setStep('sign')}
          className="flex-1"
          size="lg"
        >
          Sign Transaction
          <ArrowRight className="w-4 h-4 ml-2" />
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
            className="px-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>
      </div>
    );
  };

  const renderShareStep = () => {
    const signaturePayload = signedXdr || '';

    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded-full text-sm font-medium mb-4">
            <CheckCircle2 className="w-4 h-4" />
            Transaction Signed Successfully
          </div>
        </div>

        <AnimatedQR
          data={signaturePayload}
          type="xdr"
          embedded
        />

        <div className="text-sm text-muted-foreground text-center">
          Share this QR code with the transaction coordinator
        </div>

        <div className="flex justify-center">
          <Button 
            onClick={() => {
              setXdr('');
              setSignedXdr('');
              setStep('scan');
            }}
            className="px-8"
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
                <p className="text-sm text-muted-foreground">
                  {step === 'scan' && 'Ready to scan transaction'}
                  {step === 'review' && 'Review transaction details'}
                  {step === 'sign' && 'Sign with your wallet'}
                  {step === 'share' && 'Share signed transaction'}
                </p>
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