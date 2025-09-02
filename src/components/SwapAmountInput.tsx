import { useState, useEffect } from 'react';
import { ArrowUpDown, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetIcon } from '@/components/AssetIcon';
import { cn } from '@/lib/utils';

interface Asset {
  code: string;
  issuer?: string;
  balance: string;
}

interface SwapAmountInputProps {
  fromAsset: string;
  fromAssetIssuer?: string;
  toAsset?: string;
  toAssetIssuer?: string;
  amount: string;
  availableAssets: Asset[];
  recipientAssets?: Asset[];
  maxAmount: number;
  reserveAmount?: number;
  fiatValue?: string;
  receiveAmount?: string; // For path payments
  slippageTolerance?: number;
  onAmountChange: (amount: string) => void;
  onFromAssetChange: (asset: string, issuer?: string) => void;
  onToAssetChange: (asset?: string, issuer?: string) => void;
  onSwapDirection?: () => void;
  className?: string;
}

export const SwapAmountInput = ({
  fromAsset,
  fromAssetIssuer,
  toAsset,
  toAssetIssuer,
  amount,
  availableAssets,
  recipientAssets = [],
  maxAmount,
  reserveAmount = 0,
  fiatValue,
  receiveAmount,
  slippageTolerance,
  onAmountChange,
  onFromAssetChange,
  onToAssetChange,
  onSwapDirection,
  className
}: SwapAmountInputProps) => {
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const [editValue, setEditValue] = useState(amount);

  const fromAssetBalance = availableAssets.find(a => a.code === fromAsset)?.balance || '0';
  const toAssetBalance = recipientAssets.find(a => a.code === toAsset)?.balance || '0';

  // Calculate actual available amount considering reserves
  const availableAmount = Math.max(0, maxAmount - reserveAmount);

  useEffect(() => {
    if (!isEditingAmount) {
      setEditValue(amount);
    }
  }, [amount, isEditingAmount]);

  const handleAmountSubmit = () => {
    let numValue = parseFloat(editValue) || 0;
    numValue = Math.round(numValue * 10000000) / 10000000; // 7 decimal places
    numValue = Math.min(numValue, availableAmount); // Don't exceed available amount
    onAmountChange(numValue.toString());
    setIsEditingAmount(false);
  };

  const handleAmountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleAmountSubmit();
    } else if (e.key === 'Escape') {
      setEditValue(amount);
      setIsEditingAmount(false);
    }
  };

  const handlePercentageClick = (percentage: number) => {
    const newAmount = availableAmount * (percentage / 100);
    onAmountChange(newAmount.toFixed(7));
  };

  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    if (num === 0) return '0';
    if (num < 0.001) return '<0.001';
    return num.toLocaleString('en-US', { 
      maximumFractionDigits: num >= 1 ? 2 : 7,
      minimumFractionDigits: 0
    });
  };

  const formatAmount = (value: string) => {
    const num = parseFloat(value);
    if (num === 0) return '0';
    if (num < 0.0001) return num.toFixed(7);
    return num.toLocaleString('en-US', { 
      maximumFractionDigits: 7,
      minimumFractionDigits: 0
    });
  };

  // Path payment logic
  const isPathPayment = toAsset && toAsset !== fromAsset;
  const displayReceiveAmount = isPathPayment ? receiveAmount || amount : amount;

  return (
    <div className={cn("space-y-1", className)}>
      {/* From Section */}
      <div className="relative">
        <div className="bg-card/50 backdrop-blur-sm border border-border/60 rounded-2xl p-4 md:p-6 hover:border-border transition-colors">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-muted-foreground">You send</span>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="hidden sm:inline">Balance: {formatBalance(fromAssetBalance)}</span>
              <span className="sm:hidden">Bal: {formatBalance(fromAssetBalance)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs hover:bg-primary/10 hover:text-primary"
                onClick={() => handlePercentageClick(100)}
              >
                MAX
              </Button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            {/* Asset Selector */}
            <Select 
              value={fromAsset} 
              onValueChange={(value) => {
                const selectedAsset = availableAssets.find(asset => asset.code === value);
                onFromAssetChange(value, selectedAsset?.issuer);
              }}
            >
              <SelectTrigger className="w-full sm:w-40 h-12 bg-background/80 border-border/60 hover:border-border">
                <SelectValue>
                  <div className="flex items-center gap-3">
                    <AssetIcon assetCode={fromAsset} assetIssuer={fromAssetIssuer} size={40} />
                    <span className="font-semibold">{fromAsset}</span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-[280px] max-h-72 overflow-y-auto">
                <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border px-3 py-2">
                  <div className="grid grid-cols-[auto_1fr_auto] gap-3 text-xs text-muted-foreground font-medium">
                    <span>Asset</span>
                    <span></span>
                    <span>Balance</span>
                  </div>
                </div>
                {availableAssets.map((asset) => (
                  <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code}>
                    <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-center w-full min-w-[240px]">
                      <div className="flex items-center gap-2">
                        <AssetIcon assetCode={asset.code} assetIssuer={asset.issuer} size={32} />
                        <span className="font-medium">{asset.code}</span>
                      </div>
                      <span></span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatBalance(asset.balance)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Amount Input */}
            <div className="flex-1 text-right">
              {isEditingAmount ? (
                <Input
                  type="text"
                  inputMode="decimal"
                  value={editValue}
                  onChange={(e) => {
                    let sanitized = e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
                    const parts = sanitized.split('.');
                    if (parts.length > 2) sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
                    if (parts[1] && parts[1].length > 7) sanitized = `${parts[0]}.${parts[1].substring(0, 7)}`;
                    setEditValue(sanitized);
                  }}
                  onBlur={handleAmountSubmit}
                  onKeyDown={handleAmountKeyDown}
                  onFocus={(e) => e.currentTarget.select()}
                  className="text-right text-xl md:text-2xl font-mono bg-transparent border-none p-0 h-auto focus-visible:ring-0 shadow-none"
                  placeholder="0.0"
                  autoFocus
                />
              ) : (
                <div
                  className="text-xl md:text-2xl font-mono cursor-pointer p-2 rounded hover:bg-muted/30 transition-colors"
                  onClick={() => setIsEditingAmount(true)}
                >
                  {amount ? formatAmount(amount) : '0.0'}
                </div>
              )}
              {fiatValue && (
                <div className="text-sm text-muted-foreground mt-1">
                  ≈ {fiatValue}
                </div>
              )}
            </div>
          </div>

          {/* Percentage Slider */}
          <div className="mt-6">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>Amount</span>
              <span>{Math.round((parseFloat(amount) / availableAmount) * 100) || 0}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={Math.round((parseFloat(amount) / availableAmount) * 100) || 0}
              onChange={(e) => {
                const percentage = parseFloat(e.target.value);
                const newAmount = availableAmount * (percentage / 100);
                onAmountChange(newAmount.toFixed(7));
              }}
              className="stellar-slider w-full"
              style={{'--slider-progress': `${Math.round((parseFloat(amount) / availableAmount) * 100) || 0}%`} as React.CSSProperties}
            />
          </div>
        </div>
      </div>

      {/* Swap Direction Button */}
      {onSwapDirection && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="w-10 h-10 rounded-full border-2 bg-background hover:bg-muted/50 hover:border-primary/50"
            onClick={onSwapDirection}
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* To Section */}
      <div className="bg-card/30 backdrop-blur-sm border border-border/40 rounded-2xl p-4 md:p-6 hover:border-border/60 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-muted-foreground">You receive</span>
          {toAsset && recipientAssets.length > 0 && (
            <div className="text-sm text-muted-foreground">
              <span className="hidden sm:inline">Recipient has: {formatBalance(toAssetBalance)}</span>
              <span className="sm:hidden">Has: {formatBalance(toAssetBalance)}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {/* Asset Selector */}
          <Select 
            value={toAsset || "same"} 
            onValueChange={(value) => {
              if (value === "same") {
                onToAssetChange();
              } else {
                const selectedAsset = recipientAssets.find(asset => asset.code === value);
                onToAssetChange(value, selectedAsset?.issuer);
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-40 h-12 bg-background/60 border-border/40 hover:border-border/60">
                <SelectValue>
                  <div className="flex items-center gap-3">
                    <AssetIcon 
                      assetCode={toAsset || fromAsset} 
                      assetIssuer={toAssetIssuer || fromAssetIssuer} 
                      size={40} 
                    />
                    <span className="font-semibold">{toAsset || fromAsset}</span>
                  </div>
                </SelectValue>
            </SelectTrigger>
              <SelectContent className="min-w-[280px] max-h-72 overflow-y-auto">
                <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border px-3 py-2">
                  <div className="grid grid-cols-[auto_1fr_auto] gap-3 text-xs text-muted-foreground font-medium">
                    <span>Asset</span>
                    <span></span>
                    <span>Recipient Has</span>
                  </div>
                </div>
                <SelectItem value="same">
                  <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-center w-full min-w-[240px]">
                    <div className="flex items-center gap-2">
                      <AssetIcon assetCode={fromAsset} assetIssuer={fromAssetIssuer} size={32} />
                      <span className="text-muted-foreground">Same ({fromAsset})</span>
                    </div>
                    <span></span>
                    <span className="text-xs text-muted-foreground">—</span>
                  </div>
                </SelectItem>
                {recipientAssets.filter(asset => asset.code !== fromAsset).map((asset) => (
                  <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code}>
                    <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-center w-full min-w-[240px]">
                      <div className="flex items-center gap-2">
                        <AssetIcon assetCode={asset.code} assetIssuer={asset.issuer} size={32} />
                        <span className="font-medium">{asset.code}</span>
                      </div>
                      <span></span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatBalance(asset.balance)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
          </Select>

          {/* Receive Amount Display */}
          <div className="flex-1 text-right">
            <div className="text-xl md:text-2xl font-mono text-muted-foreground">
              {isPathPayment ? 
                (receiveAmount ? formatAmount(receiveAmount) : '0.0') :
                (amount ? formatAmount(amount) : '0.0')
              }
            </div>
            {isPathPayment && (
              <div className="text-sm text-muted-foreground mt-1">
                Minimum received {slippageTolerance ? `(${slippageTolerance}% slippage)` : ''}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};