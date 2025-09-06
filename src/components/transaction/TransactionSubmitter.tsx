import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Copy, ExternalLink, Wifi, WifiOff } from 'lucide-react';
import { NetworkSelector } from '@/components/NetworkSelector';
import { XdrDetails } from '@/components/XdrDetails';
import { AnimatedQR } from '@/components/airgap/AnimatedQR';
import { useNetwork } from '@/contexts/NetworkContext';
import { generateDetailedFingerprint } from '@/lib/xdr/fingerprint';

interface TransactionSubmitterProps {
  xdrOutput: string;
  signedBy: Array<{ signerKey: string; signedAt: Date }>;
  currentWeight: number;
  requiredWeight: number;
  canSubmitToNetwork: boolean;
  canSubmitToRefractor: boolean;
  isSubmittingToNetwork: boolean;
  isSubmittingToRefractor: boolean;
  successData: { hash: string; network: 'mainnet' | 'testnet' } | null;
  onCopyXdr: () => void;
  onSubmitToNetwork: () => Promise<void>;
  onSubmitToRefractor: () => Promise<void>;
  copied: boolean;
}

export const TransactionSubmitter = ({ 
  xdrOutput,
  signedBy,
  currentWeight,
  requiredWeight,
  canSubmitToNetwork,
  canSubmitToRefractor,
  isSubmittingToNetwork,
  isSubmittingToRefractor,
  successData,
  onCopyXdr,
  onSubmitToNetwork,
  onSubmitToRefractor,
  copied
}: TransactionSubmitterProps) => {
  const { network: currentNetwork } = useNetwork();
  const [isAirgappedMode, setIsAirgappedMode] = useState(false);
  if (!xdrOutput && !successData) {
    return null;
  }

  // Generate fingerprint for transaction verification
  const fingerprint = xdrOutput 
    ? generateDetailedFingerprint(xdrOutput, currentNetwork)
    : null;

  return (
    <div className="space-y-6">
      {/* Coordination Mode Toggle */}
      {xdrOutput && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Coordination Mode</CardTitle>
            <CardDescription>
              Choose how to coordinate transaction signatures
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Wifi className="w-4 h-4 text-muted-foreground" />
              <Label htmlFor="airgapped-mode">Refractor (Online)</Label>
              <Switch
                id="airgapped-mode"
                checked={isAirgappedMode}
                onCheckedChange={setIsAirgappedMode}
              />
              <Label htmlFor="airgapped-mode">Air-gapped (Offline)</Label>
              <WifiOff className="w-4 h-4 text-muted-foreground" />
            </div>
            {fingerprint && (
              <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                <p className="text-sm font-medium mb-1">Transaction Fingerprint</p>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="font-mono font-bold text-foreground">{fingerprint.shortFingerprint}</span>
                  <span>{fingerprint.operationSummary}</span>
                  <span>{fingerprint.sourceAccount}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Network Selection or Air-gapped QR */}
      {isAirgappedMode && xdrOutput ? (
        <AnimatedQR
          data={xdrOutput}
          type="xdr"
          title="Transaction for Signing"
          description="Scan with your air-gapped signing device"
        />
      ) : (
        <NetworkSelector
          isSubmittingToNetwork={isSubmittingToNetwork}
          isSubmittingToRefractor={isSubmittingToRefractor}
          onSubmitToNetwork={onSubmitToNetwork}
          onSubmitToRefractor={onSubmitToRefractor}
          canSubmitToNetwork={canSubmitToNetwork}
          canSubmitToRefractor={canSubmitToRefractor}
        />
      )}

      {/* Transaction Details */}
      {xdrOutput && (
        <>
          {/* Signing Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base sm:text-lg">
                <span>Signature Status</span>
                <Badge variant={canSubmitToNetwork ? 'default' : 'secondary'}>
                  {currentWeight}/{requiredWeight} Weight
                </Badge>
              </CardTitle>
              <CardDescription>
                {canSubmitToNetwork 
                  ? 'Ready for network submission' 
                  : `Need ${requiredWeight - currentWeight} more signature weight`
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              {signedBy.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Signed by:</p>
                  {signedBy.map((signature, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-secondary/50 rounded-md text-sm">
                      <span className="font-address">{signature.signerKey.slice(0, 12)}...{signature.signerKey.slice(-8)}</span>
                      <span className="text-muted-foreground text-xs">
                        {signature.signedAt.toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* XDR Output */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base sm:text-lg">
                <span>Transaction XDR</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCopyXdr}
                  className="h-8"
                >
                  <Copy className="w-4 h-4" />
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-3 bg-muted/50 rounded-lg">
                <code className="text-sm break-all font-address">{xdrOutput}</code>
              </div>
            </CardContent>
          </Card>

          {/* XDR Details */}
          <XdrDetails 
            xdr={xdrOutput} 
          />
        </>
      )}

      {/* Success Message */}
      {successData && (
        <Card className="border-success">
          <CardHeader>
            <CardTitle className="text-success">Transaction Submitted Successfully</CardTitle>
            <CardDescription>
              Your transaction has been broadcast to the {successData.network} network
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 bg-success/10 rounded-lg">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Transaction Hash</p>
                    <p className="font-address text-xs break-all">{successData.hash}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(successData.hash)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  const baseUrl = successData.network === 'testnet' 
                    ? 'https://laboratory.stellar.org/#explorer?resource=transactions&endpoint=single&network=test'
                    : 'https://laboratory.stellar.org/#explorer?resource=transactions&endpoint=single&network=public';
                  window.open(`${baseUrl}&values=${encodeURIComponent(`{"transaction":"${successData.hash}"}`)}`);
                }}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View on Stellar Laboratory
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};