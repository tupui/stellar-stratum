import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, ArrowRight, Merge } from 'lucide-react';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { DestinationAccountInfo } from './DestinationAccountInfo';

interface Asset {
  code: string;
  issuer: string;
  name: string;
  balance: string;
  price: number;
}

interface AccountMergeFormProps {
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
  accountData: {
    publicKey: string;
    balances: Array<{
      asset_type: string;
      asset_code?: string;
      asset_issuer?: string;
      balance: string;
    }>;
  };
  onBuild: (destination: string) => void;
  isBuilding: boolean;
}

export const AccountMergeForm = ({ 
  availableAssets, 
  assetPrices, 
  accountData,
  onBuild, 
  isBuilding 
}: AccountMergeFormProps) => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const [destination, setDestination] = useState('');
  const [totalFiatValue, setTotalFiatValue] = useState<string>('');
  const [xlmBalance, setXlmBalance] = useState<string>('0');

  // Calculate XLM balance
  useEffect(() => {
    const xlmAsset = availableAssets.find(asset => asset.code === 'XLM');
    if (xlmAsset) {
      setXlmBalance(xlmAsset.balance);
    }
  }, [availableAssets]);

  // Calculate total fiat value of all assets
  useEffect(() => {
    const calculateTotalFiat = async () => {
      let totalUSD = 0;
      
      for (const asset of availableAssets) {
        const balance = parseFloat(asset.balance);
        const price = assetPrices[asset.code] || 0;
        totalUSD += balance * price;
      }
      
      if (totalUSD === 0) {
        setTotalFiatValue('');
        return;
      }

      if (quoteCurrency === 'USD') {
        setTotalFiatValue(`$${totalUSD.toFixed(2)}`);
      } else {
        try {
          const converted = await convertFromUSD(totalUSD, quoteCurrency);
          const currency = getCurrentCurrency();
          setTotalFiatValue(`${currency?.symbol || ''}${converted.toFixed(2)}`);
        } catch {
          setTotalFiatValue(`$${totalUSD.toFixed(2)}`);
        }
      }
    };

    calculateTotalFiat();
  }, [availableAssets, assetPrices, quoteCurrency, getCurrentCurrency]);

  const hasNonXLMAssets = availableAssets.some(asset => asset.code !== 'XLM' && parseFloat(asset.balance) > 0);

  const isFormValid = destination.trim() && destination !== accountData.publicKey;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Account Merge - Send All Funds
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Warning */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <p className="font-medium">⚠️ This action is irreversible!</p>
              <p>Account merge will:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Send ALL XLM balance to the destination account</li>
                <li>Close this account permanently</li>
                <li>Make this account unusable for future transactions</li>
                {hasNonXLMAssets && (
                  <li className="text-destructive font-medium">
                    ⚠️ Non-XLM assets will be LOST - send them separately first!
                  </li>
                )}
              </ul>
            </AlertDescription>
          </Alert>

          {/* Non-XLM Assets Warning */}
          {hasNonXLMAssets && (
            <Card className="border-destructive/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-destructive">Assets That Will Be Lost</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {availableAssets
                  .filter(asset => asset.code !== 'XLM' && parseFloat(asset.balance) > 0)
                  .map(asset => (
                    <div key={`${asset.code}-${asset.issuer}`} className="flex justify-between text-sm">
                      <span>{asset.name || asset.code}</span>
                      <span className="font-mono">{parseFloat(asset.balance).toFixed(7)}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Account Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Merge className="w-4 h-4" />
                Merge Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center">
                <span>XLM to Transfer:</span>
                <span className="font-mono text-lg font-semibold">{parseFloat(xlmBalance).toFixed(7)} XLM</span>
              </div>
              
              {totalFiatValue && (
                <div className="flex justify-between items-center">
                  <span>Total Value:</span>
                  <span className="text-lg font-semibold">{totalFiatValue}</span>
                </div>
              )}

              <div className="pt-3 border-t">
                <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
                  <span className="font-address text-xs">{accountData.publicKey.slice(0, 8)}...</span>
                  <ArrowRight className="w-4 h-4" />
                  <span>Destination Account</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Destination Input */}
          <div className="space-y-2">
            <Label htmlFor="merge-destination">Destination Account</Label>
            <Input
              id="merge-destination"
              placeholder="GABC..."
              maxLength={56}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="text-xs sm:text-sm font-address"
            />
          </div>

          {/* Destination Info */}
          {destination && destination !== accountData.publicKey && (
            <DestinationAccountInfo destination={destination} />
          )}

          {/* Same Account Warning */}
          {destination === accountData.publicKey && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Cannot merge account into itself. Please specify a different destination account.
              </AlertDescription>
            </Alert>
          )}

          {/* Build Button */}
          <Button 
            onClick={() => onBuild(destination)} 
            disabled={isBuilding || !isFormValid}
            variant="destructive"
            className="w-full"
            size="lg"
          >
            {isBuilding ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                Building Account Merge...
              </div>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 mr-2" />
                Build Account Merge Transaction
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};