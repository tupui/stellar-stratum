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
          <div className="p-4 bg-primary/10 rounded-full">
            <QrCode className="w-8 h-8 text-primary" />
          </div>
        </div>
        
        <div>
          <h2 className="text-2xl font-bold">Air-Gapped Signer</h2>
          <p className="text-muted-foreground">
            Scan QR code to receive transaction for signing
          </p>
        </div>
      </div>

      <AnimatedQRScanner
        onDataReceived={handleXdrReceived}
        expectedType="xdr"
        title="Scan Transaction QR"
        description="Point camera at transaction QR code"
      />

      <div className="text-center">
        <Button
          variant="outline"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Go Back
        </Button>
      </div>
    </div>
  );

  const renderReviewStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Review Transaction</h2>
        <p className="text-muted-foreground">
          Verify transaction details before signing
        </p>
      </div>

      {/* Transaction details without redundant fingerprint */}
      <XdrDetails xdr={xdr} />

      <div className="flex gap-3">
        <Button 
          variant="outline" 
          onClick={() => setStep('scan')}
          className="flex-1"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Scan
        </Button>
        <Button 
          onClick={() => setStep('sign')}
          className="flex-1"
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
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Sign Transaction</h2>
          <p className="text-muted-foreground">
            Connect your wallet to sign this transaction
          </p>
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

        <div className="flex gap-3">
          <Button 
            variant="outline" 
            onClick={() => setStep('review')}
            className="flex-1"
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
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Share Signed Transaction</h2>
          <p className="text-muted-foreground">
            Display this QR code to the coordinator
          </p>
        </div>

        <div className="flex justify-center">
          <CheckCircle2 className="w-16 h-16 text-primary" />
        </div>

        <AnimatedQR
          data={signaturePayload}
          type="signature"
          title="Signed Transaction"
          description="Scan this QR to add signature to coordinator"
        />

        <div className="text-center space-y-4">
          <Alert>
            <CheckCircle2 className="w-4 h-4" />
            <AlertDescription>
              Transaction successfully signed! Share this QR code with the transaction coordinator.
            </AlertDescription>
          </Alert>

          <Button 
            onClick={() => {
              setXdr('');
              setSignedXdr('');
              setStep('scan');
            }}
          >
            Sign Another Transaction
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Main Content */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-stellar-yellow/10 rounded-lg">
                  <Smartphone className="w-6 h-6 text-stellar-yellow" />
                </div>
                <div>
                  <CardTitle>Air-Gapped Signing Device</CardTitle>
                  <CardDescription>
                    Secure offline transaction signing
                  </CardDescription>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Badge variant={isOffline ? "default" : "outline"} className="bg-stellar-yellow/10 text-stellar-yellow border-stellar-yellow/30">
                  {isOffline ? <WifiOff className="w-3 h-3 mr-1" /> : <Wifi className="w-3 h-3 mr-1" />}
                  {isOffline ? 'Offline' : 'Online'}
                </Badge>
                <Badge variant="secondary">
                  {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {step === 'scan' && renderScanStep()}
            {step === 'review' && renderReviewStep()}
            {step === 'sign' && renderSignStep()}
            {step === 'share' && renderShareStep()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AirgapSigner;