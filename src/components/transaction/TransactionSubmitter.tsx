import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, ExternalLink } from 'lucide-react';
import { NetworkSelector } from '@/components/NetworkSelector';
import { XdrDetails } from '@/components/XdrDetails';
import { useNetwork } from '@/contexts/NetworkContext';

interface TransactionSubmitterProps {
  xdrOutput: string;
  signedBy: Array<{ signerKey: string; signedAt: Date }>;
  currentWeight: number;
  requiredWeight: number;
  canSubmitToNetwork: boolean;
  canSubmitToRefractor: boolean;
  isSubmitting: boolean;
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
  isSubmitting,
  successData,
  onCopyXdr,
  onSubmitToNetwork,
  onSubmitToRefractor,
  copied
}: TransactionSubmitterProps) => {
  const { network: currentNetwork } = useNetwork();
  if (!xdrOutput && !successData) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Network Selection */}
      <NetworkSelector
        isSubmitting={isSubmitting}
        onSubmitToNetwork={onSubmitToNetwork}
        onSubmitToRefractor={onSubmitToRefractor}
        canSubmitToNetwork={canSubmitToNetwork}
        canSubmitToRefractor={canSubmitToRefractor}
      />

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
                      <span className="font-mono">{signature.signerKey.slice(0, 12)}...{signature.signerKey.slice(-8)}</span>
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
                <code className="text-sm break-all font-mono">{xdrOutput}</code>
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
                    <p className="font-mono text-xs break-all">{successData.hash}</p>
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