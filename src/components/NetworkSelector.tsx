import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send, Key } from 'lucide-react';
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
  const {
    network: currentNetwork
  } = useNetwork();
  return <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base sm:text-lg whitespace-nowrap flex items-center gap-2">
          <Send className="w-4 h-4" />
          Submit Transaction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
        </div>

        {/* Submit Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button onClick={onSubmitToNetwork} disabled={!canSubmitToNetwork || isSubmittingToNetwork} className="w-full h-12 bg-success hover:bg-success/90 text-success-foreground glow-purple-on-hover">
            {isSubmittingToNetwork ? <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin spinner-purple-glow" />
                Submitting...
              </div> : <>
                <Send className="w-4 h-4 mr-2" />
                Submit to {currentNetwork === 'testnet' ? 'Testnet' : 'Mainnet'}
              </>}
          </Button>

          <Button onClick={onSubmitToRefractor} disabled={!canSubmitToRefractor || isSubmittingToRefractor} variant="outline" className="w-full h-12">
            {isSubmittingToRefractor ? <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Submitting...
              </div> : <>
                <img src={refractorLogo} alt="Refractor" className="w-4 h-4 mr-2" />
                Share via Refractor
              </>}
          </Button>
        </div>

        {currentNetwork === 'testnet' && <div className="p-4 rounded-lg border bg-blue/5 border-blue/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue/10 flex items-center justify-center flex-shrink-0">
                <img src={refractorLogo} alt="Refractor" className="w-4 h-4" />
              </div>
              <p className="text-sm text-blue font-medium">
                <strong>Note:</strong> Refractor only supports Mainnet. Switch to Mainnet to use Refractor for multisig coordination.
              </p>
            </div>
          </div>}

        {!canSubmitToNetwork && <div className="p-4 rounded-lg border bg-warning/5 border-warning/30">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
                <img src="/lovable-uploads/2012be0c-d57b-4b7e-86b4-5be4b759cca4.png" alt="Missing signature" className="w-4 h-4" />
              </div>
              <p className="text-sm text-warning font-medium">
                Insufficient signatures. Transaction needs more signatures before it can be submitted to the network.
              </p>
            </div>
          </div>}
      </CardContent>
    </Card>;
};