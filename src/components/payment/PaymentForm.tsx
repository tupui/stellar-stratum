import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Slider } from '@/components/ui/slider';
import { AlertTriangle, Check, Info, Plus, Trash2, ArrowRight, TrendingUp, Merge, Users } from 'lucide-react';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { DestinationAccountInfo } from './DestinationAccountInfo';

interface PaymentData {
  destination: string;
  amount: string;
  asset: string;
  assetIssuer: string;
  memo: string;
  receiveAsset?: string;
  receiveAssetIssuer?: string;
  slippageTolerance?: number;
}

interface Asset {
  code: string;
  issuer: string;
  name: string;
  balance: string;
  price: number;
}

interface PaymentItem {
  id: string;
  destination: string;
  amount: string;
  asset: string;
  assetIssuer: string;
  memo: string;
  receiveAsset?: string;
  receiveAssetIssuer?: string;
  slippageTolerance?: number;
}

interface PaymentFormProps {
  paymentData: PaymentData;
  onPaymentDataChange: (data: PaymentData) => void;
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
  trustlineError: string;
  onBuild: (paymentData?: PaymentData, payments?: PaymentItem[], isAccountMerge?: boolean, pathPayment?: any) => void;
  isBuilding: boolean;
  accountData: {
    balances: Array<{
      asset_type: string;
      asset_code?: string;
      asset_issuer?: string;
      balance: string;
    }>;
    signers: Array<{
      key: string;
      weight: number;
      type: string;
    }>;
    thresholds: {
      low_threshold: number;
      med_threshold: number;
      high_threshold: number;
    };
  };
  accountPublicKey: string;
}

