import { useState, useEffect } from 'react';
import { ArrowUpDown, ArrowDown, Merge, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetIcon } from '@/components/AssetIcon';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { calculateAvailableBalance, formatBalance, formatBalanceAligned, formatAmount, calculateBalancePercentage, validateAndCapAmount } from '@/lib/balance-utils';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { getAssetPrice } from '@/lib/reflector';
interface Asset {
  code: string;
  issuer?: string;
  balance: string;
}
interface SwapInterfaceProps {
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
  receiveAmount?: string;
  slippageTolerance?: number;
  previousOperations?: Array<{
    asset: string;
    amount: string;
    type?: string;
  }>;
  onAmountChange: (amount: string) => void;
  onFromAssetChange: (asset: string, issuer?: string) => void;
  onToAssetChange: (asset?: string, issuer?: string) => void;
  onSlippageToleranceChange?: (tolerance: number) => void;
  onReceiveAmountChange?: (amount: string) => void;
  onSwapDirection?: () => void;
  className?: string;
  willCloseAccount?: boolean;
  assetPrices?: Record<string, number>;
  onFetchAssetPrice?: (assetCode: string, assetIssuer?: string) => Promise<number>;
}
export const SwapInterface = ({
  fromAsset,
  fromAssetIssuer,
  toAsset,
  toAssetIssuer,
  amount,
  availableAssets,
  recipientAssets = [],
  maxAmount,
  reserveAmount = 1,
  fiatValue,
  receiveAmount,
  slippageTolerance = 0.5,
  previousOperations = [],
  onAmountChange,
  onFromAssetChange,
  onToAssetChange,
  onSlippageToleranceChange,
  onReceiveAmountChange,
  onSwapDirection,
  className,
  willCloseAccount = false,
  assetPrices = {},
  onFetchAssetPrice
}: SwapInterfaceProps) => {
  const [sliderValue, setSliderValue] = useState([0]);
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const [editValue, setEditValue] = useState(amount);
  const [isEditingReceiveAmount, setIsEditingReceiveAmount] = useState(false);
  const [editReceiveValue, setEditReceiveValue] = useState(receiveAmount || '');
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [priceError, setPriceError] = useState<string>('');
  const [manualReceiveAmount, setManualReceiveAmount] = useState<string>('');
  const [isManualInput, setIsManualInput] = useState(false);
  const {
    getCurrentCurrency
  } = useFiatCurrency();
  const fromAssetObject = availableAssets.find(a => a.code === fromAsset);
  const fromAssetBalance = fromAssetObject?.balance || '0';
  const receiveCode = toAsset || fromAsset;
  const toAssetBalance = recipientAssets.find(a => a.code === receiveCode)?.balance || '0';

  // Calculate available balance using centralized utility
  const availableAmount = fromAssetObject ? calculateAvailableBalance(fromAssetObject, previousOperations, reserveAmount) : 0;

  // Calculate current percentage for slider
  const currentPercentage = calculateBalancePercentage(amount, availableAmount);
  useEffect(() => {
    if (!isEditingAmount) {
      setEditValue(amount);
    }
  }, [amount, isEditingAmount]);
  useEffect(() => {
    setSliderValue([Math.round(currentPercentage)]);
  }, [currentPercentage]);
  const handleSliderChange = (value: number[]) => {
    const percentage = value[0];
    setSliderValue([percentage]);
    if (percentage === 100) {
      onAmountChange(availableAmount.toString());
    } else {
      const newAmount = availableAmount * (percentage / 100);
      const cappedAmount = validateAndCapAmount(newAmount, availableAmount);
      onAmountChange(cappedAmount);
    }
  };
  const handleMaxClick = () => {
    onAmountChange(availableAmount.toString());
    setSliderValue([100]);
  };
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

  // Path payment logic
  const isPathPayment = toAsset && toAsset !== fromAsset;
  
  // Get prices from parent and fetch missing ones
  const fromPrice = assetPrices[fromAsset] || 0;
  const toPrice = assetPrices[toAsset || ''] || 0;
  
  // Fetch missing prices in background without blocking UI
  useEffect(() => {
    if (!isPathPayment || !onFetchAssetPrice) return;
    
    // Start with assuming manual input is needed
    if (fromPrice <= 0 || toPrice <= 0) {
      setPriceError(`Exchange rate not available. Please enter minimum receive amount manually.`);
      setIsManualInput(true);
      setFetchingPrices(false);
    } else {
      setPriceError('');
      setIsManualInput(false);
      setFetchingPrices(false);
    }
    
    // Fetch missing prices in background without blocking
    const fetchMissingPrices = async () => {
      const promises = [];
      
      if (fromPrice <= 0) {
        promises.push(onFetchAssetPrice(fromAsset, fromAssetIssuer));
      }
      if (toAsset && toPrice <= 0) {
        promises.push(onFetchAssetPrice(toAsset, toAssetIssuer));
      }
      
      if (promises.length > 0) {
        // Fetch with timeout and don't block UI
        Promise.allSettled(promises.map(p => 
          Promise.race([
            p,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 2000)
            )
          ])
        )).then(() => {
          // Prices might be available now, check again
          const newFromPrice = assetPrices[fromAsset] || 0;
          const newToPrice = assetPrices[toAsset || ''] || 0;
          
          if (newFromPrice > 0 && newToPrice > 0) {
            setPriceError('');
            setIsManualInput(false);
          }
        }).catch(() => {
          // Keep manual input if fetching fails
        });
      }
    };
    
    // Delay to avoid blocking asset selection
    const timeoutId = setTimeout(fetchMissingPrices, 100);
    return () => clearTimeout(timeoutId);
  }, [isPathPayment, fromAsset, toAsset, fromAssetIssuer, toAssetIssuer, onFetchAssetPrice, fromPrice, toPrice]);
  
  // Calculate receive amount based on prices or manual input
  const calculateReceiveAmount = () => {
    if (!isPathPayment) return amount;
    if (isManualInput && manualReceiveAmount) return manualReceiveAmount;
    if (receiveAmount) return receiveAmount;
    
    const numAmount = parseFloat(amount);
    if (!numAmount) return '0';
    
    const fromPrice = assetPrices[fromAsset] || 0;
    const toPrice = assetPrices[toAsset || ''] || 0;
    
    if (fromPrice > 0 && toPrice > 0) {
      const usdValue = numAmount * fromPrice;
      const convertedAmount = usdValue / toPrice;
      const slippageAdjustment = 1 - (slippageTolerance / 100);
      return (convertedAmount * slippageAdjustment).toFixed(7);
    }
    
    return '0';
  };
  
  const displayReceiveAmount = calculateReceiveAmount();
  
  // Handle manual receive amount input
  const handleReceiveAmountChange = (newAmount: string) => {
    setManualReceiveAmount(newAmount);
    setIsManualInput(true);
    onReceiveAmountChange?.(newAmount);
    
    // Adjust slippage based on manual input vs calculated amount
    if (onSlippageToleranceChange && amount && newAmount) {
      const numAmount = parseFloat(amount);
      const numReceiveAmount = parseFloat(newAmount);
      const fromPrice = assetPrices[fromAsset] || 0;
      const toPrice = assetPrices[toAsset || ''] || 0;
      
      if (fromPrice > 0 && toPrice > 0 && numAmount > 0 && numReceiveAmount > 0) {
        const expectedAmount = (numAmount * fromPrice) / toPrice;
        const actualSlippage = ((expectedAmount - numReceiveAmount) / expectedAmount) * 100;
        const adjustedSlippage = Math.max(0.1, Math.min(5, actualSlippage));
        onSlippageToleranceChange(adjustedSlippage);
      }
    }
  };
  
  const handleReceiveAmountSubmit = () => {
    handleReceiveAmountChange(editReceiveValue);
    setIsEditingReceiveAmount(false);
  };
  
  const handleReceiveAmountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleReceiveAmountSubmit();
    } else if (e.key === 'Escape') {
      setEditReceiveValue(displayReceiveAmount);
      setIsEditingReceiveAmount(false);
    }
  };

  // Helper to build a single monospaced line with spaces so the amount is flush-right
  const getPaddedRowText = (label: string, value: string | number) => {
    const amt = formatBalanceAligned(value);
    const totalChars = 28; // tune to fit the dropdown width
    const used = label.length + 1 + amt.length; // +1 for at least one space
    const spaces = Math.max(1, totalChars - used);
    return `${label}${' '.repeat(spaces)}${amt}`;
  };

  return <div className={cn("max-w-lg mx-auto", className)}>
      {/* From Section */}
      <div className={cn(
        "border rounded-2xl p-6 mb-2",
        willCloseAccount 
          ? "bg-destructive/5 border-destructive/50" 
          : "bg-card border-border"
      )}>
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">You send</span>
            {willCloseAccount && (
              <Badge variant="destructive" className="text-[10px] px-2 py-1 font-medium">
                <Merge className="h-3 w-3 mr-1" />
                Account Closure
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs bg-success/10 text-success hover:bg-success/20 hover:text-success border border-success/20" onClick={handleMaxClick}>
              MAX
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-4">
          <Select value={fromAsset} onValueChange={value => {
          const selectedAsset = availableAssets.find(asset => asset.code === value);
          onFromAssetChange(value, selectedAsset?.issuer);
        }}>
            <SelectTrigger className="min-w-32 max-w-48 h-12 rounded-full">
              <SelectValue>
                <div className="flex items-center gap-2 min-w-0">
                  <AssetIcon assetCode={fromAsset} assetIssuer={fromAssetIssuer} size={32} className="shrink-0" />
                  <span className="font-medium truncate">{fromAsset}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-card border border-border shadow-lg z-50 min-w-[280px]">
              {availableAssets.map(asset => (
                <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code} className="px-3 py-3" hideIndicator>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <AssetIcon assetCode={asset.code} assetIssuer={asset.issuer} size={24} />
                      <span className="font-medium">{asset.code}</span>
                    </div>
                    <span className="ml-4 w-40 shrink-0 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap tracking-normal">
                      {formatBalanceAligned(asset.balance)}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1 sm:min-w-0">
            {isEditingAmount ? <Input type="text" inputMode="decimal" value={editValue} onChange={e => {
            let sanitized = e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
            const parts = sanitized.split('.');
            if (parts.length > 2) sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
            if (parts[1] && parts[1].length > 7) sanitized = `${parts[0]}.${parts[1].substring(0, 7)}`;
            setEditValue(sanitized);
          }} onBlur={handleAmountSubmit} onKeyDown={handleAmountKeyDown} onFocus={e => e.currentTarget.select()} className="text-right text-xl font-mono border-none bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:ring-0 font-amount w-full" placeholder="0.0" autoFocus /> : <div className="text-right sm:text-right text-xl font-mono cursor-pointer p-2 rounded hover:bg-muted/30 transition-colors font-amount w-full" onClick={() => setIsEditingAmount(true)}>
                {amount ? formatAmount(amount) : '0.0'}
              </div>}
            {fiatValue && <div className="text-sm text-muted-foreground mt-1 text-right font-amount">
                ≈ {getCurrentCurrency().symbol}{fiatValue.replace(/[$€£¥₹]/g, '').replace(/\s[A-Z]{3}$/, '')}
              </div>}
          </div>
        </div>

        {/* Golden Slider */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Amount</span>
            <span className="font-amount">{Math.round(currentPercentage)}%</span>
          </div>
          <input type="range" min="0" max="100" step="1" value={sliderValue[0]} onChange={e => handleSliderChange([parseInt(e.target.value)])} className="stellar-slider w-full" style={{
          '--slider-progress': `${sliderValue[0]}%`
        } as React.CSSProperties} />
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span className="font-amount">Available: {formatBalance(availableAmount)} {fromAsset}</span>
          </div>
        </div>
      </div>

      {/* Swap Direction Button */}
      <div className="flex justify-center relative z-10 -my-4">
        <div className="relative">
          {/* Bending effect - inset shadow on cards */}
          <div className="absolute -top-2 -bottom-2 left-1/2 transform -translate-x-1/2 w-16 h-16 rounded-full shadow-[inset_0_0_20px_rgba(0,0,0,0.1)] pointer-events-none"></div>
          
          {!onSwapDirection ? <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 shadow-[0_8px_25px_-5px_rgba(147,51,234,0.4),0_0_0_6px_hsl(var(--background)),inset_0_2px_4px_rgba(255,255,255,0.2)] flex items-center justify-center relative">
              <ArrowDown className="h-5 w-5 text-white drop-shadow-sm" />
            </div> : <Button onClick={onSwapDirection} className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 shadow-[0_8px_25px_-5px_rgba(147,51,234,0.4),0_0_0_6px_hsl(var(--background)),inset_0_2px_4px_rgba(255,255,255,0.2)] transition-all duration-200 hover:shadow-[0_12px_30px_-5px_rgba(147,51,234,0.5),0_0_0_6px_hsl(var(--background)),inset_0_2px_4px_rgba(255,255,255,0.2)] relative" size="sm">
              <div className="flex items-center justify-center">
                <div className="relative">
                  <ArrowDown className="h-3 w-3 text-white absolute -top-1 drop-shadow-sm" />
                  <ArrowDown className="h-3 w-3 text-white absolute top-1 rotate-180 drop-shadow-sm" />
                </div>
              </div>
            </Button>}
        </div>
      </div>

      {/* To Section */}
      <div className="bg-card/60 border border-border/60 rounded-2xl p-6 mt-2">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-muted-foreground">They receive</span>
          {recipientAssets.length > 0 && <div className="text-sm text-muted-foreground truncate min-w-0">
              Current: <span className="font-amount">{formatBalance(toAssetBalance)}</span>
            </div>}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <Select 
            value={willCloseAccount ? "XLM" : (toAsset || "same")} 
            onValueChange={value => {
              if (willCloseAccount) return; // Prevent changes during account merge
              if (value === "same") {
                onToAssetChange();
              } else {
                const selectedAsset = recipientAssets.find(asset => asset.code === value);
                onToAssetChange(value, selectedAsset?.issuer);
              }
            }}
            disabled={willCloseAccount}
          >
            <SelectTrigger className={cn(
              "min-w-32 max-w-48 h-12 rounded-full",
              willCloseAccount && "cursor-not-allowed opacity-60"
            )}>
              <SelectValue>
                <div className="flex items-center gap-2 min-w-0">
                  <AssetIcon assetCode={willCloseAccount ? "XLM" : (toAsset || fromAsset)} assetIssuer={willCloseAccount ? "" : (toAssetIssuer || fromAssetIssuer)} size={32} className="shrink-0" />
                  <span className="font-medium truncate">{willCloseAccount ? "XLM" : (toAsset || fromAsset)}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-card border border-border shadow-lg z-50 min-w-[280px]">
              {/* Only show "same asset" option if recipient has trustline for it */}
              {recipientAssets.some(asset => asset.code === fromAsset) && (
                <SelectItem value="same" className="px-3 py-3" hideIndicator>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <AssetIcon assetCode={fromAsset} assetIssuer={fromAssetIssuer} size={24} />
                      <span className="text-muted-foreground">{fromAsset}</span>
                    </div>
                    <span className="ml-4 w-40 shrink-0 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap tracking-normal">
                      {formatBalanceAligned(toAssetBalance)}
                    </span>
                  </div>
                </SelectItem>
              )}
              {recipientAssets.filter(asset => asset.code !== fromAsset).map(asset => (
                <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code} className="px-3 py-3" hideIndicator>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <AssetIcon assetCode={asset.code} assetIssuer={asset.issuer} size={24} />
                      <span className="font-medium">{asset.code}</span>
                    </div>
                    <span className="ml-4 w-40 shrink-0 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap tracking-normal">
                      {formatBalanceAligned(asset.balance)}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1 sm:min-w-0">
            {isPathPayment && isManualInput ? (
              <div>
                {isEditingReceiveAmount ? (
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={editReceiveValue}
                    onChange={(e) => {
                      let sanitized = e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
                      const parts = sanitized.split('.');
                      if (parts.length > 2) sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
                      if (parts[1] && parts[1].length > 7) sanitized = `${parts[0]}.${parts[1].substring(0, 7)}`;
                      setEditReceiveValue(sanitized);
                    }}
                    onBlur={handleReceiveAmountSubmit}
                    onKeyDown={handleReceiveAmountKeyDown}
                    onFocus={e => e.currentTarget.select()}
                    className="text-right text-xl font-mono border-none bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:ring-0 font-amount w-full"
                    placeholder="0.0"
                    autoFocus
                  />
                ) : (
                  <div 
                    className="text-right sm:text-right text-xl font-mono cursor-pointer p-2 rounded hover:bg-muted/30 transition-colors font-amount text-white w-full"
                    onClick={() => {
                      setEditReceiveValue(displayReceiveAmount);
                      setIsEditingReceiveAmount(true);
                    }}
                  >
                    Min {manualReceiveAmount ? formatAmount(manualReceiveAmount) : '0.0'}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-1 text-right">Manual input</div>
              </div>
            ) : (
              <div className="text-right sm:text-right text-xl font-mono text-white font-amount w-full">
                {isPathPayment ? `Min ${displayReceiveAmount ? formatAmount(displayReceiveAmount) : '0.0'}` : amount ? formatAmount(amount) : '0.0'}
              </div>
            )}
          </div>
        </div>

        {/* Price Error Warning */}
        {isPathPayment && priceError && (
          <Alert className="mt-4 border-warning/50 bg-warning/5">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertDescription className="text-warning">
              {priceError}
            </AlertDescription>
          </Alert>
        )}

        {/* Slippage Tolerance Slider (only when cross-asset and no price error) */}
        {isPathPayment && !priceError && onSlippageToleranceChange && <div className="space-y-2 mt-4">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Slippage Tolerance</span>
              <span className="font-amount">{slippageTolerance.toFixed(1)}%</span>
            </div>
            <input type="range" min="0.1" max="5" step="0.1" value={slippageTolerance} onChange={e => onSlippageToleranceChange(parseFloat(e.target.value))} className="stellar-slider stellar-slider-purple w-full" style={{
          '--slider-progress': `${(slippageTolerance - 0.1) / 4.9 * 100}%`
        } as React.CSSProperties} />
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              {isManualInput && <span className="text-info text-xs">Adjusted for manual input</span>}
            </div>
          </div>}
      </div>
    </div>;
};