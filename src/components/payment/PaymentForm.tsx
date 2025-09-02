import { useState, useEffect, useRef } from 'react';
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
import { AlertTriangle, Check, Info, Plus, Trash2, ArrowRight, TrendingUp, Merge, Users, Edit2, X } from 'lucide-react';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { DestinationAccountInfo } from './DestinationAccountInfo';
import { useNetwork } from '@/contexts/NetworkContext';
import * as StellarSDK from '@stellar/stellar-sdk';

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

interface CompactPayment {
  id: string;
  destination: string;
  amount: string;
  asset: string;
  assetIssuer: string;
  receiveAsset?: string;
  receiveAssetIssuer?: string;
  memo: string;
  slippageTolerance?: number;
  fiatValue?: string;
}

interface PaymentFormProps {
  paymentData: PaymentData;
  onPaymentDataChange: (data: PaymentData) => void;
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
  trustlineError: string;
  onBuild: (paymentData?: PaymentData, isAccountMerge?: boolean, payments?: CompactPayment[], pathPayment?: any) => void;
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
  const { network } = useNetwork();
  
  // State for compact payments (previous payments)
  const [compactPayments, setCompactPayments] = useState<CompactPayment[]>([]);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  
  // State for current payment
  const [fiatValue, setFiatValue] = useState<string>('');
  type RecipientAsset = { code: string; issuer?: string; balance: string };
  const [recipientAssetOptions, setRecipientAssetOptions] = useState<RecipientAsset[]>([]);
  const [recipientExists, setRecipientExists] = useState<boolean | null>(null);
  const [willCloseAccount, setWillCloseAccount] = useState(false);
  const [showAutoAdjustWarning, setShowAutoAdjustWarning] = useState(false);
  const [showBundleActions, setShowBundleActions] = useState(false);
  const isDraggingRef = useRef(false);
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

  // Destination trustline helpers
  const isValidPublicKey = (s?: string) => !!s && s.length === 56 && s.startsWith('G');

  const fetchRecipientAssets = async (
    accountId: string
  ): Promise<{ exists: boolean; assets: RecipientAsset[] }> => {
    const server = new StellarSDK.Horizon.Server(
      network === 'testnet' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org'
    );
    try {
      const account = await server.loadAccount(accountId);
      const assets: RecipientAsset[] = [];
      account.balances.forEach((b: any) => {
        if (b.asset_type === 'native') {
          assets.push({ code: 'XLM', balance: b.balance });
        } else if (b.asset_code) {
          assets.push({ code: b.asset_code, issuer: b.asset_issuer, balance: b.balance });
        }
      });
      // Ensure XLM appears even if missing (shouldn't happen for existing accounts)
      if (!assets.some(a => a.code === 'XLM')) assets.unshift({ code: 'XLM', balance: '0' });
      return { exists: true, assets };
    } catch {
      // New account: only XLM allowed
      return { exists: false, assets: [{ code: 'XLM', balance: '0' }] };
    }
  };

