import { useState } from 'react';
import { ArrowUpDown, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetIcon } from '@/components/AssetIcon';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { formatBalance, formatAmount } from '@/lib/balance-utils';

interface Asset {
  code: string;
  issuer?: string;
  balance: string;
}

interface SwapInterfaceProps {
  fromAsset: Asset;
  toAsset: Asset;
  fromAmount: string;
  toAmount: string;
  availableAssets: Asset[];
  onFromAssetChange: (asset: Asset) => void;
  onToAssetChange: (asset: Asset) => void;
  onFromAmountChange: (amount: string) => void;
  onSwapDirection: () => void;
  className?: string;
}

export const SwapInterface = ({
  fromAsset,
  toAsset,
  fromAmount,
  toAmount,
  availableAssets,
  onFromAssetChange,
  onToAssetChange,
  onFromAmountChange,
  onSwapDirection,
  className
}: SwapInterfaceProps) => {
  const [sliderValue, setSliderValue] = useState([0]);

  const handleSliderChange = (value: number[]) => {
    setSliderValue(value);
    const percentage = value[0];
    const maxBalance = parseFloat(fromAsset.balance);
    const newAmount = (maxBalance * percentage / 100).toFixed(7);
    onFromAmountChange(newAmount);
  };

  const handleMaxClick = () => {
    const maxBalance = fromAsset.balance;
    onFromAmountChange(maxBalance);
    setSliderValue([100]);
  };

  return (
    <div className={cn("max-w-md mx-auto", className)}>
      {/* From Section */}
      <div className="bg-card border border-border rounded-2xl p-6 mb-2">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-muted-foreground">You send</span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Available: {formatBalance(fromAsset.balance)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleMaxClick}
            >
              MAX
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <Select 
            value={fromAsset.code} 
            onValueChange={(code) => {
              const asset = availableAssets.find(a => a.code === code);
              if (asset) onFromAssetChange(asset);
            }}
          >
            <SelectTrigger className="w-32 h-12 rounded-full">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <AssetIcon assetCode={fromAsset.code} assetIssuer={fromAsset.issuer} size={32} />
                  <span className="font-medium">{fromAsset.code}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableAssets.map((asset) => (
                <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code}>
                  <div className="flex items-center gap-2">
                    <AssetIcon assetCode={asset.code} assetIssuer={asset.issuer} size={24} />
                    <span>{asset.code}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1">
            <Input
              type="text"
              value={fromAmount}
              onChange={(e) => onFromAmountChange(e.target.value)}
              className="text-right text-xl font-mono border-none bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
              placeholder="0.0"
            />
          </div>
        </div>

        {/* Golden Slider */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Amount</span>
            <span>{sliderValue[0]}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={sliderValue[0]}
            onChange={(e) => handleSliderChange([parseInt(e.target.value)])}
            className="stellar-slider w-full"
            style={{'--slider-progress': `${sliderValue[0]}%`} as React.CSSProperties}
          />
        </div>
      </div>

      {/* Swap Direction Button */}
      <div className="flex justify-center relative z-10 -my-3">
        <Button
          onClick={onSwapDirection}
          className="w-12 h-12 rounded-full bg-success hover:bg-success/90 shadow-lg border-4 border-background transition-all duration-200 hover:shadow-xl"
          size="sm"
        >
          <ArrowUpDown className="h-4 w-4 text-white" />
        </Button>
      </div>

      {/* To Section */}
      <div className="bg-card/60 border border-border/60 rounded-2xl p-6 mt-2">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-muted-foreground">They receive</span>
          <span className="text-sm text-muted-foreground">
            Has: {formatBalance(toAsset.balance)}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <Select 
            value={toAsset.code} 
            onValueChange={(code) => {
              const asset = availableAssets.find(a => a.code === code);
              if (asset) onToAssetChange(asset);
            }}
          >
            <SelectTrigger className="w-32 h-12 rounded-full">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <AssetIcon assetCode={toAsset.code} assetIssuer={toAsset.issuer} size={32} />
                  <span className="font-medium">{toAsset.code}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableAssets.map((asset) => (
                <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code}>
                  <div className="flex items-center gap-2">
                    <AssetIcon assetCode={asset.code} assetIssuer={asset.issuer} size={24} />
                    <span>{asset.code}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1 text-right">
            <div className="text-xl font-mono text-muted-foreground">
              {toAmount ? formatAmount(toAmount) : '0'}
            </div>
          </div>
        </div>

        {/* Down Arrow Button */}
        <div className="flex justify-center mt-4">
          <div className="w-12 h-12 rounded-full bg-success hover:bg-success/90 shadow-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:shadow-xl">
            <ArrowDown className="h-4 w-4 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
};