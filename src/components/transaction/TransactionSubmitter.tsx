import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Copy, ExternalLink, Wifi, WifiOff, Send, Fingerprint } from 'lucide-react';
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
  onShowOfflineModal: () => void;
  copied: boolean;
  offlineOnly?: boolean;
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
  onShowOfflineModal,
  copied,
  offlineOnly = false
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

  // Determine if transaction is ready for network submission
  const isReadyForSubmission = canSubmitToNetwork && currentWeight >= requiredWeight;

  return (
    <div className="space-y-6">
      {/* If ready for submission, show direct submit button */}
      {isReadyForSubmission ? (
        <Button
          onClick={onSubmitToNetwork}
          disabled={isSubmittingToNetwork}
          className="w-full"
          size="lg"
        >
          <Send className="w-4 h-4 mr-2" />
          {isSubmittingToNetwork ? 'Submitting...' : `Send Transaction to ${currentNetwork === 'mainnet' ? 'Mainnet' : 'Testnet'}`}
        </Button>
      ) : (
        // If not ready, show coordination options
        xdrOutput && (
          <>
            {!offlineOnly && (
              <>
                {/* Coordination Mode Toggle */}
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
                  </CardContent>
                </Card>

                {/* Send for Signature Button */}
                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={isAirgappedMode ? onShowOfflineModal : onSubmitToRefractor}
                  disabled={isSubmittingToRefractor}
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSubmittingToRefractor ? 'Sending...' : 'Send for Signature'}
                </Button>
              </>
            )}
            
            {offlineOnly && (
              <Button 
                className="w-full" 
                size="lg"
                onClick={onShowOfflineModal}
              >
                <Send className="w-4 h-4 mr-2" />
                Send for Signature
              </Button>
            )}
          </>
        )
      )}
    </div>
  );
};