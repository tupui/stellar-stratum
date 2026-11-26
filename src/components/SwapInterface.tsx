import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowUpDown, ArrowDown, ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetIcon } from '@/components/AssetIcon';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatBalance, formatBalanceAligned, formatAmount, calculateBalancePercentage, validateAndCapAmount, priceKey } from '@/lib/balance-utils';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { useNetwork } from '@/contexts/NetworkContext';
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
  /** What can be sent of the selected asset, net of reserves and earlier operations. */
  availableBalance: number;
  fiatValue?: string;
  receiveAmount?: string;
  slippageTolerance?: number;
  onAmountChange: (amount: string) => void;
  onFromAssetChange: (asset: string, issuer?: string) => void;
  onToAssetChange: (asset?: string, issuer?: string) => void;
  onSlippageToleranceChange?: (tolerance: number) => void;
  onReceiveAmountChange?: (amount: string) => void;
  onSwapDirection?: () => void;
  exactOut?: boolean;
  onExactOutChange?: (exactOut: boolean) => void;
  className?: string;
  willCloseAccount?: boolean;
  assetPrices?: Record<string, number>;
  onFetchAssetPrice?: (assetCode: string, assetIssuer?: string) => Promise<number>;
}
const assetKey = (code?: string, issuer?: string) => (issuer ? `${code}:${issuer}` : code || '');

