import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Wifi, 
  WifiOff, 
  QrCode, 
  Users, 
  Shield, 
  ArrowRight, 
  CheckCircle2,
  AlertCircle,
  ExternalLink
} from 'lucide-react';
import { AnimatedQR } from './AnimatedQR';
import { AnimatedQRScanner } from './AnimatedQRScanner';
import { generateTransactionFingerprint } from '@/lib/xdr/fingerprint';
import { hasRequiredSignatures } from '@/lib/xdr/signature-merge';
import { useNetwork } from '@/contexts/NetworkContext';

interface AirgapModeProps {
  xdr: string;
  requiredWeight: number;
  signers: Array<{ key: string; weight: number; type: string }>;
  onSignatureReceived: (signedXdr: string) => void;
  signedBy: Array<{ signerKey: string; signedAt: Date }>;
}

type AirgapStep = 'overview' | 'share-transaction' | 'collect-signatures' | 'complete';

export const AirgapMode = ({
  xdr,
  requiredWeight,
  signers,
  onSignatureReceived,
  signedBy
}: AirgapModeProps) => {
  const { network } = useNetwork();
  const [currentStep, setCurrentStep] = useState<AirgapStep>('overview');
  const [collectedSignatures, setCollectedSignatures] = useState<string[]>([]);

  const fingerprint = generateTransactionFingerprint(xdr, network);
  const { hasRequired, currentWeight } = hasRequiredSignatures(
    xdr, 
    requiredWeight, 
    signers, 
    network
  );

  const handleSignatureReceived = (signedXdr: string) => {
    setCollectedSignatures(prev => [...prev, signedXdr]);
    onSignatureReceived(signedXdr);
    
    // Check if we have enough signatures
    const updatedHasRequired = hasRequiredSignatures(
      signedXdr, 
      requiredWeight, 
      signers, 
      network
    ).hasRequired;
    
    if (updatedHasRequired) {
      setCurrentStep('complete');
    }
  };

  const openSignerPage = () => {
    const signerUrl = `${window.location.origin}/sign?xdr=${encodeURIComponent(xdr)}&network=${network}`;
    window.open(signerUrl, '_blank');
  };

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="p-4 bg-primary/10 rounded-full">
            <WifiOff className="w-8 h-8 text-primary" />
          </div>
        </div>
        
        <div>
          <h3 className="text-lg font-semibold">Air-Gapped Signing Mode</h3>
          <p className="text-sm text-muted-foreground">
            Coordinate signatures without internet connectivity using QR codes
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <QrCode className="w-6 h-6 text-primary" />
          </div>
          <h4 className="font-medium">1. Share Transaction</h4>
          <p className="text-xs text-muted-foreground">
            Display QR code for signing devices
          </p>
        </div>

        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <h4 className="font-medium">2. Collect Signatures</h4>
          <p className="text-xs text-muted-foreground">
            Scan QR codes from signing devices
          </p>
        </div>

        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <h4 className="font-medium">3. Submit Transaction</h4>
          <p className="text-xs text-muted-foreground">
            Broadcast when signatures are complete
          </p>
        </div>
      </div>

      <div className="p-4 bg-secondary/50 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-primary mt-0.5" />
          <div className="space-y-2">
            <h4 className="font-medium">Transaction Fingerprint</h4>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {fingerprint}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Verify this matches on all signing devices
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          onClick={openSignerPage}
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Open Signer Page
        </Button>
        
        <Button onClick={() => setCurrentStep('share-transaction')}>
          Begin Coordination
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );

  const renderShareTransaction = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Share Transaction</h3>
        <p className="text-sm text-muted-foreground">
          Display this QR code to signing devices
        </p>
      </div>

      <AnimatedQR
        data={xdr}
        type="xdr"
        title="Transaction XDR"
        description="Scan this with your signing device"
      />

      <div className="flex gap-3">
        <Button 
          variant="outline" 
          onClick={() => setCurrentStep('overview')}
          className="flex-1"
        >
          Back
        </Button>
        <Button 
          onClick={() => setCurrentStep('collect-signatures')}
          className="flex-1"
        >
          Collect Signatures
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );

  const renderCollectSignatures = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Collect Signatures</h3>
        <p className="text-sm text-muted-foreground">
          Scan QR codes from signing devices
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnimatedQRScanner
          onDataReceived={handleSignatureReceived}
          expectedType="signature"
          title="Scan Signed Transaction"
          description="Point camera at signed QR codes"
        />

        <div className="space-y-4">
          <div>
            <h4 className="font-medium mb-2">Signature Progress</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Current Weight:</span>
                <Badge variant={hasRequired ? "default" : "secondary"}>
                  {currentWeight} / {requiredWeight}
                </Badge>
              </div>
              
              {hasRequired && (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <CheckCircle2 className="w-4 h-4" />
                  Signature threshold met!
                </div>
              )}
            </div>
          </div>

          {signedBy.length > 0 && (
            <div>
              <h4 className="font-medium mb-2">Signed By ({signedBy.length})</h4>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {signedBy.map((signature, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-3 h-3 text-primary" />
                    <span className="font-mono text-xs">
                      {signature.signerKey.substring(0, 8)}...{signature.signerKey.slice(-8)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Button 
          variant="outline" 
          onClick={() => setCurrentStep('share-transaction')}
          className="flex-1"
        >
          Back to Share
        </Button>
        
        {hasRequired && (
          <Button 
            onClick={() => setCurrentStep('complete')}
            className="flex-1"
          >
            Complete
            <CheckCircle2 className="w-4 h-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );

  const renderComplete = () => (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="p-4 bg-primary/10 rounded-full">
          <CheckCircle2 className="w-8 h-8 text-primary" />
        </div>
      </div>
      
      <div>
        <h3 className="text-lg font-semibold">Signatures Complete!</h3>
        <p className="text-sm text-muted-foreground">
          Transaction has met the required signature threshold
        </p>
      </div>

      <div className="p-4 bg-primary/10 rounded-lg">
        <div className="text-sm space-y-1">
          <p><strong>Final Weight:</strong> {currentWeight} / {requiredWeight}</p>
          <p><strong>Signatures:</strong> {signedBy.length}</p>
          <p><strong>Fingerprint:</strong> <code>{fingerprint}</code></p>
        </div>
      </div>

      <Button 
        onClick={() => setCurrentStep('overview')}
        variant="outline"
      >
        Start New Session
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <WifiOff className="w-5 h-5" />
              Air-Gapped Coordination
            </CardTitle>
            <CardDescription>
              Offline multisig coordination via QR codes
            </CardDescription>
          </div>
          
          <Badge variant="outline">
            Step {currentStep === 'overview' ? 1 : 
                  currentStep === 'share-transaction' ? 2 :
                  currentStep === 'collect-signatures' ? 3 : 4} of 4
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {currentStep === 'overview' && renderOverview()}
        {currentStep === 'share-transaction' && renderShareTransaction()}
        {currentStep === 'collect-signatures' && renderCollectSignatures()}
        {currentStep === 'complete' && renderComplete()}
      </CardContent>
    </Card>
  );
};