import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { RefreshCw, DollarSign, TrendingUp, Filter, Eye, EyeOff } from 'lucide-react';
import { AssetIcon } from './AssetIcon';
import { useAssetPrices } from '@/hooks/useAssetPrices';

interface AssetBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

interface AssetBalancePanelProps {
  balances: AssetBalance[];
}

export const AssetBalancePanel = ({ balances }: AssetBalancePanelProps) => {
  const { assetsWithPrices, totalValueUSD, loading, error, refetch } = useAssetPrices(balances);
  const [quoteCurrency, setQuoteCurrency] = useState('USD');
  const [hideSmallBalances, setHideSmallBalances] = useState(false);
  const [showValues, setShowValues] = useState(true);

  // Filter assets based on hide small balances toggle
  const filteredAssets = hideSmallBalances 
    ? assetsWithPrices.filter(asset => asset.valueUSD >= 10)
    : assetsWithPrices;

  const formatPrice = (price: number): string => {
    if (price === 0) return 'N/A';
    if (price < 0.01) return `$${price.toFixed(6)}`;
    if (price < 1) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(2)}`;
  };

  const formatValue = (value: number): string => {
    if (value === 0) return '$0.00';
    if (value < 0.01) return '<$0.01';
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatBalance = (balance: string): string => {
    const num = parseFloat(balance);
    if (num === 0) return '0';
    if (num < 0.01) return num.toFixed(6);
    if (num < 1) return num.toFixed(4);
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Asset Balances
            </CardTitle>
            <CardDescription>
              Portfolio overview with real-time pricing
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={refetch}
              disabled={loading}
              className="h-8 px-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Total Value Display */}
        {showValues && (
          <div className="mt-4 p-4 bg-gradient-primary/10 rounded-lg border border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Portfolio Value</p>
                <p className="text-2xl font-bold text-primary">
                  {loading ? (
                    <span className="animate-pulse">Loading...</span>
                  ) : (
                    formatValue(totalValueUSD)
                  )}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-primary/50" />
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex items-center justify-between gap-4 p-3 bg-secondary/30 rounded-lg">
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="hide-small"
                checked={hideSmallBalances}
                onCheckedChange={setHideSmallBalances}
              />
              <Label htmlFor="hide-small" className="text-sm">Hide &lt; $10</Label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Switch
                id="show-values"
                checked={showValues}
                onCheckedChange={setShowValues}
              />
              <Label htmlFor="show-values" className="text-sm flex items-center gap-1">
                {showValues ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                Values
              </Label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="currency" className="text-sm">Currency:</Label>
            <Select value={quoteCurrency} onValueChange={setQuoteCurrency}>
              <SelectTrigger className="w-20 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Assets List */}
        <div className="space-y-3">
          {loading && filteredAssets.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Loading prices...</span>
              </div>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Filter className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {hideSmallBalances ? 'No assets above $10' : 'No assets found'}
              </p>
            </div>
          ) : (
            filteredAssets.map((asset, index) => (
              <div key={index} className="p-4 border border-border rounded-lg hover:bg-secondary/20 transition-smooth">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AssetIcon 
                      assetCode={asset.asset_code}
                      assetIssuer={asset.asset_type !== 'native' ? asset.asset_issuer : undefined}
                      size={40}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{asset.symbol}</p>
                        {asset.asset_type === 'native' && (
                          <Badge variant="outline" className="text-xs">Native</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {asset.asset_type === 'native' ? 'Stellar Lumens' : asset.asset_type}
                      </p>
                      {showValues && asset.priceUSD > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {formatPrice(asset.priceUSD)} per {asset.symbol}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="font-mono font-semibold">
                      {formatBalance(asset.balance)}
                    </p>
                    <p className="text-sm text-muted-foreground">{asset.symbol}</p>
                    {showValues && (
                      <p className="text-sm font-medium text-primary">
                        {formatValue(asset.valueUSD)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Summary */}
        {filteredAssets.length > 0 && (
          <>
            <Separator />
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">
                Showing {filteredAssets.length} of {assetsWithPrices.length} assets
                {hideSmallBalances && (
                  <span className="ml-1">(&gt;= $10)</span>
                )}
              </span>
              {showValues && (
                <span className="font-medium">
                  Total: {formatValue(totalValueUSD)}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};