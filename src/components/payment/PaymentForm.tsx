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
}

interface Asset {
  code: string;
  issuer: string;
  name: string;
  balance: string;
  price: number;
}

interface BatchPayment {
  id: string;
  destination: string;
  amount: string;
  asset: string;
  assetIssuer: string;
  memo: string;
}

interface PaymentFormProps {
  paymentData: PaymentData;
  onPaymentDataChange: (data: PaymentData) => void;
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
  trustlineError: string;
  onBuild: (paymentData?: PaymentData, batchPayments?: BatchPayment[], isAccountMerge?: boolean, pathPayment?: any) => void;
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
  
  // Advanced features state
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [isPathPayment, setIsPathPayment] = useState(false);
  const [batchPayments, setBatchPayments] = useState<BatchPayment[]>([]);
  const [pathSettings, setPathSettings] = useState({
    receiveAsset: '',
    receiveAssetIssuer: '',
    slippageTolerance: 0.5
  });
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
      // Allow slider to go 5% beyond available balance for account merge
      return balance * 1.05;
    }
    return balance;
  };

  const canCloseAccount = () => {
    // Only allow account closure if account has only XLM (no other trustlines)
    return accountData.balances.filter(b => b.asset_type !== 'native').length === 0;
  };

  const checkAccountClosure = (amount: string, assetCode: string) => {
    if (assetCode !== 'XLM') return false;
    
    const numAmount = parseFloat(amount);
    const availableBalance = getAvailableBalance('XLM');
    
    return numAmount > availableBalance && canCloseAccount();
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

  const addBatchPayment = () => {
    const newPayment: BatchPayment = {
      id: Date.now().toString(),
      destination: '',
      amount: '',
      asset: paymentData.asset,
      assetIssuer: paymentData.assetIssuer,
      memo: ''
    };
    setBatchPayments([...batchPayments, newPayment]);
  };

  const removeBatchPayment = (id: string) => {
    setBatchPayments(batchPayments.filter(p => p.id !== id));
  };

  const updateBatchPayment = (id: string, updates: Partial<BatchPayment>) => {
    setBatchPayments(batchPayments.map(p => 
      p.id === id ? { ...p, ...updates } : p
    ));
  };

  // Handle smart balance distribution for batch payments
  const redistributeBatchAmounts = () => {
    const availableBalance = getAvailableBalance(paymentData.asset);
    const totalPayments = batchPayments.length + 1; // +1 for main payment
    
    if (totalPayments > 1) {
      const amountPerPayment = (availableBalance / totalPayments).toFixed(7);
      onPaymentDataChange({ ...paymentData, amount: amountPerPayment });
      setBatchPayments(batchPayments.map(p => ({ ...p, amount: amountPerPayment })));
    }
  };

  // Calculate total amount across all payments
  const getTotalBatchAmount = () => {
    const mainAmount = parseFloat(paymentData.amount) || 0;
    const batchTotal = batchPayments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    return mainAmount + batchTotal;
  };

  // Update amounts when they exceed available balance
  const handleAmountChange = (newAmount: string, paymentId?: string) => {
    if (paymentId) {
      // Update batch payment
      updateBatchPayment(paymentId, { amount: newAmount });
    } else {
      // Update main payment
      onPaymentDataChange({ ...paymentData, amount: newAmount });
      setWillCloseAccount(checkAccountClosure(newAmount, paymentData.asset));
    }

    // Check if total exceeds available balance in batch mode
    if (isBatchMode) {
      setTimeout(() => {
        const total = getTotalBatchAmount();
        const available = getAvailableBalance(paymentData.asset);
        
        if (total > available) {
          // Proportionally reduce all amounts
          const ratio = available / total;
          const newMainAmount = ((parseFloat(paymentData.amount) || 0) * ratio).toFixed(7);
          onPaymentDataChange({ ...paymentData, amount: newMainAmount });
          
          setBatchPayments(prev => prev.map(p => ({
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
    
    if (isBatchMode) {
      const totalAmount = getTotalBatchAmount();
      const available = getAvailableBalance(paymentData.asset);
      return paymentData.destination && paymentData.amount && 
             batchPayments.every(p => p.destination && p.amount) &&
             batchPayments.length > 0 &&
             totalAmount <= available;
    }
    
    if (isPathPayment) {
      return paymentData.destination && paymentData.amount && 
             pathSettings.receiveAsset && paymentData.asset !== pathSettings.receiveAsset;
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
    } else if (isBatchMode) {
      const allPayments = [
        { 
          id: 'main', 
          destination: paymentData.destination, 
          amount: paymentData.amount, 
          asset: paymentData.asset, 
          assetIssuer: paymentData.assetIssuer, 
          memo: paymentData.memo 
        },
        ...batchPayments
      ];
      onBuild(undefined, allPayments);
    } else if (isPathPayment) {
      onBuild(undefined, undefined, false, {
        ...paymentData,
        receiveAsset: pathSettings.receiveAsset,
        receiveAssetIssuer: pathSettings.receiveAssetIssuer,
        slippageTolerance: pathSettings.slippageTolerance
      });
    } else {
      onBuild(paymentData);
    }
  };

  return (
    <div className="space-y-6">
      {/* Payment Mode Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payment Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="batch-mode"
                checked={isBatchMode}
                onCheckedChange={(checked) => {
                  setIsBatchMode(checked);
                  if (checked) {
                    setIsPathPayment(false);
                  }
                }}
              />
              <Label htmlFor="batch-mode" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Batch Payments
              </Label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Switch
                id="path-payment"
                checked={isPathPayment}
                onCheckedChange={(checked) => {
                  setIsPathPayment(checked);
                  if (checked) {
                    setIsBatchMode(false);
                  }
                }}
              />
              <Label htmlFor="path-payment" className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Cross-Asset Payment
              </Label>
            </div>
          </div>

          {/* Feature Descriptions */}
          {(isBatchMode || isPathPayment) && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                {isBatchMode && "Send to multiple recipients in a single atomic transaction."}
                {isPathPayment && "Send one asset and recipient receives a different asset through automatic conversion."}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

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
        {(
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-4 items-end">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="amount">
                  {isPathPayment ? 'Send Amount' : 'Amount'}
                </Label>
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
                  className="font-amount flex-1 text-xs sm:text-sm"
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
                  <SelectTrigger className="w-20 sm:w-24">
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
          </div>
        )}

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
                onChange={(e) => handleAmountChange(e.target.value)}
                className={`stellar-slider w-full ${willCloseAccount ? 'slider-warning' : ''}`}
                style={{
                  '--slider-progress': `${((parseFloat(paymentData.amount) || 0) / getMaxSliderValue(paymentData.asset)) * 100}%`
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
            
            {isBatchMode && (
              <div className="space-y-2">
                {getTotalBatchAmount() > getAvailableBalance(paymentData.asset) && (
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
                  onClick={redistributeBatchAmounts}
                  className="w-full text-xs"
                >
                  Distribute Evenly Across All Payments
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Path Payment Settings */}
        {isPathPayment && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                Recipient Receives
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Receive Asset</Label>
                  <Select
                    value={pathSettings.receiveAsset}
                    onValueChange={(value) => {
                      const selectedAsset = availableAssets.find(asset => asset.code === value);
                      setPathSettings({
                        ...pathSettings,
                        receiveAsset: value,
                        receiveAssetIssuer: selectedAsset?.issuer || ''
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select asset..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAssets.filter(asset => asset.code !== paymentData.asset).map((asset) => (
                        <SelectPrimitive.Item key={asset.code} value={asset.code}>
                          {asset.code}
                        </SelectPrimitive.Item>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Slippage Tolerance</Label>
                  <div className="space-y-2">
                    <Slider
                      value={[pathSettings.slippageTolerance]}
                      onValueChange={(value) => setPathSettings({ ...pathSettings, slippageTolerance: value[0] })}
                      min={0.1}
                      max={5.0}
                      step={0.1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs">
                      <span>0.1%</span>
                      <Badge variant="outline">{pathSettings.slippageTolerance.toFixed(1)}%</Badge>
                      <span>5.0%</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Batch Payments */}
        {isBatchMode && (
          <div className="space-y-4">
            {batchPayments.map((payment, index) => (
              <div key={payment.id} className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Payment #{index + 2}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeBatchPayment(payment.id)}
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
                    onChange={(e) => updateBatchPayment(payment.id, { destination: e.target.value })}
                    className="text-xs sm:text-sm font-address"
                  />
                </div>
                
                {/* Amount with Slider */}
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
                  
                  {/* Individual slider for batch payment */}
                  <div className="relative">
                    <input
                      type="range"
                      min="0"
                      max={getAvailableBalance(paymentData.asset)}
                      step="1"
                      value={payment.amount || '0'}
                      onChange={(e) => handleAmountChange(e.target.value, payment.id)}
                      className="stellar-slider w-full"
                      style={{
                        '--slider-progress': `${((parseFloat(payment.amount) || 0) / getAvailableBalance(paymentData.asset)) * 100}%`
                      } as React.CSSProperties}
                    />
                  </div>
                </div>
                
                {/* Memo for batch payment */}
                <div className="space-y-2">
                  <Label>Memo (Optional)</Label>
                  <Input
                    placeholder="Payment description"
                    className="font-mono text-xs"
                    value={payment.memo}
                    onChange={(e) => updateBatchPayment(payment.id, { memo: e.target.value })}
                  />
                </div>
              </div>
            ))}
            
            <Button
              onClick={addBatchPayment}
              variant="outline"
              className="w-full border-dashed"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Another Payment
            </Button>
          </div>
        )}

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
          className={`w-full ${willCloseAccount ? 'bg-destructive hover:bg-destructive/90' : 'bg-gradient-primary hover:opacity-90'} disabled:opacity-50`}
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
              {isBatchMode && `Build Batch Transaction (${batchPayments.length + 1} payments)`}
              {isPathPayment && 'Build Cross-Asset Payment'}
              {!willCloseAccount && !isBatchMode && !isPathPayment && (
                trustlineError?.includes('will create a new') ? 'Create New Account' : 'Build Payment Transaction'
              )}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};