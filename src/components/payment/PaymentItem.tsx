import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { DestinationAccountInfo } from './DestinationAccountInfo';

interface Payment {
  id: string;
  destination: string;
  amount: string;
  asset: string;
  assetIssuer: string;
  memo: string;
  percentage: number;
}

interface Asset {
  code: string;
  issuer: string;
  name: string;
  balance: string;
  price: number;
}

interface PaymentItemProps {
  payment: Payment;
  index: number;
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
  maxAmount: number;
  onUpdate: (updates: Partial<Payment>) => void;
  onUpdatePercentage: (percentage: number) => void;
  onRemove?: () => void;
}

export const PaymentItem = ({
  payment,
  index,
  availableAssets,
  assetPrices,
  maxAmount,
  onUpdate,
  onUpdatePercentage,
  onRemove
}: PaymentItemProps) => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const [fiatValue, setFiatValue] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('0.0');
  const [isEditingAmount, setIsEditingAmount] = useState(false);

  // Update fiat value when amount changes
  useEffect(() => {
    const updateFiatValue = async () => {
      if (!payment.amount || !payment.asset) {
        setFiatValue('');
        return;
      }

      const price = assetPrices[payment.asset] || 0;
      if (price === 0) {
        setFiatValue('N/A');
        return;
      }

      const usdValue = parseFloat(payment.amount) * price;
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
  }, [payment.amount, payment.asset, quoteCurrency, assetPrices, getCurrentCurrency]);

  // Sync input display
  useEffect(() => {
    if (isEditingAmount) return;
    const amt = payment.amount;
    if (!amt || amt === '0') {
      setAmountInput('0.0');
    } else {
      const formatted = !amt.includes('.') ? `${amt}.0` : amt;
      setAmountInput(formatted);
    }
  }, [payment.amount, payment.asset, isEditingAmount]);

  const handleAmountChange = (newAmount: string) => {
    const numericAmount = parseFloat(newAmount) || 0;
    const percentage = maxAmount > 0 ? (numericAmount / maxAmount) * 100 : 0;
    onUpdate({ 
      amount: newAmount,
      percentage: Math.min(100, percentage)
    });
  };

  const handleSliderChange = (value: number[]) => {
    const percentage = value[0];
    onUpdatePercentage(percentage);
  };

  const handleMaxAmount = () => {
    onUpdate({ 
      amount: maxAmount.toString(),
      percentage: 100
    });
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Payment #{index + 1}</h3>
            {onRemove && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRemove}
                className="text-destructive hover:text-destructive/80"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Destination */}
          <div className="space-y-2">
            <Label htmlFor={`destination-${payment.id}`}>Destination Address</Label>
            <Input
              id={`destination-${payment.id}`}
              placeholder="GABC..."
              maxLength={56}
              value={payment.destination}
              onChange={(e) => onUpdate({ destination: e.target.value })}
              className="text-xs sm:text-sm font-address"
            />
          </div>

          {/* Amount and Asset */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px] gap-4 items-end">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`amount-${payment.id}`}>Amount</Label>
                {fiatValue && (
                  <span className="text-xs text-muted-foreground">≈ {fiatValue}</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id={`amount-${payment.id}`}
                  type="text"
                  placeholder="0.0"
                  inputMode="decimal"
                  className="font-amount flex-1"
                  value={amountInput}
                  onFocus={() => setIsEditingAmount(true)}
                  onBlur={() => {
                    const numeric = parseFloat(amountInput.replace(/,/g, ''));
                    const clamped = isNaN(numeric) ? 0 : Math.min(Math.max(0, numeric), maxAmount);
                    const rounded = Number(clamped.toFixed(7));
                    handleAmountChange(rounded.toString());
                    
                    const formatted = rounded === 0 ? '0.0' : 
                      !rounded.toString().includes('.') ? `${rounded}.0` : rounded.toString();
                    setAmountInput(formatted);
                    setIsEditingAmount(false);
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    const sanitized = v.replace(/[^0-9.]/g, '');
                    const parts = sanitized.split('.');
                    const normalized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : sanitized;
                    setAmountInput(normalized);

                    const num = parseFloat(normalized);
                    if (!isNaN(num)) {
                      const precise = Number(num.toFixed(7)).toString();
                      handleAmountChange(precise);
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleMaxAmount}
                  className="px-3"
                >
                  Max
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Asset</Label>
              <Select
                value={payment.asset}
                onValueChange={(value) => {
                  const selectedAsset = availableAssets.find(asset => asset.code === value);
                  onUpdate({ 
                    asset: value,
                    assetIssuer: selectedAsset?.issuer || '',
                    amount: '' // Reset amount when changing asset
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableAssets.map((asset) => (
                    <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code}>
                      <div className="flex justify-between w-full">
                        <span>{asset.code}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {parseFloat(asset.balance).toFixed(2)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Percentage Slider */}
          {maxAmount > 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Amount Percentage</Label>
                <span className="text-xs text-muted-foreground">
                  {payment.percentage.toFixed(1)}% of available
                </span>
              </div>
              <Slider
                value={[payment.percentage]}
                onValueChange={handleSliderChange}
                max={100}
                step={0.1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span>Available: {maxAmount.toFixed(2)} {payment.asset}</span>
                <span>100%</span>
              </div>
            </div>
          )}

          {/* Memo */}
          <div className="space-y-2">
            <Label htmlFor={`memo-${payment.id}`}>Memo (Optional)</Label>
            <Input
              id={`memo-${payment.id}`}
              placeholder="Payment description"
              value={payment.memo}
              onChange={(e) => onUpdate({ memo: e.target.value })}
            />
          </div>

          {/* Destination Info */}
          {payment.destination && (
            <DestinationAccountInfo destination={payment.destination} />
          )}
        </div>
      </CardContent>
    </Card>
  );
};