export const PaymentForm = ({ 
  paymentData, 
  onPaymentDataChange,
  availableAssets,
  assetPrices,
  trustlineError,
  onBuild,
  isBuilding,
  accountData,
  accountPublicKey
}: PaymentFormProps) => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const [fiatValue, setFiatValue] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('0.0');
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  
  // Payment items state (includes main payment + additional payments)
  const [additionalPayments, setAdditionalPayments] = useState<PaymentItem[]>([]);
  const [willCloseAccount, setWillCloseAccount] = useState(false);

  // Calculate Stellar reserves for XLM
  const calculateXLMReserve = () => {
    const baseReserve = 0.5;
    const accountEntries = 1; // Base account
    const signersCount = accountData.signers.length - 1; // Subtract master key
    const trustlinesCount = accountData.balances.filter(b => b.asset_type !== 'native').length;
    
    return (accountEntries + signersCount + trustlinesCount + 1) * baseReserve; // +1 for safety
  };

  const getAvailableBalance = (assetCode: string) => {
    const asset = availableAssets.find(a => a.code === assetCode);
    if (!asset) return 0;
    
    const balance = parseFloat(asset.balance);
    if (assetCode === 'XLM') {
      const reserve = calculateXLMReserve();
      return Math.max(0, balance - reserve - 0.1); // Extra 0.1 for transaction fees
    }
    return balance;
  };

  const getMaxSliderValue = (assetCode: string) => {
    const asset = availableAssets.find(a => a.code === assetCode);
    if (!asset) return 0;
    
    const balance = parseFloat(asset.balance);
    if (assetCode === 'XLM') {
      // For XLM, allow slider to go to full balance (account merge scenario)
      return balance;
    }
    return balance;
  };

  const canCloseAccount = () => {
    // Only allow account closure if account has only XLM (no other trustlines)
    return accountData.balances.filter(b => b.asset_type !== 'native').length === 0;
  };

  const checkAccountClosure = (amount: string, assetCode: string) => {
    if (assetCode !== 'XLM' || !canCloseAccount()) return false;
    
    const numAmount = parseFloat(amount);
    const availableBalance = getAvailableBalance('XLM');
    
    return numAmount > availableBalance;
  };

  // Jump behavior: when going beyond available balance for XLM, jump to full balance
  const handleSliderChange = (value: string, paymentId?: string) => {
    const numValue = parseFloat(value);
    const asset = paymentId ? 
      additionalPayments.find(p => p.id === paymentId)?.asset || paymentData.asset :
      paymentData.asset;
    
    if (asset === 'XLM' && canCloseAccount()) {
      const availableBalance = getAvailableBalance('XLM');
      const fullBalance = getMaxSliderValue('XLM');
      
      // If we go beyond available balance, jump to full balance
      if (numValue > availableBalance) {
        handleAmountChange(fullBalance.toString(), paymentId);
        return;
      }
    }
    
    handleAmountChange(value, paymentId);
  };

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

  // Sync the display value when not actively editing
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
      const maxAmount = getAvailableBalance(selectedAsset.code).toString();
      onPaymentDataChange({ ...paymentData, amount: maxAmount });
    }
  };

  const addPayment = () => {
    const newPayment: PaymentItem = {
      id: Date.now().toString(),
      destination: '',
      amount: '',
      asset: paymentData.asset,
      assetIssuer: paymentData.assetIssuer,
      memo: '',
      receiveAsset: '',
      receiveAssetIssuer: '',
      slippageTolerance: 0.5
    };
    setAdditionalPayments([...additionalPayments, newPayment]);
  };

  const removePayment = (id: string) => {
    setAdditionalPayments(additionalPayments.filter(p => p.id !== id));
  };

  const updatePayment = (id: string, updates: Partial<PaymentItem>) => {
    setAdditionalPayments(additionalPayments.map(p => 
      p.id === id ? { ...p, ...updates } : p
    ));
  };

  // Calculate total amount for balance checking
  const getTotalAmount = () => {
    const mainAmount = parseFloat(paymentData.amount) || 0;
    const additionalTotal = additionalPayments.reduce((sum, payment) => {
      return sum + (parseFloat(payment.amount) || 0);
    }, 0);
    return mainAmount + additionalTotal;
  };

  // Smart balance distribution
  const distributeFundsEvenly = () => {
    const availableBalance = getAvailableBalance(paymentData.asset);
    const totalPayments = additionalPayments.length + 1; // +1 for main payment
    
    if (totalPayments > 1) {
      const amountPerPayment = (availableBalance / totalPayments).toFixed(7);
      onPaymentDataChange({ ...paymentData, amount: amountPerPayment });
      setAdditionalPayments(additionalPayments.map(p => ({ ...p, amount: amountPerPayment })));
    }
  };

  // Handle amount changes with smart balance checking
  const handleAmountChange = (newAmount: string, paymentId?: string) => {
    if (paymentId) {
      updatePayment(paymentId, { amount: newAmount });
    } else {
      onPaymentDataChange({ ...paymentData, amount: newAmount });
      setWillCloseAccount(checkAccountClosure(newAmount, paymentData.asset));
    }

    // Smart balance redistribution when total exceeds available
    if (additionalPayments.length > 0) {
      setTimeout(() => {
        const total = getTotalAmount();
        const available = getAvailableBalance(paymentData.asset);
        
        if (total > available) {
          // Proportionally reduce all amounts
          const ratio = available / total;
          const newMainAmount = ((parseFloat(paymentData.amount) || 0) * ratio).toFixed(7);
          onPaymentDataChange({ ...paymentData, amount: newMainAmount });
          
          setAdditionalPayments(prev => prev.map(p => ({
            ...p,
            amount: ((parseFloat(p.amount) || 0) * ratio).toFixed(7)
          })));
        }
      }, 100);
    }
  };

  // Check if form is valid
  const isFormValid = () => {
    if (willCloseAccount) {
      return paymentData.destination && paymentData.destination !== accountPublicKey && canCloseAccount();
    }
    
    const hasAdditionalPayments = additionalPayments.length > 0;
    if (hasAdditionalPayments) {
      const totalAmount = getTotalAmount();
      const available = getAvailableBalance(paymentData.asset);
      return paymentData.destination && paymentData.amount && 
             additionalPayments.every(p => p.destination && p.amount) &&
             totalAmount <= available;
    }
    
    return paymentData.destination && 
           paymentData.amount && 
           paymentData.asset &&
           (paymentData.asset === 'XLM' || paymentData.assetIssuer) &&
           (!trustlineError || trustlineError.includes('will create a new'));
  };

  const handleBuild = () => {
    if (willCloseAccount) {
      onBuild(undefined, undefined, true);
    } else if (additionalPayments.length > 0) {
      const allPayments = [
        { 
          id: 'main', 
          destination: paymentData.destination, 
          amount: paymentData.amount, 
          asset: paymentData.asset, 
          assetIssuer: paymentData.assetIssuer, 
          memo: paymentData.memo,
          receiveAsset: paymentData.receiveAsset,
          receiveAssetIssuer: paymentData.receiveAssetIssuer,
          slippageTolerance: paymentData.slippageTolerance
        },
        ...additionalPayments
      ];
      onBuild(undefined, allPayments);
    } else if (paymentData.receiveAsset && paymentData.receiveAsset !== paymentData.asset) {
      // Single cross-asset payment
      onBuild(undefined, undefined, false, paymentData);
    } else {
      onBuild(paymentData);
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Payment Form */}
      <div className="space-y-4">
        {/* Destination */}
        <div className="space-y-2">
          <Label htmlFor="destination">
            {willCloseAccount ? 'Send All Funds To' : 'Destination Address'}
          </Label>
          <Input
            id="destination"
            placeholder="GABC..."
            maxLength={56}
            value={paymentData.destination}
            onChange={(e) => onPaymentDataChange({ ...paymentData, destination: e.target.value })}
            className="text-xs sm:text-sm font-address"
          />
        </div>

        {/* Amount and Asset */}
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4 items-end">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Send Amount</Label>
              {fiatValue && (
                <span className="text-xs text-muted-foreground">≈ {fiatValue}</span>
              )}
            </div>
            <Input
              id="amount"
              type="text"
              placeholder="0.0"
              inputMode="decimal"
              className="font-amount text-xs sm:text-sm"
              value={amountInput}
              onFocus={() => setIsEditingAmount(true)}
              onBlur={() => {
                const numeric = parseFloat(amountInput.replace(/,/g, ''));
                const rounded = isNaN(numeric) ? 0 : Number(numeric.toFixed(7));
                handleAmountChange(rounded ? rounded.toString() : '');
                setAmountInput(formatDisplayAmount(rounded.toString()));
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
                } else {
                  handleAmountChange('');
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Asset</Label>
            <Select
              value={paymentData.asset}
              onValueChange={(value) => {
                const selectedAsset = availableAssets.find(asset => asset.code === value);
                onPaymentDataChange({ 
                  ...paymentData, 
                  asset: value,
                  assetIssuer: selectedAsset?.issuer || '',
                  amount: ''
                });
              }}
            >
              <SelectTrigger>
                <SelectValue>
                  <span className="font-medium text-xs sm:text-sm">{paymentData.asset}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-[300px] max-h-64 overflow-y-auto z-50 bg-popover border border-border shadow-lg">
                <div className="sticky top-0 z-[100] grid grid-cols-[80px_1fr] items-center gap-3 pl-8 pr-2 py-3 text-[11px] text-muted-foreground bg-card/95 backdrop-blur-sm border-b border-border shadow-md">
                  <span className="uppercase tracking-wider font-medium">Asset</span>
                  <span className="text-right uppercase tracking-wider font-medium">Balance</span>
                </div>
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
                          <span className="font-amount tabular-nums text-right text-xs text-muted-foreground">{formattedBalance}</span>
                        </div>
                      </SelectPrimitive.ItemText>
                    </SelectPrimitive.Item>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Cross-Asset Payment Option */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Recipient Receives (Optional)</Label>
            <Select
              value={paymentData.receiveAsset || ''}
              onValueChange={(value) => {
                const selectedAsset = availableAssets.find(asset => asset.code === value);
                onPaymentDataChange({
                  ...paymentData,
                  receiveAsset: value === paymentData.asset ? '' : value,
                  receiveAssetIssuer: selectedAsset?.issuer || ''
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Same as send asset">
                  {paymentData.receiveAsset && (
                    <span className="font-medium text-xs sm:text-sm">{paymentData.receiveAsset}</span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectPrimitive.Item value={paymentData.asset}>
                  Same as send asset
                </SelectPrimitive.Item>
                {availableAssets.filter(asset => asset.code !== paymentData.asset).map((asset) => (
                  <SelectPrimitive.Item key={asset.code} value={asset.code}>
                    {asset.code}
                  </SelectPrimitive.Item>
                ))}
              </SelectContent>
            </Select>
          </div>

          {paymentData.receiveAsset && paymentData.receiveAsset !== paymentData.asset && (
            <div className="space-y-2">
              <Label>Slippage Tolerance</Label>
              <div className="space-y-2">
                <Slider
                  value={[paymentData.slippageTolerance || 0.5]}
                  onValueChange={(value) => onPaymentDataChange({ 
                    ...paymentData, 
                    slippageTolerance: value[0] 
                  })}
                  min={0.1}
                  max={5.0}
                  step={0.1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs">
                  <span>0.1%</span>
                  <Badge variant="outline">{(paymentData.slippageTolerance || 0.5).toFixed(1)}%</Badge>
                  <span>5.0%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Slider for amount selection */}
        {getSelectedAssetInfo() && (
          <div className="space-y-3">
            <div className="relative">
              <input
                type="range"
                min="0"
                max={getMaxSliderValue(paymentData.asset)}
                step="1"
                value={paymentData.amount || '0'}
                onChange={(e) => handleSliderChange(e.target.value)}
                className={`stellar-slider w-full ${
                  willCloseAccount ? 'slider-merge-warning' : 
                  (parseFloat(paymentData.amount) || 0) > getAvailableBalance(paymentData.asset) ? 'slider-warning' : ''
                }`}
                style={{
                  '--slider-progress': `${((parseFloat(paymentData.amount) || 0) / getMaxSliderValue(paymentData.asset)) * 100}%`,
                  '--available-progress': `${(getAvailableBalance(paymentData.asset) / getMaxSliderValue(paymentData.asset)) * 100}%`
                } as React.CSSProperties}
              />
            </div>
            
            {/* Account closure warning */}
            {willCloseAccount && (
              <Alert className="border-destructive/50 bg-destructive/10">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <AlertDescription className="text-destructive">
                  <strong>Warning:</strong> This amount will close your account permanently! All remaining XLM will be sent to the destination.
                </AlertDescription>
              </Alert>
            )}
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Available: {getAvailableBalance(paymentData.asset).toLocaleString('en-US', {
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
            
            {additionalPayments.length > 0 && (
              <div className="space-y-2">
                {getTotalAmount() > getAvailableBalance(paymentData.asset) && (
                  <Alert className="border-destructive/50 bg-destructive/10">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <AlertDescription className="text-destructive text-xs">
                      Total amount exceeds available balance. Amounts will be automatically adjusted.
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={distributeFundsEvenly}
                  className="w-full text-xs"
                >
                  Distribute Evenly Across All Payments
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Additional Payments */}
        {additionalPayments.map((payment, index) => (
          <div key={payment.id} className="space-y-4 p-4 border rounded-lg bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Payment #{index + 2}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removePayment(payment.id)}
                className="text-destructive hover:text-destructive/80"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            
            {/* Destination */}
            <div className="space-y-2">
              <Label>Destination Address</Label>
              <Input
                placeholder="GABC..."
                maxLength={56}
                value={payment.destination}
                onChange={(e) => updatePayment(payment.id, { destination: e.target.value })}
                className="text-xs sm:text-sm font-address"
              />
            </div>
            
            {/* Amount */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Amount</Label>
                <span className="text-xs text-muted-foreground">
                  {payment.asset} {parseFloat(payment.amount || '0').toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 7
                  })}
                </span>
              </div>
              <Input
                placeholder="0.0"
                value={payment.amount}
                onChange={(e) => handleAmountChange(e.target.value, payment.id)}
                className="font-amount"
              />
              
              {/* Individual slider for additional payment */}
              <div className="relative">
                <input
                  type="range"
                  min="0"
                  max={getAvailableBalance(paymentData.asset)}
                  step="1"
                  value={payment.amount || '0'}
                  onChange={(e) => handleSliderChange(e.target.value, payment.id)}
                  className="stellar-slider w-full"
                  style={{
                    '--slider-progress': `${((parseFloat(payment.amount) || 0) / getAvailableBalance(paymentData.asset)) * 100}%`
                  } as React.CSSProperties}
                />
              </div>
            </div>

            {/* Cross-Asset Payment for Additional Payment */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Recipient Receives</Label>
                <Select
                  value={payment.receiveAsset || ''}
                  onValueChange={(value) => {
                    const selectedAsset = availableAssets.find(asset => asset.code === value);
                    updatePayment(payment.id, {
                      receiveAsset: value === payment.asset ? '' : value,
                      receiveAssetIssuer: selectedAsset?.issuer || ''
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Same as send asset">
                      {payment.receiveAsset && (
                        <span className="font-medium text-xs sm:text-sm">{payment.receiveAsset}</span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectPrimitive.Item value={payment.asset}>
                      Same as send asset
                    </SelectPrimitive.Item>
                    {availableAssets.filter(asset => asset.code !== payment.asset).map((asset) => (
                      <SelectPrimitive.Item key={asset.code} value={asset.code}>
                        {asset.code}
                      </SelectPrimitive.Item>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {payment.receiveAsset && payment.receiveAsset !== payment.asset && (
                <div className="space-y-2">
                  <Label>Slippage Tolerance</Label>
                  <div className="space-y-2">
                    <Slider
                      value={[payment.slippageTolerance || 0.5]}
                      onValueChange={(value) => updatePayment(payment.id, { slippageTolerance: value[0] })}
                      min={0.1}
                      max={5.0}
                      step={0.1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs">
                      <span>0.1%</span>
                      <Badge variant="outline">{(payment.slippageTolerance || 0.5).toFixed(1)}%</Badge>
                      <span>5.0%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Memo for additional payment */}
            <div className="space-y-2">
              <Label>Memo (Optional)</Label>
              <Input
                placeholder="Payment description"
                className="font-mono text-xs"
                value={payment.memo}
                onChange={(e) => updatePayment(payment.id, { memo: e.target.value })}
              />
            </div>
          </div>
        ))}
        
        {/* Add Payment Button */}
        <Button
          onClick={addPayment}
          variant="outline"
          className="w-full border-dashed"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Another Payment
        </Button>

        {/* Memo */}
        <div className="space-y-2">
          <Label htmlFor="memo">Memo (Optional)</Label>
          <Input
            id="memo"
            placeholder="Payment description"
            className="font-mono"
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
          onClick={handleBuild} 
          disabled={isBuilding || !isFormValid()}
          className={`w-full ${
            willCloseAccount ? 'bg-destructive hover:bg-destructive/90' : 'bg-gradient-primary hover:opacity-90'
          } disabled:opacity-50`}
          size="lg"
        >
          {isBuilding ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              Building Transaction...
            </div>
          ) : (
            <>
              {willCloseAccount && <AlertTriangle className="w-4 h-4 mr-2" />}
              {willCloseAccount && 'Send All Funds & Close Account'}
              {additionalPayments.length > 0 && !willCloseAccount && 
                `Build Batch Transaction (${additionalPayments.length + 1} payments)`}
              {additionalPayments.length === 0 && !willCloseAccount && 
                (paymentData.receiveAsset && paymentData.receiveAsset !== paymentData.asset ? 
                  'Build Cross-Asset Payment' : 
                  (trustlineError?.includes('will create a new') ? 'Create New Account' : 'Build Payment Transaction')
                )}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};