export const SwapInterface = ({
  fromAsset,
  fromAssetIssuer,
  toAsset,
  toAssetIssuer,
  amount,
  availableAssets,
  recipientAssets = [],
  availableBalance,
  fiatValue,
  receiveAmount,
  slippageTolerance = 0.5,
  onAmountChange,
  onFromAssetChange,
  onToAssetChange,
  onSlippageToleranceChange,
  onReceiveAmountChange,
  onSwapDirection,
  exactOut = false,
  onExactOutChange,
  className,
  willCloseAccount = false,
  assetPrices = {},
  onFetchAssetPrice
}: SwapInterfaceProps) => {
  const { network } = useNetwork();
  const [sliderValue, setSliderValue] = useState([0]);
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const [editValue, setEditValue] = useState(amount);
  const [isEditingReceiveAmount, setIsEditingReceiveAmount] = useState(false);
  const [editReceiveValue, setEditReceiveValue] = useState(receiveAmount || '');
  const [priceError, setPriceError] = useState<string>('');
  const [manualReceiveAmount, setManualReceiveAmount] = useState<string>('');
  const [isManualInput, setIsManualInput] = useState(false);
  const {
    getCurrentCurrency
  } = useFiatCurrency();
  // Assets are identified by code AND issuer: anyone can issue a token called "USDC".
  const sameAsset = (a: Asset, code?: string, issuer?: string) => a.code === code && (a.issuer || '') === (issuer || '');
  const fromAssetObject = availableAssets.find(a => sameAsset(a, fromAsset, fromAssetIssuer));
  const fromAssetBalance = fromAssetObject?.balance || '0';
  const receiveCode = toAsset || fromAsset;
  const receiveIssuer = toAsset ? toAssetIssuer : fromAssetIssuer;
  const toAssetBalance = recipientAssets.find(a => sameAsset(a, receiveCode, receiveIssuer))?.balance || '0';
  const recipientHasFromAsset = recipientAssets.some(a => sameAsset(a, fromAsset, fromAssetIssuer));

  const availableAmount = fromAssetObject ? availableBalance : 0;

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
  const isPathPayment = Boolean(toAsset) && (toAsset !== fromAsset || (toAssetIssuer || '') !== (fromAssetIssuer || ''));
  
  // Get prices from parent and fetch missing ones
  const fromPrice = assetPrices[priceKey(fromAsset, fromAssetIssuer)] || 0;
  const toPrice = assetPrices[priceKey(toAsset, toAssetIssuer)] || 0;
  
  // Fetch missing prices in background without blocking UI
  useEffect(() => {
    if (!isPathPayment || !onFetchAssetPrice) return;
    
    // Start with assuming manual input is needed
    if (fromPrice <= 0 || toPrice <= 0) {
      setPriceError(`Exchange rate not available. Please enter minimum receive amount manually.`);
      setIsManualInput(true);
    } else {
      setPriceError('');
      setIsManualInput(false);
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
          const newFromPrice = assetPrices[priceKey(fromAsset, fromAssetIssuer)] || 0;
          const newToPrice = assetPrices[priceKey(toAsset, toAssetIssuer)] || 0;
          
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
  }, [isPathPayment, fromAsset, toAsset, fromAssetIssuer, toAssetIssuer, onFetchAssetPrice, fromPrice, toPrice, assetPrices]);
  
  // Calculate receive amount based on prices or manual input
  const calculateReceiveAmount = () => {
    if (!isPathPayment) return amount;
    if (isManualInput && manualReceiveAmount) return manualReceiveAmount;
    if (receiveAmount) return receiveAmount;
    
    const numAmount = parseFloat(amount);
    if (!numAmount) return '0';
    
    const fromPrice = assetPrices[priceKey(fromAsset, fromAssetIssuer)] || 0;
    const toPrice = assetPrices[priceKey(toAsset, toAssetIssuer)] || 0;
    
    if (fromPrice > 0 && toPrice > 0) {
      const usdValue = numAmount * fromPrice;
      const convertedAmount = usdValue / toPrice;
      const slippageAdjustment = 1 - (slippageTolerance / 100);
      return (convertedAmount * slippageAdjustment).toFixed(7);
    }
    
    return '0';
  };
  
  const displayReceiveAmount = calculateReceiveAmount();

  // For exact-out mode: calculate the max send amount from the exact receive amount
  const calculateSendMax = () => {
    if (!isPathPayment || !exactOut) return amount;
    const destAmt = parseFloat(receiveAmount || manualReceiveAmount || '0');
    if (!destAmt) return '0';
    const fp = assetPrices[priceKey(fromAsset, fromAssetIssuer)] || 0;
    const tp = assetPrices[priceKey(toAsset, toAssetIssuer)] || 0;
    if (fp > 0 && tp > 0) {
      const buffer = 1 + (slippageTolerance / 100);
      return (destAmt * (tp / fp) * buffer).toFixed(7);
    }
    return '0';
  };

  const displaySendMax = calculateSendMax();

  // Handle manual receive amount input
  const handleReceiveAmountChange = (newAmount: string) => {
    setManualReceiveAmount(newAmount);
    setIsManualInput(true);
    onReceiveAmountChange?.(newAmount);
    
    // Adjust slippage based on manual input vs calculated amount
    if (onSlippageToleranceChange && amount && newAmount) {
      const numAmount = parseFloat(amount);
      const numReceiveAmount = parseFloat(newAmount);
      const fromPrice = assetPrices[priceKey(fromAsset, fromAssetIssuer)] || 0;
      const toPrice = assetPrices[priceKey(toAsset, toAssetIssuer)] || 0;
      
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

  const getAssetExplorerUrl = (assetCode: string, assetIssuer?: string): string => {
    const networkPath = network === 'testnet' ? 'testnet' : 'public';
    // Only the issuer-less asset is native XLM: a token can be called "XLM" too.
    if (!assetIssuer) {
      return `https://stellar.expert/explorer/${networkPath}/asset/XLM`;
    }
    return `https://stellar.expert/explorer/${networkPath}/asset/${assetCode}-${assetIssuer}`;
  };

  const sanitizeAmount = (raw: string) => {
    let sanitized = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
    const parts = sanitized.split('.');
    if (parts.length > 2) sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
    if (parts[1] && parts[1].length > 7) sanitized = `${parts[0]}.${parts[1].substring(0, 7)}`;
    return sanitized;
  };

  // a 4 px track and a square 16 px white thumb
  const squareSlider =
    'h-1 rounded-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-none [&::-webkit-slider-thumb]:hover:scale-100 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground';
  // the builder's amount: pixel 40, white; muted while nothing is entered
  const figure = 'min-w-0 break-all text-right font-pix text-[40px] leading-none';
  const amountInput = 'h-12 border-line-2 bg-ink px-2 text-right font-pix text-[40px] leading-none';
  const assetTrigger = 'h-12 w-auto min-w-32 max-w-48 shrink-0 gap-2 px-3 [&>span]:min-w-0';

  const assetOption = (code: string, issuer: string | undefined, balance: string, link: boolean) => (
    <div className="flex w-full items-center justify-between">
      <div className="flex items-center gap-3">
        <AssetIcon assetCode={code} assetIssuer={issuer} size={24} />
        {link ? (
          <a
            href={getAssetExplorerUrl(code, issuer)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {code}
            {issuer && <span className="ml-1 font-address text-xs text-muted-foreground">{issuer.slice(0, 4)}…{issuer.slice(-4)}</span>}
          </a>
        ) : (
          <span className="text-muted-foreground">{code}</span>
        )}
      </div>
      <span className="ml-4 w-40 shrink-0 whitespace-nowrap text-right font-amount tabular-nums tracking-normal text-muted-foreground">
        {formatBalanceAligned(balance)}
      </span>
    </div>
  );

  const selected = (code: string, issuer?: string) => (
    <div className="flex min-w-0 items-center gap-2">
      <AssetIcon assetCode={code} assetIssuer={issuer} size={24} className="shrink-0" />
      <span className="truncate font-semibold">{code}</span>
    </div>
  );

  const editableFigure = (value: string, placeholder: string, onClick: () => void) => (
    <div
      className={cn(figure, 'flex min-h-11 cursor-pointer items-center justify-end', !value && 'text-muted-foreground')}
      onClick={onClick}
    >
      {value || placeholder}
    </div>
  );

  const receiveInput = (
    <Input
      type="text"
      inputMode="decimal"
      value={editReceiveValue}
      onChange={(e) => setEditReceiveValue(sanitizeAmount(e.target.value))}
      onBlur={handleReceiveAmountSubmit}
      onKeyDown={handleReceiveAmountKeyDown}
      onFocus={(e) => e.currentTarget.select()}
      className={amountInput}
      placeholder="0.0"
      autoFocus
    />
  );

  return <div className={cn("grid items-start lg:grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] lg:gap-4", className)}>
      {/* You send */}
      <div className={cn('well p-4', willCloseAccount && 'border border-destructive')}>
        <div className="flex min-h-11 items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">
              {isPathPayment && exactOut ? 'You pay (max)' : 'You send'}
            </span>
            {willCloseAccount && (
              <Badge variant="destructive">
                Account Closure
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isPathPayment && onExactOutChange && (
              <div className="flex border border-line-2 text-sm font-semibold" role="group" aria-label="Amount fixed on">
                {([false, true] as const).map((out) => (
                  <button
                    key={String(out)}
                    type="button"
                    aria-pressed={exactOut === out}
                    onClick={() => onExactOutChange(out)}
                    className={cn(
                      'min-h-11 px-3 first:border-r first:border-line-2',
                      exactOut === out ? 'bg-foreground text-ink' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {out ? 'Exact Out' : 'Exact In'}
                  </button>
                ))}
              </div>
            )}
            {!exactOut && (
              <Button variant="outline" size="sm" onClick={handleMaxClick}>
                MAX
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Select value={assetKey(fromAsset, fromAssetIssuer)} onValueChange={value => {
          const selectedAsset = availableAssets.find(asset => assetKey(asset.code, asset.issuer) === value);
          if (selectedAsset) onFromAssetChange(selectedAsset.code, selectedAsset.issuer);
        }}>
            <SelectTrigger className={assetTrigger} aria-label="Asset to send">
              <SelectValue>{selected(fromAsset, fromAssetIssuer)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="z-50 min-w-[280px]">
              {availableAssets.map(asset => (
                <SelectItem key={assetKey(asset.code, asset.issuer)} value={assetKey(asset.code, asset.issuer)} className="px-3 py-3" hideIndicator>
                  {assetOption(asset.code, asset.issuer, asset.balance, true)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="min-w-0 flex-1 text-right">
            {isPathPayment && exactOut ? (
              <div className={cn(figure, 'text-muted-foreground')}>
                {displaySendMax !== '0' ? `≤ ${formatAmount(displaySendMax)}` : '—'}
              </div>
            ) : isEditingAmount ? (
              <Input type="text" inputMode="decimal" value={editValue} onChange={e => setEditValue(sanitizeAmount(e.target.value))} onBlur={handleAmountSubmit} onKeyDown={handleAmountKeyDown} onFocus={e => e.currentTarget.select()} className={amountInput} placeholder="0.0" aria-label="Amount to send" autoFocus />
            ) : (
              <div role="button" tabIndex={0} aria-label="Edit amount to send" className={cn(figure, 'flex min-h-11 cursor-pointer items-center justify-end focus-visible:outline-2 focus-visible:outline-ring', !amount && 'text-muted-foreground')} onClick={() => setIsEditingAmount(true)} onKeyDown={e => { if (e.key === 'Enter') setIsEditingAmount(true); }}>
                {amount ? formatAmount(amount) : '0.0'}
              </div>
            )}
            {fiatValue && !exactOut && <div className="mt-1 text-[13px] text-muted-foreground">
                ≈ {getCurrentCurrency().symbol}{fiatValue.replace(/[$€£¥₹]/g, '').replace(/\s[A-Z]{3}$/, '')}
              </div>}
          </div>
        </div>

        {/* Slider: hidden in exact-out mode, where the amount received is the one entered */}
        {!(isPathPayment && exactOut) && (
          <div className="mt-4">
            <div className="flex justify-between text-[13px] text-muted-foreground">
              <span>Amount</span>
              <span className="tabular-nums">{Math.round(currentPercentage)}%</span>
            </div>
            <input type="range" min="0" max="100" step="1" value={sliderValue[0]} onChange={e => handleSliderChange([parseInt(e.target.value)])} aria-label="Amount" className={cn('stellar-slider mt-2 w-full', squareSlider)} style={{
            '--slider-progress': `${sliderValue[0]}%`,
            '--muted': 'var(--line-2)',
          } as React.CSSProperties} />
            <div className="mt-1 text-[13px] tabular-nums text-muted-foreground">
              Available: {formatBalance(availableAmount)} {fromAsset}
            </div>
          </div>
        )}
      </div>

      {/* Between the two: down on the phone, right on desktop */}
      <div className="relative z-10 -my-2 grid place-items-center lg:my-0 lg:self-center" aria-hidden="true">
        {!onSwapDirection ? (
          <span className="grid size-10 place-items-center border border-line-2 bg-ink">
            <ArrowDown className="h-4 w-4 lg:hidden" />
            <ArrowRight className="hidden h-4 w-4 lg:block" />
          </span>
        ) : (
          <Button onClick={onSwapDirection} variant="outline" size="icon" className="bg-ink">
            <ArrowUpDown />
          </Button>
        )}
      </div>

      {/* They receive */}
      <div className="flex flex-col gap-4">
      <div className="well p-4">
        <div className="flex min-h-11 items-center justify-between gap-2">
          <span className="text-[13px] text-muted-foreground">
            {isPathPayment && exactOut ? 'They receive (exact)' : 'They receive'}
          </span>
          {recipientAssets.length > 0 && <div className="min-w-0 truncate text-[13px] text-muted-foreground">
              Current <span className="tabular-nums text-foreground">{formatBalance(toAssetBalance)}</span>
            </div>}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Select 
            value={willCloseAccount ? "XLM" : (toAsset && !(toAsset === fromAsset && (toAssetIssuer || '') === (fromAssetIssuer || '')) ? assetKey(toAsset, toAssetIssuer) : "same")} 
            onValueChange={value => {
              if (willCloseAccount) return; // Prevent changes during account merge
              if (value === "same") {
                onToAssetChange();
              } else {
                const selectedAsset = recipientAssets.find(asset => assetKey(asset.code, asset.issuer) === value);
                if (selectedAsset) onToAssetChange(selectedAsset.code, selectedAsset.issuer);
              }
            }}
            disabled={willCloseAccount}
          >
            <SelectTrigger className={cn(assetTrigger, willCloseAccount && "cursor-not-allowed opacity-60")} aria-label="Asset they receive">
              <SelectValue>
                {selected(willCloseAccount ? "XLM" : (toAsset || fromAsset), willCloseAccount ? "" : (toAssetIssuer || fromAssetIssuer))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-50 min-w-[280px]">
              {/* Only show "same asset" option if recipient has trustline for it */}
              {recipientHasFromAsset && (
                <SelectItem value="same" className="px-3 py-3" hideIndicator>
                  {assetOption(fromAsset, fromAssetIssuer, toAssetBalance, false)}
                </SelectItem>
              )}
              {recipientAssets.filter(asset => !sameAsset(asset, fromAsset, fromAssetIssuer)).map(asset => (
                <SelectItem key={assetKey(asset.code, asset.issuer)} value={assetKey(asset.code, asset.issuer)} className="px-3 py-3" hideIndicator>
                  {assetOption(asset.code, asset.issuer, asset.balance, true)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="min-w-0 flex-1 text-right">
            {isPathPayment && exactOut ? (
              // Exact Out: receive amount is the primary editable input
              <div>
                {isEditingReceiveAmount ? receiveInput : editableFigure(
                  receiveAmount || manualReceiveAmount ? formatAmount(receiveAmount || manualReceiveAmount) : '',
                  '0.0',
                  () => {
                    setEditReceiveValue(receiveAmount || manualReceiveAmount || '');
                    setIsEditingReceiveAmount(true);
                  },
                )}
                <div className="mt-1 text-[13px] text-muted-foreground">Exact amount</div>
              </div>
            ) : isPathPayment && isManualInput ? (
              // Exact In, manual input (no prices available)
              <div>
                {isEditingReceiveAmount ? receiveInput : editableFigure(
                  `Min ${manualReceiveAmount ? formatAmount(manualReceiveAmount) : '0.0'}`,
                  '',
                  () => {
                    setEditReceiveValue(displayReceiveAmount);
                    setIsEditingReceiveAmount(true);
                  },
                )}
                <div className="mt-1 text-[13px] text-muted-foreground">Manual input</div>
              </div>
            ) : (
              <div className={cn(figure, !isPathPayment && !amount && 'text-muted-foreground')}>
                {isPathPayment ? `Min ${displayReceiveAmount ? formatAmount(displayReceiveAmount) : '0.0'}` : amount ? formatAmount(amount) : '0.0'}
              </div>
            )}
          </div>
        </div>

        {/* Price Error Warning */}
        {isPathPayment && priceError && (
          <div className="notice amber mt-4">
            <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden="true" />
            <p>{priceError}</p>
          </div>
        )}
      </div>

      {/* Slippage tolerance, under the two cards */}
      {isPathPayment && !priceError && onSlippageToleranceChange && (
        <div className="well p-4">
          <div className="flex justify-between text-[13px] text-muted-foreground">
            <span>Slippage tolerance</span>
            <span className="tabular-nums">{slippageTolerance.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={slippageTolerance}
            onChange={e => onSlippageToleranceChange(parseFloat(e.target.value))}
            aria-label="Slippage tolerance"
            className={cn('stellar-slider mt-2 w-full', squareSlider)}
            // white fill: acid is kept for the amount being sent
            style={{
              '--slider-progress': `${(slippageTolerance - 0.1) / 4.9 * 100}%`,
              '--muted': 'var(--line-2)',
              '--primary': 'var(--foreground)',
              '--primary-glow': 'var(--foreground)',
            } as React.CSSProperties}
          />
          {isManualInput && (
            <div className="mt-1 text-[13px] text-muted-foreground">Adjusted for manual input</div>
          )}
        </div>
      )}
      </div>
    </div>;
};
