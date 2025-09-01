import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as SelectPrimitive from '@radix-ui/react-select';
import { AlertTriangle, Check, Info } from 'lucide-react';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { DestinationAccountInfo } from './DestinationAccountInfo';

interface PaymentData {
  destination: string;
  amount: string;
  asset: string;
  assetIssuer: string;
  memo: string;
}

interface Asset {
  code: string;
  issuer: string;
  name: string;
  balance: string;
  price: number;
}

interface PaymentFormProps {
  paymentData: PaymentData;
  onPaymentDataChange: (data: PaymentData) => void;
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
  trustlineError: string;
  onBuild: () => void;
  isBuilding: boolean;
}

export const PaymentForm = ({ 
  paymentData, 
  onPaymentDataChange,
  availableAssets,
  assetPrices,
  trustlineError,
  onBuild,
  isBuilding 
}: PaymentFormProps) => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const [fiatValue, setFiatValue] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('0.0');
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  // Update fiat value when amount, asset, or currency changes
  useEffect(() => {
    const updateFiatValue = async () => {
      if (!paymentData.amount || !paymentData.asset) {
        setFiatValue('');
        return;
      }

      const price = assetPrices[paymentData.asset] || 0;
      if (price === 0) {
        setFiatValue('N/A');
        return;
      }

      const usdValue = parseFloat(paymentData.amount) * price;
      if (quoteCurrency === 'USD') {
        setFiatValue(`$${usdValue.toFixed(2)}`);
      } else {
        try {
          const convertedValue = await convertFromUSD(usdValue, quoteCurrency);
          const currency = getCurrentCurrency();
          setFiatValue(`${currency?.symbol || ''}${convertedValue.toFixed(2)}`);
        } catch (error) {
          setFiatValue(`$${usdValue.toFixed(2)}`);
        }
      }
    };

    updateFiatValue();
  }, [paymentData.amount, paymentData.asset, quoteCurrency, assetPrices, getCurrentCurrency]);

  const formatDisplayAmount = (value: string | number) => {
    const s = String(value);
    if (s === '' || s === '0') return '0.0';
    if (!s.includes('.')) return `${s}.0`;
    const [int, dec] = s.split('.');
    return `${int}.${dec}`;
  };

  // Sync the display value when not actively editing (e.g., slider or asset changes)
  useEffect(() => {
    if (isEditingAmount) return;
    const amt = paymentData.amount;
    if (!amt) {
      setAmountInput('0.0');
    } else {
      setAmountInput(formatDisplayAmount(amt));
    }
  }, [paymentData.amount, paymentData.asset, isEditingAmount]);

  const getSelectedAssetInfo = () => {
    return availableAssets.find(asset => asset.code === paymentData.asset);
  };
  const handleMaxAmount = () => {
    const selectedAsset = getSelectedAssetInfo();
    if (selectedAsset) {
      // Reserve some XLM for fees
      const maxAmount = selectedAsset.code === 'XLM' 
        ? Math.max(0, parseFloat(selectedAsset.balance) - 0.5).toString()
        : selectedAsset.balance;
      onPaymentDataChange({ ...paymentData, amount: maxAmount });
    }
  };

  // Check if form is valid for payment build
  const isFormValid = paymentData.destination && 
    paymentData.amount && 
    paymentData.asset &&
    (paymentData.asset === 'XLM' || paymentData.assetIssuer) &&
    (!trustlineError || trustlineError.includes('will create a new'));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="destination">Destination Address</Label>
            <Input
              id="destination"
              placeholder="GABC..."
              maxLength={56}
              value={paymentData.destination}
              onChange={(e) => onPaymentDataChange({ ...paymentData, destination: e.target.value })}
              className="text-xs sm:text-sm"
            />
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Amount</Label>
              {fiatValue && (
                <span className="text-xs text-muted-foreground">≈ {fiatValue}</span>
              )}
            </div>
            <div className="flex gap-1">
              <Input
                id="amount"
                type="text"
                placeholder="0.0"
                inputMode="decimal"
                value={amountInput}
                onFocus={() => setIsEditingAmount(true)}
                onBlur={() => {
                  const maxAmount = getSelectedAssetInfo()?.code === 'XLM'
                    ? Math.max(0, parseFloat(getSelectedAssetInfo()!.balance) - 0.5)
                    : parseFloat(getSelectedAssetInfo()?.balance || '0');
                  const numeric = parseFloat(amountInput.replace(/,/g, ''));
                  const clamped = isNaN(numeric) ? 0 : Math.min(Math.max(0, numeric), maxAmount);
                  const rounded = Number(clamped.toFixed(7));
                  onPaymentDataChange({ ...paymentData, amount: rounded ? rounded.toString() : '' });
                  const formatDisplayAmount = (val: string | number) => {
                    const s = String(val);
                    if (s === '' || s === '0') return '0.0';
                    if (!s.includes('.')) return `${s}.0`;
                    const [int, dec] = s.split('.');
                    return `${int}.${dec}`;
                  };
                  setAmountInput(formatDisplayAmount(rounded.toString()));
                  setIsEditingAmount(false);
                }}
                onChange={(e) => {
                  const v = e.target.value;
                  // allow only digits and a single dot
                  const sanitized = v.replace(/[^0-9.]/g, '');
                  const parts = sanitized.split('.');
                  const normalized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : sanitized;
                  setAmountInput(normalized);

                  const num = parseFloat(normalized);
                  if (!isNaN(num)) {
                    const precise = Number(num.toFixed(7)).toString();
                    onPaymentDataChange({ ...paymentData, amount: precise });
                  } else {
                    onPaymentDataChange({ ...paymentData, amount: '' });
                  }
                }}
                className="flex-1 text-xs sm:text-sm"
              />
              <Select
                value={paymentData.asset}
                onValueChange={(value) => {
                  const selectedAsset = availableAssets.find(asset => asset.code === value);
                  onPaymentDataChange({ 
                    ...paymentData, 
                    asset: value,
                    assetIssuer: selectedAsset?.issuer || '',
                    amount: '' // Reset amount when changing asset
                  });
                }}
              >
                <SelectTrigger className="w-20 sm:w-24">
                  <SelectValue>
                    <span className="font-medium text-xs sm:text-sm">{paymentData.asset}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="min-w-[300px] max-h-64 overflow-y-auto z-50 bg-popover border border-border shadow-lg">
                  {/* Header */}
                  <div className="sticky top-0 z-[100] grid grid-cols-[80px_1fr] items-center gap-3 pl-8 pr-2 py-3 text-[11px] text-muted-foreground bg-card/95 backdrop-blur-sm border-b border-border shadow-md">
                    <span className="uppercase tracking-wider font-medium">Asset</span>
                    <span className="text-right uppercase tracking-wider font-medium">Balance</span>
                  </div>
                  {/* Items */}
                  {availableAssets.map((asset) => {
                    const balance = parseFloat(asset.balance);
                    const formattedBalance = balance.toLocaleString('en-US', {
                      minimumFractionDigits: 7,
                      maximumFractionDigits: 7,
                      useGrouping: true,
                    });
                    return (
                      <SelectPrimitive.Item
                        key={`${asset.code}-${asset.issuer}`}
                        value={asset.code}
                        className="relative rounded-sm py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-accent/50 cursor-pointer"
                      >
                        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                          <SelectPrimitive.ItemIndicator>
                            <Check className="h-4 w-4" />
                          </SelectPrimitive.ItemIndicator>
                        </span>
                        <SelectPrimitive.ItemText>
                          <div className="grid grid-cols-[80px_1fr] items-center gap-3">
                            <span className="font-medium">{asset.code}</span>
                            <span className="font-address tabular-nums text-right text-xs text-muted-foreground">{formattedBalance}</span>
                          </div>
                        </SelectPrimitive.ItemText>
                      </SelectPrimitive.Item>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        
        {/* Enhanced Slider */}
        {getSelectedAssetInfo() && (
          <div className="space-y-3">
            <div className="relative">
              <input
                type="range"
                min="0"
                max={getSelectedAssetInfo()!.code === 'XLM' 
                  ? Math.max(0, parseFloat(getSelectedAssetInfo()!.balance) - 0.5)
                  : parseFloat(getSelectedAssetInfo()!.balance)
                }
                step="1"
                value={paymentData.amount || '0'}
                onChange={(e) => onPaymentDataChange({ ...paymentData, amount: e.target.value })}
                className="stellar-slider w-full"
                style={{
                  '--slider-progress': `${((parseFloat(paymentData.amount) || 0) / parseFloat(getSelectedAssetInfo()!.code === 'XLM' 
                    ? Math.max(0, parseFloat(getSelectedAssetInfo()!.balance) - 0.5).toString()
                    : getSelectedAssetInfo()!.balance)) * 100}%`
                } as React.CSSProperties}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Available: {parseFloat(getSelectedAssetInfo()!.balance).toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 7,
                useGrouping: true
              })} {paymentData.asset}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMaxAmount}
                className="h-auto p-1 text-xs text-primary hover:text-primary/80"
              >
                Max
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="memo">Memo (Optional)</Label>
        <Input
          id="memo"
          placeholder="Payment description"
          value={paymentData.memo}
          onChange={(e) => onPaymentDataChange({ ...paymentData, memo: e.target.value })}
        />
      </div>
      
      {/* Destination Account Info */}
      {paymentData.destination && (
        <DestinationAccountInfo destination={paymentData.destination} />
      )}
      
      {/* Account Status Info */}
      {trustlineError && (
        <div className={`p-4 rounded-lg border ${
          trustlineError.includes('will create a new') 
            ? 'bg-muted/50 border-border' 
            : 'bg-destructive/10 border-destructive/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              trustlineError.includes('will create a new')
                ? 'bg-muted'
                : 'bg-destructive/10'
            }`}>
              {trustlineError.includes('will create a new') ? (
                <Info className="w-4 h-4 text-muted-foreground" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-destructive" />
              )}
            </div>
            <div className="flex-1">
              <p className={`text-sm font-medium ${
                trustlineError.includes('will create a new')
                  ? 'text-foreground'
                  : 'text-foreground'
              }`}>
                {trustlineError}
              </p>
            </div>
          </div>
        </div>
      )}
      
      <Button 
        onClick={onBuild} 
        disabled={isBuilding || !isFormValid}
        className="w-full bg-gradient-primary hover:opacity-90 disabled:opacity-50"
      >
        {isBuilding ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
            Building Transaction...
          </div>
        ) : trustlineError?.includes('will create a new') ? (
          'Create New Account'
        ) : (
          'Build Payment Transaction'
        )}
      </Button>
    </div>
  );
};