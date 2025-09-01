import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Send, Upload } from 'lucide-react';
import refractorLogo from '@/assets/refractor-favicon.ico';
import { useNetwork } from '@/contexts/NetworkContext';

interface NetworkSelectorProps {
  onSubmitToNetwork: () => Promise<void>;
  onSubmitToRefractor: () => Promise<void>;
  isSubmitting: boolean;
  canSubmitToNetwork: boolean;
  canSubmitToRefractor: boolean;
}

export const NetworkSelector = ({
  onSubmitToNetwork,
  onSubmitToRefractor,
  isSubmitting,
  canSubmitToNetwork,
  canSubmitToRefractor
}: NetworkSelectorProps) => {
  const { network: currentNetwork, setNetwork: onNetworkChange } = useNetwork();
  
  

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
          <Select value={currentNetwork} onValueChange={onNetworkChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mainnet">
                <div className="flex items-center gap-2">
                  <Badge variant="default">Public</Badge>
                  <span>horizon.stellar.org</span>
                </div>
              </SelectItem>
              <SelectItem value="testnet">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Testnet</Badge>
                  <span>horizon-testnet.stellar.org</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Submit Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button
            onClick={onSubmitToNetwork}
            disabled={!canSubmitToNetwork || isSubmitting}
            className="w-full h-12 bg-success hover:bg-success/90 text-success-foreground"
          >
            {isSubmitting ? (
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
            disabled={!canSubmitToRefractor || isSubmitting}
            variant="outline"
            className="w-full h-12"
          >
            {isSubmitting ? (
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

        {!canSubmitToNetwork && (
          <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
            <p className="text-sm text-warning-foreground">
              Insufficient signatures. Transaction needs more signatures before it can be submitted to the network.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};