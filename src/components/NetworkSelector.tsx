import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Send, Upload } from 'lucide-react';
import refractorLogo from '@/assets/refractor-favicon.ico';
import { useState } from 'react';

interface NetworkSelectorProps {
  currentNetwork: 'mainnet' | 'testnet';
  onNetworkChange: (network: 'mainnet' | 'testnet') => void;
  onSubmitToNetwork: () => Promise<void>;
  onSubmitToRefractor: () => Promise<void>;
  canSubmitToNetwork: boolean;
  canSubmitToRefractor: boolean;
  isSubmitting: boolean;
}

export const NetworkSelector = ({
  currentNetwork,
  onNetworkChange,
  onSubmitToNetwork,
  onSubmitToRefractor,
  canSubmitToNetwork,
  canSubmitToRefractor,
  isSubmitting
}: NetworkSelectorProps) => {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Submission Options
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Network Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Target Network</label>
          <Select value={currentNetwork} onValueChange={onNetworkChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mainnet">
                <div className="flex items-center gap-2">
                  <Badge variant="default">Mainnet</Badge>
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
        <div className="space-y-3">
          <Button
            onClick={onSubmitToNetwork}
            disabled={!canSubmitToNetwork || isSubmitting}
            className="w-full bg-gradient-success hover:opacity-90"
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                Submitting to {currentNetwork}...
              </div>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Initiate Multisig Transaction
              </>
            )}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Button
            onClick={onSubmitToRefractor}
            disabled={!canSubmitToRefractor || isSubmitting}
            variant="outline"
            className="w-full inline-flex items-center gap-2"
          >
            <img src={refractorLogo} alt="Refractor" className="w-4 h-4" />
            <span>Send to Refractor</span>
          </Button>

          {!canSubmitToNetwork && canSubmitToRefractor && (
            <p className="text-xs text-muted-foreground">
              Not enough signatures for network submission. Use Refractor to collect more signatures.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};