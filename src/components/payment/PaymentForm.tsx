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
  const { network } = useNetwork();
  const [fiatValue, setFiatValue] = useState<string>('');
  
  // Payment items state (includes main payment + additional payments)
  const [additionalPayments, setAdditionalPayments] = useState<PaymentItem[]>([]);
  const [willCloseAccount, setWillCloseAccount] = useState(false);
  const [showAutoAdjustWarning, setShowAutoAdjustWarning] = useState(false);
  const [mergePaymentId, setMergePaymentId] = useState<string | null>(null);
  const [fiatValues, setFiatValues] = useState<Record<string, string>>({});
  const [recipientAssetsMain, setRecipientAssetsMain] = useState<string[]>([]);
  const [recipientAssetsById, setRecipientAssetsById] = useState<Record<string, string[]>>({});

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

  const fetchRecipientAssets = async (accountId: string): Promise<string[]> => {
    const server = new StellarSDK.Horizon.Server(
      network === 'testnet' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org'
    );
    try {
      const account = await server.loadAccount(accountId);
      const codes = new Set<string>(['XLM']);
      account.balances.forEach((b: any) => {
        if (b.asset_type === 'native') codes.add('XLM');
        else if (b.asset_code) codes.add(b.asset_code);
      });
      return Array.from(codes);
    } catch {
      return ['XLM'];
    }
  };

  useEffect(() => {
    if (!isValidPublicKey(paymentData.destination)) {
      setRecipientAssetsMain([]);
      return;
    }
    let cancelled = false;
    fetchRecipientAssets(paymentData.destination).then((codes) => {
      if (!cancelled) setRecipientAssetsMain(codes);
    });
    return () => {
      cancelled = true;
    };
  }, [paymentData.destination, network]);

  useEffect(() => {
    const fetchAll = async () => {
      const entries = await Promise.all(
        additionalPayments.map(async (p) => {
          if (!isValidPublicKey(p.destination)) return [p.id, [] as string[]] as const;
          const codes = await fetchRecipientAssets(p.destination);
          return [p.id, codes] as const;
        })
      );
      const map: Record<string, string[]> = {};
      entries.forEach(([id, codes]) => (map[id] = codes));
      setRecipientAssetsById(map);
    };
    fetchAll();
  }, [additionalPayments.map((p) => p.destination).join(','), network]);

  // Auto-select a valid receive asset if "same" isn't accepted by destination
  useEffect(() => {
    if (recipientAssetsMain.length === 0) return;
    const sameAllowed = paymentData.asset === 'XLM' || recipientAssetsMain.includes(paymentData.asset);
    if (!sameAllowed && (!paymentData.receiveAsset || !recipientAssetsMain.includes(paymentData.receiveAsset))) {
      const fallback = recipientAssetsMain.includes('XLM') ? 'XLM' : recipientAssetsMain[0];
      const selectedAsset = availableAssets.find((a) => a.code === fallback);
      onPaymentDataChange({ ...paymentData, receiveAsset: fallback, receiveAssetIssuer: selectedAsset?.issuer });
    }
  }, [recipientAssetsMain, paymentData.asset]);

  useEffect(() => {
    if (additionalPayments.length === 0) return;
    setAdditionalPayments((prev) =>
      prev.map((p) => {
        const destAssets = recipientAssetsById[p.id] || [];
        const sameAllowed = p.asset === 'XLM' || destAssets.includes(p.asset);
        if (!sameAllowed && (!p.receiveAsset || !destAssets.includes(p.receiveAsset))) {
          const fallback = destAssets.includes('XLM') ? 'XLM' : destAssets[0];
          return { ...p, receiveAsset: fallback };
        }
        return p;
      })
    );
  }, [recipientAssetsById]);

  const getReceiveOptionsMain = () => {
    const allowed = new Set<string>(recipientAssetsMain.length ? recipientAssetsMain : ['XLM']);
    allowed.add('XLM');
    return availableAssets.filter((a) => allowed.has(a.code));
  };

  const getReceiveOptionsForPayment = (id: string) => {
    const codes = recipientAssetsById[id] || [];
    const allowed = new Set<string>(codes.length ? codes : ['XLM']);
    allowed.add('XLM');
    return availableAssets.filter((a) => allowed.has(a.code));
  };
  const handleSliderChange = (value: string, paymentId?: string) => {
    handleAmountChange(value, paymentId);
  };

  const handleMergeAccount = (paymentId?: string) => {
    if (!canCloseAccount()) return;
    
    const fullBalance = getMaxSliderValue('XLM');
    handleAmountChange(fullBalance.toString(), paymentId);
    setMergePaymentId(paymentId || 'main');
    setWillCloseAccount(true);
  };

  // Update fiat value when amount, asset, or currency changes
  useEffect(() => {
    const updateFiatValues = async () => {
      const newFiatValues: Record<string, string> = {};
      
      // Main payment
      if (paymentData.amount && paymentData.asset) {
        const price = assetPrices[paymentData.asset] || 0;
        if (price > 0) {
          const usdValue = parseFloat(paymentData.amount) * price;
          if (quoteCurrency === 'USD') {
            newFiatValues['main'] = `$${usdValue.toFixed(2)}`;
          } else {
            try {
              const convertedValue = await convertFromUSD(usdValue, quoteCurrency);
              const currency = getCurrentCurrency();
              newFiatValues['main'] = `${currency?.symbol || ''}${convertedValue.toFixed(2)}`;
            } catch (error) {
              newFiatValues['main'] = `$${usdValue.toFixed(2)}`;
            }
          }
        } else {
          newFiatValues['main'] = 'N/A';
        }
      }
      
      // Additional payments
      for (const payment of additionalPayments) {
        if (payment.amount && payment.asset) {
          const price = assetPrices[payment.asset] || 0;
          if (price > 0) {
            const usdValue = parseFloat(payment.amount) * price;
            if (quoteCurrency === 'USD') {
              newFiatValues[payment.id] = `$${usdValue.toFixed(2)}`;
            } else {
              try {
                const convertedValue = await convertFromUSD(usdValue, quoteCurrency);
                const currency = getCurrentCurrency();
                newFiatValues[payment.id] = `${currency?.symbol || ''}${convertedValue.toFixed(2)}`;
              } catch (error) {
                newFiatValues[payment.id] = `$${usdValue.toFixed(2)}`;
              }
            }
          } else {
            newFiatValues[payment.id] = 'N/A';
          }
        }
      }
      
      setFiatValues(newFiatValues);
      // Legacy support for main payment fiat value
      setFiatValue(newFiatValues['main'] || '');
    };

    updateFiatValues();
  }, [paymentData.amount, paymentData.asset, quoteCurrency, assetPrices, getCurrentCurrency, additionalPayments]);

  const formatDisplayAmount = (value: string | number) => {
    const s = String(value);
    if (s === '' || s === '0') return '0.0';
    if (!s.includes('.')) return `${s}.0`;
    const [int, dec] = s.split('.');
    return `${int}.${dec}`;
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

    // Reset merge state if amount changes and it's not a merge
    if (mergePaymentId && !willCloseAccount) {
      setMergePaymentId(null);
    }

    // Smart balance redistribution when total exceeds available
    if (additionalPayments.length > 0) {
      setTimeout(() => {
        const total = getTotalAmount();
        const available = getAvailableBalance(paymentData.asset);
        
        if (total > available) {
          setShowAutoAdjustWarning(true);
          // Proportionally reduce all amounts
          const ratio = available / total;
          const newMainAmount = ((parseFloat(paymentData.amount) || 0) * ratio).toFixed(7);
          onPaymentDataChange({ ...paymentData, amount: newMainAmount });
          
          setAdditionalPayments(prev => prev.map(p => ({
            ...p,
            amount: ((parseFloat(p.amount) || 0) * ratio).toFixed(7)
          })));
          
          // Hide warning after 4 seconds
          setTimeout(() => setShowAutoAdjustWarning(false), 4000);
        } else {
          setShowAutoAdjustWarning(false);
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

  // Custom slider component with embedded text
  const CustomSlider = ({ 
    value, 
    max, 
    assetCode, 
    paymentId, 
    onValueChange,
    className = ""
  }: {
    value: number;
    max: number;
    assetCode: string;
    paymentId?: string;
    onValueChange: (value: string) => void;
    className?: string;
  }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value.toString());
    const percentage = max > 0 ? (value / max) * 100 : 0;
    const availableBalance = getAvailableBalance(assetCode);
    const isOverLimit = value > availableBalance;
    const isMerged = mergePaymentId === (paymentId || 'main');
    
    const handleEditSubmit = () => {
      const numValue = parseFloat(editValue) || 0;
      const clampedValue = Math.min(Math.max(0, numValue), max);
      onValueChange(clampedValue.toString());
      setEditValue(clampedValue.toString());
      setIsEditing(false);
    };

    const handleEditKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleEditSubmit();
      } else if (e.key === 'Escape') {
        setEditValue(value.toString());
        setIsEditing(false);
      }
    };

    useEffect(() => {
      if (!isEditing) {
        setEditValue(value.toString());
      }
    }, [value, isEditing]);
    
    return (
      <div className={`relative ${className}`}>
        <div className="relative h-12 bg-muted/50 rounded-lg overflow-hidden border border-border/30 hover:border-border/60 transition-colors">
          {/* Background fill */}
          <div 
            className={`absolute inset-y-0 left-0 transition-all duration-300 ${
              isOverLimit ? 'bg-gradient-to-r from-warning/30 to-destructive/30' : 'bg-primary/25'
            }`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
          
          {/* Slider input */}
          <input
            type="range"
            min={0}
            max={max}
            step="any"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            disabled={isMerged}
          />
          
          {/* Text content */}
          <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{assetCode}</span>
              {isOverLimit && canCloseAccount() && (
                <Badge variant="destructive" className="text-xs pointer-events-none">Close Account</Badge>
              )}
            </div>
            <div className="text-right pointer-events-auto">
              {isEditing ? (
                <Input
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={handleEditSubmit}
                  onKeyDown={handleEditKeyDown}
                  className="h-6 w-24 text-xs font-mono text-right p-1 bg-background/90 border border-primary/50"
                  autoFocus
                  step="any"
                  min="0"
                  max={max}
                />
              ) : (
                <div 
                  className="cursor-pointer hover:bg-background/20 rounded px-2 py-1 transition-colors group"
                  onClick={() => setIsEditing(true)}
                >
                  <div className="text-sm font-mono font-semibold text-foreground group-hover:text-primary transition-colors">
                    {formatDisplayAmount(value.toString())}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    / {formatDisplayAmount(max.toString())}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Merge button for XLM */}
        {assetCode === 'XLM' && canCloseAccount() && !isMerged && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleMergeAccount(paymentId)}
            className="absolute -right-20 top-1/2 -translate-y-1/2 h-8 px-3 text-xs border-primary/30 hover:border-primary hover:bg-primary/10"
          >
            <Merge className="h-3 w-3 mr-1" />
            Merge
          </Button>
        )}
        
        {isMerged && (
          <div className="absolute -right-16 top-1/2 -translate-y-1/2">
            <Badge variant="destructive" className="text-xs">
              <Merge className="h-3 w-3 mr-1" />
              Closing
            </Badge>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {showAutoAdjustWarning && (
        <Alert variant="destructive" className="animate-fade-in">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Total amount exceeds available balance. Amounts will be automatically adjusted.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Payment Form */}
      <div className="space-y-3">
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

        {/* Compact Payment Row */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Payment Details</Label>
            {fiatValue && (
              <span className="text-sm text-primary font-medium">≈ {fiatValue}</span>
            )}
          </div>
          
          <div className="grid grid-cols-[120px_1fr_120px] gap-3 items-center">
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
                setMergePaymentId(null);
                setWillCloseAccount(false);
              }}
            >
              <SelectTrigger className="h-10 border-border/60 focus:border-primary">
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

            {/* Amount Slider */}
            <CustomSlider
              value={parseFloat(paymentData.amount) || 0}
              max={getMaxSliderValue(paymentData.asset)}
              assetCode={paymentData.asset}
              onValueChange={(value) => handleSliderChange(value)}
              className="min-w-0"
            />

            {/* To Asset */}
            <Select
              value={paymentData.receiveAsset || "same"}
              onValueChange={(value) => {
                  const selectedAsset = availableAssets.find(asset => asset.code === value);
                  onPaymentDataChange({
                    ...paymentData,
                    receiveAsset: value === "same" ? undefined : value,
                    receiveAssetIssuer: selectedAsset?.issuer || undefined
                  });
                }}
            >
              <SelectTrigger className="h-10 border-border/60 focus:border-primary">
                <SelectValue placeholder="Same">
                  <span className="font-semibold text-sm">
                    {paymentData.receiveAsset || paymentData.asset}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-[200px] max-h-64 overflow-y-auto z-50 bg-popover border border-border shadow-lg">
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
                    <span className="text-muted-foreground">Same ({paymentData.asset})</span>
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
                {getReceiveOptionsMain().filter(asset => asset.code !== paymentData.asset).map((asset) => (
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
                      <span className="font-medium">{asset.code}</span>
                    </SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {willCloseAccount && (
          <Alert variant="destructive" className="animate-fade-in">
            <Merge className="h-4 w-4" />
            <AlertDescription>
              This will close your account and send all remaining XLM to the destination address.
            </AlertDescription>
          </Alert>
        )}

        {/* Additional Payments */}
        {additionalPayments.map((payment, index) => (
          <div key={payment.id} className="space-y-4 pt-8 mt-8 border-t border-border/30 relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-foreground">Payment #{index + 2}</span>
                {fiatValues[payment.id] && (
                  <span className="text-sm text-primary font-medium">≈ {fiatValues[payment.id]}</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removePayment(payment.id)}
                className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 h-8 w-8 p-0 rounded-full"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            
            {/* Destination */}
            <div className="space-y-2">
              <Label htmlFor={`destination-${payment.id}`} className="text-sm font-medium">
                Destination Address
              </Label>
              <Input
                id={`destination-${payment.id}`}
                placeholder="GABC..."
                maxLength={56}
                value={payment.destination}
                onChange={(e) => updatePayment(payment.id, { destination: e.target.value })}
                className="text-xs font-address bg-background border-border/60 focus:border-primary"
              />
            </div>
            
            {/* Compact Payment Row for Additional Payment */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Payment Details</Label>
              <div className="grid grid-cols-[120px_1fr_120px] gap-3 items-center">
                {/* From Asset (locked to main payment asset) */}
                <div className="h-10 flex items-center justify-center bg-muted/50 rounded-md border border-border/30">
                  <span className="font-semibold text-sm">{payment.asset}</span>
                </div>

                {/* Amount Slider */}
                <CustomSlider
                  value={parseFloat(payment.amount) || 0}
                  max={getAvailableBalance(payment.asset)}
                  assetCode={payment.asset}
                  paymentId={payment.id}
                  onValueChange={(value) => handleSliderChange(value, payment.id)}
                  className="min-w-0"
                />

                {/* To Asset */}
                <Select
                  value={payment.receiveAsset || "same"}
                  onValueChange={(value) => {
                    const selectedAsset = availableAssets.find(asset => asset.code === value);
                    updatePayment(payment.id, {
                      receiveAsset: value === "same" ? undefined : value,
                      receiveAssetIssuer: selectedAsset?.issuer || undefined
                    });
                  }}
                >
                  <SelectTrigger className="h-10 border-border/60 focus:border-primary">
                    <SelectValue placeholder="Same">
                      <span className="font-semibold text-sm">
                        {payment.receiveAsset || payment.asset}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                <SelectContent className="min-w-[200px] max-h-64 overflow-y-auto z-50 bg-popover border border-border shadow-lg">
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
                        <span className="text-muted-foreground">Same ({payment.asset})</span>
                      </SelectPrimitive.ItemText>
                    </SelectPrimitive.Item>
                    {getReceiveOptionsForPayment(payment.id).filter(asset => asset.code !== payment.asset).map((asset) => (
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
                          <span className="font-medium">{asset.code}</span>
                        </SelectPrimitive.ItemText>
                      </SelectPrimitive.Item>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Memo for Additional Payment */}
            <div className="space-y-2">
              <Label htmlFor={`memo-${payment.id}`} className="text-sm font-medium">Memo (Optional)</Label>
              <Input
                id={`memo-${payment.id}`}
                placeholder="Payment description"
                className="font-mono text-xs bg-background border-border/60 focus:border-primary"
                value={payment.memo}
                onChange={(e) => updatePayment(payment.id, { memo: e.target.value })}
              />
            </div>
            
            {/* Destination Account Info for Additional Payment */}
            {payment.destination && (
              <DestinationAccountInfo destination={payment.destination} />
            )}
          </div>
        ))}
        
        {/* Add Payment Button */}
        <Button
          onClick={addPayment}
          variant="outline"
          className="w-full border-dashed border-border/60 hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Another Payment
        </Button>

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
        
        {/* Account Status Info */}
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