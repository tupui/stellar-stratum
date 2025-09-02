import { useState, useEffect } from 'react';
import { ArrowUpDown, ChevronDown, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetIcon } from '@/components/AssetIcon';
import { cn } from '@/lib/utils';
import { calculateAvailableBalance, formatBalance, formatAmount, calculateBalancePercentage, validateAndCapAmount } from '@/lib/balance-utils';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';

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
  previousOperations?: Array<{ asset: string; amount: string; type?: string }>; // For calculating available balance
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
  reserveAmount = 1, // Default reserve amount for XLM
  fiatValue,
  receiveAmount,
  slippageTolerance,
  previousOperations = [],
  onAmountChange,
  onFromAssetChange,
  onToAssetChange,
  onSwapDirection,
  className
}: SwapAmountInputProps) => {
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const [editValue, setEditValue] = useState(amount);
  const { getCurrentCurrency } = useFiatCurrency();

  const fromAssetObject = availableAssets.find(a => a.code === fromAsset);
  const fromAssetBalance = fromAssetObject?.balance || '0';
  const receiveCode = toAsset || fromAsset;
  const toAssetBalance = recipientAssets.find(a => a.code === receiveCode)?.balance || '0';

  // Calculate available balance using centralized utility
  const availableAmount = fromAssetObject 
    ? calculateAvailableBalance(fromAssetObject, previousOperations, reserveAmount)
    : 0;

  useEffect(() => {
    if (!isEditingAmount) {
      setEditValue(amount);
    }
  }, [amount, isEditingAmount]);

  const handleAmountSubmit = () => {
    const cappedValue = validateAndCapAmount(editValue, availableAmount);
    onAmountChange(cappedValue);
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
    if (percentage === 100) {
      // For 100%, use exact available amount to avoid rounding issues
      onAmountChange(availableAmount.toString());
    } else {
      const newAmount = availableAmount * (percentage / 100);
      const cappedAmount = validateAndCapAmount(newAmount, availableAmount);
      onAmountChange(cappedAmount);
    }
  };

  // Path payment logic
  const isPathPayment = toAsset && toAsset !== fromAsset;
  const displayReceiveAmount = isPathPayment ? receiveAmount || amount : amount;

  // Calculate current percentage for slider
  const currentPercentage = calculateBalancePercentage(amount, availableAmount);
  
  // Set default 10% amount when amount is empty and availableAmount > 0
  useEffect(() => {
    if ((!amount || amount === '0' || parseFloat(amount) === 0) && availableAmount > 0) {
      const defaultAmount = availableAmount * 0.1; // 10% of available balance
      const cappedAmount = validateAndCapAmount(defaultAmount, availableAmount);
      onAmountChange(cappedAmount);
    }
  }, [availableAmount, amount, onAmountChange]);

  return (
    <div className={cn("relative", className)}>
      {/* Hourglass Container */}
      <div className="relative">
        
        {/* Top Section */}
        <div className="relative bg-card/80 backdrop-blur-sm border border-border/50 rounded-3xl p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-muted-foreground">You send</span>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Available: {formatBalance(availableAmount)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs bg-success/10 text-success hover:bg-success/20 hover:text-success border border-success/20 glow-purple-on-hover"
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
              <SelectTrigger className="w-full sm:w-44 h-14 bg-background/80 border-border/60 hover:border-border rounded-full pl-2 pr-4">
                <SelectValue>
                  <div className="flex items-center gap-2">
                    <AssetIcon assetCode={fromAsset} assetIssuer={fromAssetIssuer} size={40} />
                    <span className="font-semibold ml-1">{fromAsset}</span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-[280px] max-h-72 overflow-y-auto bg-card border border-border shadow-lg z-50">
                <div className="sticky top-0 bg-card border-b border-border px-3 py-2">
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
                  className="text-xl md:text-2xl font-mono cursor-pointer p-2 rounded hover:bg-muted/30 transition-colors text-right"
                  onClick={() => setIsEditingAmount(true)}
                >
                  {amount ? formatAmount(amount) : '0.0'}
                </div>
              )}
              {fiatValue && (
                <div className="text-sm text-muted-foreground mt-1">
                  ≈ {getCurrentCurrency().symbol}{fiatValue.replace(/[$€£¥₹]/g, '')}
                </div>
              )}
            </div>
          </div>

          {/* Percentage Slider */}
          <div className="mt-6">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>Amount</span>
              <span>{Math.round(currentPercentage)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(currentPercentage)}
              onChange={(e) => {
                const percentage = parseInt(e.target.value);
                if (percentage === 100) {
                  // For 100%, use exact available amount to avoid rounding issues
                  onAmountChange(availableAmount.toString());
                } else {
                  const newAmount = availableAmount * (percentage / 100);
                  const cappedAmount = validateAndCapAmount(newAmount, availableAmount);
                  onAmountChange(cappedAmount);
                }
              }}
              className="stellar-slider w-full"
              style={{'--slider-progress': `${Math.round(currentPercentage)}%`} as React.CSSProperties}
            />
          </div>
        </div>

        {/* Simple Connection */}
        <div className="relative flex justify-center -my-4 z-10">
          {!onSwapDirection ? (
            <div className="w-10 h-10 rounded-full bg-card border border-border/60 flex items-center justify-center shadow-sm">
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-10 h-10 rounded-full border bg-card hover:bg-muted/50 hover:border-primary/50 transition-all duration-200 shadow-sm glow-on-hover"
              onClick={onSwapDirection}
            >
              <ArrowUpDown className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Bottom Section */}
        <div className="relative bg-card/60 backdrop-blur-sm border border-border/40 rounded-3xl p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-muted-foreground">They receive</span>
            {recipientAssets.length > 0 && (
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
              <SelectTrigger className="w-full sm:w-44 h-14 bg-background/60 border-border/40 hover:border-border/60 rounded-full pl-2 pr-4">
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      <AssetIcon 
                        assetCode={toAsset || fromAsset} 
                        assetIssuer={toAssetIssuer || fromAssetIssuer} 
                        size={40} 
                      />
                      <span className="font-semibold ml-1">{toAsset || fromAsset}</span>
                    </div>
                  </SelectValue>
              </SelectTrigger>
                <SelectContent className="min-w-[280px] max-h-72 overflow-y-auto bg-card border border-border shadow-lg z-50">
                  <div className="sticky top-0 bg-card border-b border-border px-3 py-2">
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
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatBalance(recipientAssets.find(a => a.code === fromAsset)?.balance || '0')}
                      </span>
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
                  Min {receiveAmount ? formatAmount(receiveAmount) : '0.0'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};