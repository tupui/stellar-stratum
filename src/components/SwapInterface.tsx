import { useState, useEffect } from 'react';
import { ArrowUpDown, ArrowDown, Merge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetIcon } from '@/components/AssetIcon';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { calculateAvailableBalance, formatBalance, formatBalanceAligned, formatAmount, calculateBalancePercentage, validateAndCapAmount } from '@/lib/balance-utils';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
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
  onSwapDirection?: () => void;
  className?: string;
  willCloseAccount?: boolean;
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
  onSwapDirection,
  className,
  willCloseAccount = false
}: SwapInterfaceProps) => {
  const [sliderValue, setSliderValue] = useState([0]);
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const [editValue, setEditValue] = useState(amount);
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
  const displayReceiveAmount = isPathPayment ? receiveAmount || amount : amount;
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

        <div className="flex items-center gap-4 mb-4">
          <Select value={fromAsset} onValueChange={value => {
          const selectedAsset = availableAssets.find(asset => asset.code === value);
          onFromAssetChange(value, selectedAsset?.issuer);
        }}>
            <SelectTrigger className="w-32 h-12 rounded-full">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <AssetIcon assetCode={fromAsset} assetIssuer={fromAssetIssuer} size={32} />
                  <span className="font-medium">{fromAsset}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-card border border-border shadow-lg z-50 min-w-[280px]">
              {availableAssets.map(asset => <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code} className="px-3 py-3" hideIndicator>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <AssetIcon assetCode={asset.code} assetIssuer={asset.issuer} size={24} />
                      <span className="font-medium">{asset.code}</span>
                    </div>
                    <span className="text-sm font-mono tabular-nums text-muted-foreground whitespace-nowrap ml-4 w-32 shrink-0 font-amount" style={{
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em'
                }}>
                      {formatBalanceAligned(asset.balance)}
                    </span>
                  </div>
                </SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex-1">
            {isEditingAmount ? <Input type="text" inputMode="decimal" value={editValue} onChange={e => {
            let sanitized = e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
            const parts = sanitized.split('.');
            if (parts.length > 2) sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
            if (parts[1] && parts[1].length > 7) sanitized = `${parts[0]}.${parts[1].substring(0, 7)}`;
            setEditValue(sanitized);
          }} onBlur={handleAmountSubmit} onKeyDown={handleAmountKeyDown} onFocus={e => e.currentTarget.select()} className="text-right text-xl font-mono border-none bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:ring-0 font-amount" placeholder="0.0" autoFocus /> : <div className="text-right text-xl font-mono cursor-pointer p-2 rounded hover:bg-muted/30 transition-colors font-amount" onClick={() => setIsEditingAmount(true)}>
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
          {recipientAssets.length > 0 && <div className="text-sm text-muted-foreground">
              Current: <span className="font-amount">{formatBalance(toAssetBalance)}</span>
            </div>}
        </div>

        <div className="flex items-center gap-4">
          <Select value={toAsset || "same"} onValueChange={value => {
          if (value === "same") {
            onToAssetChange();
          } else {
            const selectedAsset = recipientAssets.find(asset => asset.code === value);
            onToAssetChange(value, selectedAsset?.issuer);
          }
        }}>
            <SelectTrigger className="w-32 h-12 rounded-full">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <AssetIcon assetCode={toAsset || fromAsset} assetIssuer={toAssetIssuer || fromAssetIssuer} size={32} />
                  <span className="font-medium">{toAsset || fromAsset}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-card border border-border shadow-lg z-50 min-w-[280px]">
              <SelectItem value="same" className="px-3 py-3" hideIndicator>
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3">
                    <AssetIcon assetCode={fromAsset} assetIssuer={fromAssetIssuer} size={24} />
                    <span className="text-muted-foreground">{fromAsset}</span>
                  </div>
                  <span className="text-sm font-mono tabular-nums text-muted-foreground whitespace-nowrap ml-4 w-32 shrink-0 font-amount" style={{
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em'
                }}>
                    {formatBalanceAligned(toAssetBalance)}
                  </span>
                </div>
              </SelectItem>
              {recipientAssets.filter(asset => asset.code !== fromAsset).map(asset => <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code} className="px-3 py-3" hideIndicator>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <AssetIcon assetCode={asset.code} assetIssuer={asset.issuer} size={24} />
                      <span className="font-medium">{asset.code}</span>
                    </div>
                    <span className="text-sm font-mono tabular-nums text-muted-foreground whitespace-nowrap ml-4 w-32 shrink-0 font-amount" style={{
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em'
                }}>
                      {formatBalanceAligned(asset.balance)}
                    </span>
                  </div>
                </SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex-1 text-right">
            <div className="text-xl font-mono text-white font-amount">
              {isPathPayment ? `Min ${receiveAmount ? formatAmount(receiveAmount) : '0.0'}` : amount ? formatAmount(amount) : '0.0'}
            </div>
          </div>
        </div>

        {/* Slippage Tolerance Slider (only when cross-asset) */}
        {isPathPayment && onSlippageToleranceChange && <div className="space-y-2 mt-4">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Slippage Tolerance</span>
              <span className="font-amount">{slippageTolerance.toFixed(1)}%</span>
            </div>
            <input type="range" min="0.1" max="5" step="0.1" value={slippageTolerance} onChange={e => onSlippageToleranceChange(parseFloat(e.target.value))} className="stellar-slider stellar-slider-purple w-full" style={{
          '--slider-progress': `${(slippageTolerance - 0.1) / 4.9 * 100}%`
        } as React.CSSProperties} />
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              
            </div>
          </div>}
      </div>
    </div>;
};