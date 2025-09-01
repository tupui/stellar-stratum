import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Globe, Send } from 'lucide-react';
import refractorLogo from '@/assets/refractor-favicon.ico';
import { useNetwork } from '@/contexts/NetworkContext';

interface NetworkSelectorProps {
  onSubmitToNetwork: () => Promise<void>;
  onSubmitToRefractor: () => Promise<void>;
  isSubmittingToNetwork: boolean;
  isSubmittingToRefractor: boolean;
  canSubmitToNetwork: boolean;
  canSubmitToRefractor: boolean;
}

export const NetworkSelector = ({
  onSubmitToNetwork,
  onSubmitToRefractor,
  isSubmittingToNetwork,
  isSubmittingToRefractor,
  canSubmitToNetwork,
  canSubmitToRefractor
}: NetworkSelectorProps) => {
  const { network: currentNetwork } = useNetwork();
  
  

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Submit Transaction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">Target Network</label>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div className="flex items-center gap-2">
              {currentNetwork === 'testnet' ? (
                <Badge variant="secondary">Testnet</Badge>
              ) : (
                <Badge variant="default">Public</Badge>
              )}
              <span>{currentNetwork === 'testnet' ? 'horizon-testnet.stellar.org' : 'horizon.stellar.org'}</span>
            </div>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button
            onClick={onSubmitToNetwork}
            disabled={!canSubmitToNetwork || isSubmittingToNetwork}
            className="w-full h-12 bg-success hover:bg-success/90 text-success-foreground"
          >
            {isSubmittingToNetwork ? (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Submitting...
              </div>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Submit to {currentNetwork === 'testnet' ? 'Testnet' : 'Public'}
              </>
            )}
          </Button>

          <Button
            onClick={onSubmitToRefractor}
            disabled={!canSubmitToRefractor || isSubmittingToRefractor}
            variant="outline"
            className="w-full h-12"
          >
            {isSubmittingToRefractor ? (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Submitting...
              </div>
            ) : (
              <>
                <img 
                  src={refractorLogo} 
                  alt="Refractor" 
                  className="w-4 h-4 mr-2"
                />
                Share via Refractor
              </>
            )}
          </Button>
        </div>

        {currentNetwork === 'testnet' && (
          <div className="p-4 rounded-lg border bg-primary/5 border-primary/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Globe className="w-4 h-4 text-primary" />
              </div>
              <p className="text-sm text-primary font-medium">
                <strong>Note:</strong> Refractor only supports Public network. Switch to Public to use Refractor for multisig coordination.
              </p>
            </div>
          </div>
        )}

        {!canSubmitToNetwork && (
          <div className="p-4 rounded-lg border bg-secondary/5 border-secondary/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center flex-shrink-0">
                <Send className="w-4 h-4 text-secondary-foreground" />
              </div>
              <p className="text-sm text-secondary-foreground font-medium">
                Insufficient signatures. Transaction needs more signatures before it can be submitted to the network.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};