  // Fetch recipient assets when destination changes
  useEffect(() => {
    if (!isValidPublicKey(paymentData.destination)) {
      setRecipientAssetOptions([]);
      setRecipientExists(null);
      return;
    }
    let cancelled = false;
    fetchRecipientAssets(paymentData.destination).then(({ exists, assets }) => {
      if (!cancelled) {
        setRecipientExists(exists);
        setRecipientAssetOptions(assets);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [paymentData.destination, network]);

  // Auto-select valid receive asset if "same" isn't accepted by destination
  useEffect(() => {
    if (!recipientAssetOptions.length) return;
    const recipientHasSame = paymentData.asset === 'XLM' || recipientAssetOptions.some(a => a.code === paymentData.asset);
    if (!recipientHasSame && (!paymentData.receiveAsset || !recipientAssetOptions.some(a => a.code === paymentData.receiveAsset!))) {
      const fallback = recipientAssetOptions.find(a => a.code === 'XLM')?.code || recipientAssetOptions[0].code;
      const selected = recipientAssetOptions.find(a => a.code === fallback);
      onPaymentDataChange({
        ...paymentData,
        receiveAsset: fallback,
        receiveAssetIssuer: selected?.issuer
      });
    }
  }, [recipientAssetOptions, paymentData.asset]);

  // Helper to calculate fiat value
  const calculateFiatValue = async (amount: string, asset: string) => {
    const price = assetPrices[asset] || 0;
    if (price > 0) {
      const usdValue = parseFloat(amount) * price;
      if (quoteCurrency === 'USD') {
        return `$${usdValue.toFixed(2)} USD`;
      } else {
        try {
          const convertedValue = await convertFromUSD(usdValue, quoteCurrency);
          const currency = getCurrentCurrency();
          const code = currency?.code || quoteCurrency;
          return `${currency?.symbol || ''}${convertedValue.toFixed(2)} ${code}`;
        } catch (error) {
          return `$${usdValue.toFixed(2)} USD`;
        }
      }
    }
    return 'N/A';
  };

  // Update fiat value when amount, asset, or currency changes
  useEffect(() => {
    if (!paymentData.amount || !paymentData.asset) {
      setFiatValue('');
      return;
    }

    const updateFiatValue = async () => {
      const fiat = await calculateFiatValue(paymentData.amount, paymentData.asset);
      setFiatValue(fiat);
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

  const handleAmountChange = (newAmount: string) => {
    // Enforce 7 decimal places max and clamp to [0, max]
    const max = getMaxSliderValue(paymentData.asset);
    let num = parseFloat(newAmount);
    if (isNaN(num)) num = 0;
    const clamped = Math.min(Math.max(0, num), max);
    const fixed = clamped.toFixed(7); // Stellar supports up to 7 decimals

    onPaymentDataChange({ ...paymentData, amount: fixed });
    setWillCloseAccount(checkAccountClosure(fixed, paymentData.asset));

    // Skip auto-adjust while user is dragging for smooth slider UX
    if (isDraggingRef.current) return;

    // Check if total across all payments exceeds available balance
    setTimeout(async () => {
      const currentAmount = parseFloat(fixed) || 0;
      const compactTotal = compactPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
      const total = currentAmount + compactTotal;
      const available = getAvailableBalance(paymentData.asset);
      
      if (total > available && compactPayments.length > 0) {
        setShowAutoAdjustWarning(true);
        // Proportionally reduce all amounts
        const ratio = available / total;
        const newCurrentAmount = (currentAmount * ratio).toFixed(7);
        onPaymentDataChange({ ...paymentData, amount: newCurrentAmount });
        
        // Update compact payments with new amounts and recalculated fiat values
        const updatedCompactPayments = await Promise.all(
          compactPayments.map(async (p) => {
            const newAmt = ((parseFloat(p.amount) || 0) * ratio).toFixed(7);
            const newFiatValue = await calculateFiatValue(newAmt, p.asset);
            return {
              ...p,
              amount: newAmt,
              fiatValue: newFiatValue
            };
          })
        );
        
        setCompactPayments(updatedCompactPayments);
        setTimeout(() => setShowAutoAdjustWarning(false), 4000);
      } else {
        setShowAutoAdjustWarning(false);
      }
    }, 100);
  };

  const handleMergeAccount = () => {
    if (!canCloseAccount()) return;
    
    const fullBalance = getMaxSliderValue('XLM');
    handleAmountChange(fullBalance.toString());
    setWillCloseAccount(true);
  };

  const handleRevertMerge = () => {
    setWillCloseAccount(false);
    const availableBalance = getAvailableBalance('XLM');
    handleAmountChange(availableBalance.toString());
  };

  const getReceiveOptions = () => {
    // If account doesn't exist, only XLM allowed
    if (recipientExists === false) return [{ code: 'XLM', issuer: undefined, balance: '0' }];
    // Otherwise, use recipient's actual balances
    const unique = new Map<string, RecipientAsset>();
    recipientAssetOptions.forEach(a => unique.set(a.code, a));
    // Always ensure XLM is present
    if (!unique.has('XLM')) unique.set('XLM', { code: 'XLM', balance: '0' });
    return Array.from(unique.values());
  };

  const recipientHas = (code: string) => recipientAssetOptions.some(a => a.code === code);
  const recipientBalance = (code: string) => recipientAssetOptions.find(a => a.code === code)?.balance;

  const handleBundlePayment = async () => {
    await addPayment();
    setShowBundleActions(true);
  };

  const addPayment = async () => {
    // Calculate fiat value for the current payment
    let currentFiatValue = '';
    if (paymentData.amount && paymentData.asset) {
      const price = assetPrices[paymentData.asset] || 0;
      if (price > 0) {
        const usdValue = parseFloat(paymentData.amount) * price;
        if (quoteCurrency === 'USD') {
          currentFiatValue = `$${usdValue.toFixed(2)}`;
        } else {
          try {
            const convertedValue = await convertFromUSD(usdValue, quoteCurrency);
            const currency = getCurrentCurrency();
            currentFiatValue = `${currency?.symbol || ''}${convertedValue.toFixed(2)}`;
          } catch (error) {
            currentFiatValue = `$${usdValue.toFixed(2)}`;
          }
        }
      }
    }

    // Move current payment to compact payments
    const compactPayment: CompactPayment = {
      id: Date.now().toString(),
      destination: paymentData.destination,
      amount: paymentData.amount,
      asset: paymentData.asset,
      assetIssuer: paymentData.assetIssuer,
      receiveAsset: paymentData.receiveAsset,
      receiveAssetIssuer: paymentData.receiveAssetIssuer,
      memo: paymentData.memo,
      slippageTolerance: paymentData.slippageTolerance,
      fiatValue: currentFiatValue
    };

    setCompactPayments([...compactPayments, compactPayment]);

    // Reset current payment form
    onPaymentDataChange({
      destination: '',
      amount: '',
      asset: paymentData.asset, // Keep same asset
      assetIssuer: paymentData.assetIssuer,
      memo: '',
      receiveAsset: undefined,
      receiveAssetIssuer: undefined,
      slippageTolerance: 0.5
    });
    setWillCloseAccount(false);
  };

  const editCompactPayment = (payment: CompactPayment) => {
    // Move compact payment back to main form
    onPaymentDataChange({
      destination: payment.destination,
      amount: payment.amount,
      asset: payment.asset,
      assetIssuer: payment.assetIssuer,
      receiveAsset: payment.receiveAsset,
      receiveAssetIssuer: payment.receiveAssetIssuer,
      memo: payment.memo,
      slippageTolerance: payment.slippageTolerance
    });

    // Remove from compact payments
    setCompactPayments(compactPayments.filter(p => p.id !== payment.id));
    setEditingPaymentId(null);
  };

  const removeCompactPayment = (id: string) => {
    setCompactPayments(compactPayments.filter(p => p.id !== id));
  };

  const cancelCurrentPayment = () => {
    onPaymentDataChange({
      destination: '',
      amount: '',
      asset: paymentData.asset,
      assetIssuer: paymentData.assetIssuer,
      memo: '',
      receiveAsset: undefined,
      receiveAssetIssuer: undefined,
      slippageTolerance: 0.5,
    });
    setWillCloseAccount(false);
    setShowBundleActions(true);
  };

  const isFormValid = () => {
    if (willCloseAccount) {
      return paymentData.destination && paymentData.destination !== accountPublicKey && canCloseAccount();
    }
    
    return paymentData.destination && 
           paymentData.amount && 
           paymentData.asset &&
           (paymentData.asset === 'XLM' || paymentData.assetIssuer) &&
           (!trustlineError || trustlineError.includes('will create a new'));
  };

  const handleBuild = () => {
    if (willCloseAccount) {
      onBuild(paymentData, true);
    } else if (compactPayments.length > 0) {
      // Build batch transaction with compact payments + current payment
      const allPayments = [
        ...compactPayments,
        {
          id: 'current',
          destination: paymentData.destination,
          amount: paymentData.amount,
          asset: paymentData.asset,
          assetIssuer: paymentData.assetIssuer,
          receiveAsset: paymentData.receiveAsset,
          receiveAssetIssuer: paymentData.receiveAssetIssuer,
          memo: paymentData.memo,
          slippageTolerance: paymentData.slippageTolerance,
          fiatValue: fiatValue
        }
      ];
      onBuild(undefined, false, allPayments);
    } else if (paymentData.receiveAsset && paymentData.receiveAsset !== paymentData.asset) {
      // Single cross-asset payment
      onBuild(undefined, false, undefined, paymentData);
    } else {
      // Single regular payment
      onBuild(paymentData);
    }
  };

  // Custom amount slider with proper decimal constraints and design system colors
  const AmountSlider = () => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(paymentData.amount);
    const value = parseFloat(paymentData.amount) || 0;
    const maxAmount = getMaxSliderValue(paymentData.asset);
    const sliderMax = 1000; // integer steps for smooth drag
    const sliderValue = maxAmount > 0 ? Math.round((value / maxAmount) * sliderMax) : 0;
    const percentage = sliderMax > 0 ? (sliderValue / sliderMax) * 100 : 0;
    const availableBalance = getAvailableBalance(paymentData.asset);
    const isOverLimit = value > availableBalance;
    const availablePercentage = maxAmount > 0 ? Math.min(100, (availableBalance / maxAmount) * 100) : 0;
    
    const handleEditSubmit = () => {
      let numValue = parseFloat(editValue) || 0;
      // Apply decimal constraints based on asset
      if (paymentData.asset === 'XLM') {
        numValue = Math.round(numValue * 10000000) / 10000000; // 7 decimal places for XLM
      } else {
        numValue = Math.round(numValue * 10000000) / 10000000; // 7 decimals for issued assets too
      }
      handleAmountChange(numValue.toString());
      setIsEditing(false);
    };

    const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleEditSubmit();
      } else if (e.key === 'Escape') {
        setEditValue(paymentData.amount);
        setIsEditing(false);
      }
    };

    useEffect(() => {
      if (!isEditing) {
        setEditValue(paymentData.amount);
      }
    }, [paymentData.amount, isEditing]);

    useEffect(() => {
      const endDrag = () => { isDraggingRef.current = false; };
      window.addEventListener('mouseup', endDrag);
      window.addEventListener('touchend', endDrag);
      return () => {
        window.removeEventListener('mouseup', endDrag);
        window.removeEventListener('touchend', endDrag);
      };
    }, []);

    return (
      <div className="space-y-2">
        {/* Amount display above slider */}
        <div className="flex items-center justify-between">
          <div className="text-right">
            {isEditing ? (
              <Input
                type="text"
                inputMode="decimal"
                value={editValue}
                onChange={(e) => {
                  // Enhanced input validation with more permissive handling
                  let sanitized = e.target.value
                    .replace(/[^0-9.,]/g, '')  // Only allow numbers, dots, and commas
                    .replace(/,/g, '.');       // Convert commas to dots
                  
                  // Ensure only one decimal point
                  const parts = sanitized.split('.');
                  if (parts.length > 2) {
                    sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
                  }
                  
                  // Limit decimal places to 7
                  if (parts[1] && parts[1].length > 7) {
                    sanitized = `${parts[0]}.${parts[1].substring(0, 7)}`;
                  }
                  
                  setEditValue(sanitized);
                }}
                onBlur={handleEditSubmit}
                onKeyDown={handleEditKeyDown}
                onFocus={(e) => e.currentTarget.select()}
                className="h-7 w-32 text-sm font-mono text-right px-2 py-1 bg-background/95 border border-border/60 focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-border rounded-md"
                placeholder="0.0000000"
                autoFocus
              />
            ) : (
              <div 
                className="cursor-pointer hover:bg-background/20 rounded px-2 py-1 transition-colors group"
                onClick={() => setIsEditing(true)}
              >
                <div className="text-lg font-mono font-semibold text-foreground group-hover:text-primary transition-colors">
                  {formatDisplayAmount(value.toString())}
                </div>
              </div>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            / {formatDisplayAmount(maxAmount.toString())}
          </div>
        </div>

        {/* Fiat conversion with units */}
        {fiatValue && (
          <div className="text-center">
            <span className="text-sm text-primary font-medium">≈ {fiatValue}</span>
          </div>
        )}

        {/* Slider without currency label */}
        <div className="relative">
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={1}
            value={sliderValue}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10) || 0;
              const newAmount = maxAmount > 0 ? (v / sliderMax) * maxAmount : 0;
              isDraggingRef.current = true;
              handleAmountChange(newAmount.toFixed(7));
            }}
            onMouseDown={() => { isDraggingRef.current = true; }}
            onTouchStart={() => { isDraggingRef.current = true; }}
            className={`w-full stellar-slider ${
              isOverLimit && canCloseAccount() ? 'slider-merge-warning' : 
              isOverLimit ? 'slider-warning' : ''
            }`}
            style={{ 
              '--slider-progress': `${percentage}%`,
              '--available-progress': `${availablePercentage}%`
            } as React.CSSProperties}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {showAutoAdjustWarning && (
        <Alert variant="destructive" className="animate-fade-in">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Total amount exceeds available balance. Amounts have been automatically adjusted.
          </AlertDescription>
        </Alert>
      )}

      {/* Compact Previous Payments */}
      {compactPayments.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">Previous Payments</h3>
            <Badge variant="secondary" className="text-xs">
              {compactPayments.length} payment{compactPayments.length > 1 ? 's' : ''}
            </Badge>
          </div>
          
          {compactPayments.map((payment, index) => (
            <Card key={payment.id} className="p-4 bg-muted/30 border-border/60">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-medium">Payment #{index + 1}</span>
                    {payment.fiatValue && (
                      <span className="text-xs text-primary font-medium">≈ {payment.fiatValue}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground">To:</span>
                      <p className="font-mono truncate">{payment.destination}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Amount:</span>
                      <p className="font-semibold">{formatDisplayAmount(payment.amount)} {payment.asset}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Receive:</span>
                      <p className="font-semibold">{payment.receiveAsset || payment.asset}</p>
                    </div>
                  </div>
                  {payment.memo && (
                    <div className="mt-2 text-xs">
                      <span className="text-muted-foreground">Memo:</span>
                      <p className="font-mono">{payment.memo}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => editCompactPayment(payment)}
                    className="h-8 w-8 p-0 hover:bg-background/50"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCompactPayment(payment.id)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Current Payment Form */}
      <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">
              {compactPayments.length > 0 ? `Payment #${compactPayments.length + 1}` : 'Payment Details'}
            </h3>
          </div>

        {!showBundleActions && (<>
        {/* Destination */}
        <div className="space-y-2">
          <Label htmlFor="destination" className="text-sm font-medium">
            {willCloseAccount ? 'Send All Funds To' : 'Destination Address'}
          </Label>
          <Input
            id="destination"
            placeholder="GABC..."
            maxLength={56}
            value={paymentData.destination}
            onChange={(e) => onPaymentDataChange({ ...paymentData, destination: e.target.value })}
            className="text-xs font-address bg-background border-border/60 focus:border-primary"
          />
        </div>

        {/* Payment Details Row */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Amount & Assets</Label>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_140px] gap-4 items-center">
            {/* From Asset */}
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
                setWillCloseAccount(false);
              }}
            >
              <SelectTrigger className="h-12 border-border/60 focus:border-primary">
                <SelectValue>
                  <span className="font-semibold text-sm">{paymentData.asset}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-[300px] max-h-64 overflow-y-auto z-50 bg-popover border border-border shadow-lg">
                <div className="sticky top-0 z-[100] grid grid-cols-[80px_1fr] items-center gap-3 pl-8 pr-2 py-3 text-[11px] text-muted-foreground bg-card/95 backdrop-blur-sm border-b border-border shadow-md">
                  <span className="uppercase tracking-wider font-medium">Asset</span>
                  <span className="text-right uppercase tracking-wider font-medium">Balance</span>
                </div>
                {availableAssets.filter(asset => asset.code && asset.code.trim() !== '').map((asset) => {
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

            {/* Amount Slider with proper positioning */}
            <div className="relative">
              <AmountSlider />
              {/* Merge button positioned below, not overlapping */}
              {paymentData.asset === 'XLM' && canCloseAccount() && !willCloseAccount && (
                <div className="md:absolute md:-bottom-8 md:left-1/2 md:-translate-x-1/2 mt-2 md:mt-0 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleMergeAccount}
                    className="h-6 px-2 text-xs border-primary/30 hover:border-primary hover:bg-primary/10 whitespace-nowrap"
                  >
                    <Merge className="h-3 w-3 mr-1" />
                    Merge
                  </Button>
                </div>
              )}
            </div>

            {/* To Asset with recipient balances */}
            <Select
              value={paymentData.receiveAsset || "same"}
              onValueChange={(value) => {
                const selectedAsset = recipientAssetOptions.find(asset => asset.code === value);
                onPaymentDataChange({
                  ...paymentData,
                  receiveAsset: value === "same" ? undefined : value,
                  receiveAssetIssuer: selectedAsset?.issuer || undefined
                });
              }}
            >
              <SelectTrigger className="h-12 border-border/60 focus:border-primary">
                <SelectValue placeholder="Same">
                  <span className="font-semibold text-sm">
                    {paymentData.receiveAsset || paymentData.asset}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-[300px] max-h-64 overflow-y-auto z-50 bg-popover border border-border shadow-lg">
                <div className="sticky top-0 z-[100] grid grid-cols-[80px_1fr] items-center gap-3 pl-8 pr-2 py-3 text-[11px] text-muted-foreground bg-card/95 backdrop-blur-sm border-b border-border shadow-md">
                  <span className="uppercase tracking-wider font-medium">Asset</span>
                  <span className="text-right uppercase tracking-wider font-medium">Recipient Has</span>
                </div>
                <SelectPrimitive.Item
                  value="same"
                  className="relative rounded-sm py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground cursor-pointer"
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="h-4 w-4" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>
                    <div className="grid grid-cols-[80px_1fr] items-center gap-3">
                      <span className="text-muted-foreground">Same ({paymentData.asset})</span>
                      <span className="font-amount tabular-nums text-right text-xs text-muted-foreground">
                        {recipientHas(paymentData.asset)
                          ? parseFloat(recipientBalance(paymentData.asset) || '0').toLocaleString('en-US', { maximumFractionDigits: 7 })
                          : '—'}
                      </span>
                    </div>
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
                {getReceiveOptions().filter(asset => asset.code !== paymentData.asset).map((asset) => (
                  <SelectPrimitive.Item
                    key={`${asset.code}-${asset.issuer}`}
                    value={asset.code}
                    className="relative rounded-sm py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground cursor-pointer"
                  >
                    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                      <SelectPrimitive.ItemIndicator>
                        <Check className="h-4 w-4" />
                      </SelectPrimitive.ItemIndicator>
                    </span>
                    <SelectPrimitive.ItemText>
                      <div className="grid grid-cols-[80px_1fr] items-center gap-3">
                        <span className="font-medium">{asset.code}</span>
                        <span className="font-amount tabular-nums text-right text-xs text-muted-foreground">
                          {recipientHas(asset.code)
                            ? parseFloat(recipientBalance(asset.code) || '0').toLocaleString('en-US', { maximumFractionDigits: 7 })
                            : '—'}
                        </span>
                      </div>
                    </SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Slippage Tolerance (only when cross-asset) */}
        {paymentData.receiveAsset && paymentData.receiveAsset !== paymentData.asset && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Slippage Tolerance</Label>
            <div className="flex items-center space-x-4">
              <input
                type="range"
                min={0.1}
                max={5}
                step={0.1}
                value={paymentData.slippageTolerance || 0.5}
                onChange={(e) => onPaymentDataChange({ ...paymentData, slippageTolerance: parseFloat(e.target.value) })}
                className="flex-1 stellar-slider stellar-slider-purple"
                style={{ '--slider-progress': `${((paymentData.slippageTolerance || 0.5) - 0.1) / (5 - 0.1) * 100}%` } as React.CSSProperties}
              />
              <span className="text-sm font-mono w-12 text-right">
                {(paymentData.slippageTolerance || 0.5).toFixed(1)}%
              </span>
            </div>
          </div>
        )}

        {/* Memo */}
        <div className="space-y-2">
          <Label htmlFor="memo" className="text-sm font-medium">Memo (Optional)</Label>
          <Input
            id="memo"
            placeholder="Payment description"
            className="font-mono text-xs bg-background border-border/60 focus:border-primary"
            value={paymentData.memo}
            onChange={(e) => onPaymentDataChange({ ...paymentData, memo: e.target.value })}
          />
        </div>


        {/* Destination Account Info */}
        {paymentData.destination && (
          <DestinationAccountInfo destination={paymentData.destination} />
        )}

        {/* Trustline Error */}
        {trustlineError && (
          <div className={`p-3 rounded-lg border ${
            trustlineError.includes('will create a new') 
              ? 'bg-muted/50 border-border' 
              : 'bg-destructive/10 border-destructive/30'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                trustlineError.includes('will create a new')
                  ? 'bg-muted'
                  : 'bg-destructive/10'
              }`}>
                {trustlineError.includes('will create a new') ? (
                  <Info className="w-3 h-3 text-muted-foreground" />
                ) : (
                  <AlertTriangle className="w-3 h-3 text-destructive" />
                )}
              </div>
              <div className="flex-1">
                <p className={`text-xs font-medium ${
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
        </>)

        {/* Action Buttons */}
        <div className="flex gap-3">
          {!willCloseAccount && isFormValid() && !showBundleActions && compactPayments.length === 0 && (
            <Button
              onClick={handleBundlePayment}
              variant="outline"
              className="border-dashed border-border/60 hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary transition-colors"
            >
              <Plus className="w-4 h-4 mr-2" />
              Bundle Payment
            </Button>
          )}

          {/* Bundle Actions - Show after clicking Bundle Payment */}
          {showBundleActions && (
            <>
              <Button
                onClick={() => setShowBundleActions(false)}
                variant="outline"
                className="flex-1 border-dashed border-border/60 hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Payment
              </Button>
              <Button 
                onClick={handleBuild} 
                disabled={isBuilding || !isFormValid()}
                className="flex-1 bg-gradient-primary hover:opacity-90 disabled:opacity-50"
                size="lg"
              >
                {isBuilding ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Building...
                  </div>
                ) : (
                  'Build Transaction'
                )}
              </Button>
            </>
          )}

          {compactPayments.length > 0 && !showBundleActions && (
            <>
              <Button
                onClick={handleBundlePayment}
                variant="outline"
                className="flex-1 border-dashed border-border/60 hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                Bundle Payment
              </Button>
              <Button
                onClick={cancelCurrentPayment}
                variant="ghost"
                className="flex-1"
              >
                Cancel Current Transaction
              </Button>
            </>
          )}

          {/* Single Build Transaction Button */}
          {!showBundleActions && compactPayments.length === 0 && (
            <Button 
              onClick={handleBuild} 
              disabled={isBuilding || !isFormValid()}
              className={`w-full bg-gradient-primary hover:opacity-90 disabled:opacity-50`}
              size="lg"
            >
              {isBuilding ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  Building Transaction...
                </div>
              ) : (
                paymentData.receiveAsset && paymentData.receiveAsset !== paymentData.asset ? 
                  'Build Cross-Asset Payment' : 'Build Payment Transaction'
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};