import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Check, Info, Plus, Trash2, ArrowRight, ArrowDown, TrendingUp, Merge, Users, Edit2, X, QrCode, ExternalLink } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { resolveSorobanDomain, isLikelySorobanDomain } from '@/lib/soroban-domains';
import { isValidPublicKey, isValidDomain, isValidAmount } from '@/lib/validation';
import { useToast } from '@/hooks/use-toast';
import { DestinationAccountInfo } from './DestinationAccountInfo';
import { SwapInterface } from '../SwapInterface';
import { AssetIcon } from '../AssetIcon';
import { useNetwork } from '@/contexts/NetworkContext';
import { AddressAutocomplete } from '../AddressAutocomplete';
import { QRScanner } from '../QRScanner';
import { useAddressBook } from '@/hooks/useAddressBook';
import * as StellarSDK from '@stellar/stellar-sdk';
interface PaymentData {
  destination: string;
  amount: string;
  asset: string;
  assetIssuer: string;
  memo: string;
  receiveAsset?: string;
  receiveAssetIssuer?: string;
  receiveAmount?: string;
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
  isAccountClosure?: boolean;
}
interface PaymentFormProps {
  paymentData: PaymentData;
  onPaymentDataChange: (data: PaymentData) => void;
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
  onFetchAssetPrice?: (assetCode: string, assetIssuer?: string) => Promise<number>;
  trustlineError: string;
  onBuild: (paymentData?: PaymentData, isAccountMerge?: boolean, payments?: CompactPayment[], pathPayment?: unknown) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
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
  onClearTransaction?: () => void;
  onTransactionBuilt?: () => void;
  onResetTransactionBuilt?: () => void;
}
export const PaymentForm = ({
  paymentData,
  onPaymentDataChange,
  availableAssets,
  assetPrices,
  onFetchAssetPrice,
  trustlineError,
  onBuild,
  isBuilding,
  isTransactionBuilt,
  accountData,
  accountPublicKey,
  onClearTransaction,
  onTransactionBuilt,
  onResetTransactionBuilt
}: PaymentFormProps) => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const { network } = useNetwork();
  const { toast } = useToast();

  // State for compact payments (previous payments)
  const [compactPayments, setCompactPayments] = useState<CompactPayment[]>([]);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [resolvingDomain, setResolvingDomain] = useState(false);

  // State for current payment and flow control
  const [fiatValue, setFiatValue] = useState<string>('');
  const [domainSuggestions, setDomainSuggestions] = useState<{ domain: string; address: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  type RecipientAsset = {
    code: string;
    issuer?: string;
    balance: string;
  };
  const [recipientAssetOptions, setRecipientAssetOptions] = useState<RecipientAsset[]>([]);
  const [recipientExists, setRecipientExists] = useState<boolean | null>(null);
  const [willCloseAccount, setWillCloseAccount] = useState(false);
  
  const [hasActiveForm, setHasActiveForm] = useState(false);
  const isDraggingRef = useRef(false);
  
  // Effect to handle transaction built callback
  useEffect(() => {
    if (onTransactionBuilt && isTransactionBuilt) {
      onTransactionBuilt();
    }
  }, [onTransactionBuilt, isTransactionBuilt]);

  // Calculate Stellar reserves for XLM
  const calculateXLMReserve = () => {
    const baseReserve = 0.5;
    const accountEntries = 1; // Base account
    const signersCount = accountData.signers.length - 1; // Subtract master key
    const trustlinesCount = accountData.balances.filter(b => b.asset_type !== 'native').length;
    const offersCount = 0; // We don't track offers in this app, but they would add to reserves
    
    return (accountEntries + signersCount + trustlinesCount + offersCount) * baseReserve + 1; // +1 XLM for safety and fees
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

  // Calculate leftover balance after all other transactions (for merge display)
  const getLeftoverBalance = useCallback((assetCode: string) => {
    // Use FULL balance for merge (do not subtract reserves/fees)
    const asset = availableAssets.find(a => a.code === assetCode);
    const fullBalance = asset ? parseFloat(asset.balance) : 0;
    const compactTotal = compactPayments
      .filter(p => p.asset === assetCode && !p.isAccountClosure) // Exclude other merges
      .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    return Math.max(0, fullBalance - compactTotal);
  }, [availableAssets, compactPayments]);
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
    // Method 1: Account has only XLM (no other trustlines) 
    const hasOnlyXLM = accountData.balances.filter(b => b.asset_type !== 'native').length === 0;
    if (hasOnlyXLM) return true;

    // Method 2: All assets would be drained by planned transactions
    const allAssets = accountData.balances.map(b => {
      if (b.asset_type === 'native') return 'XLM';
      return b.asset_code || 'UNKNOWN';
    });

    const wouldDrainAllAssets = allAssets.every(assetCode => {
      const availableBalance = getAvailableBalance(assetCode);
      
      // Calculate total planned outflows for this asset
      const compactTotal = compactPayments
        .filter(p => p.asset === assetCode && !p.isAccountClosure)
        .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
      
      // Add current form amount if it matches this asset
      const currentAmount = (paymentData.asset === assetCode && paymentData.amount) 
        ? parseFloat(paymentData.amount) : 0;
      
      const totalPlanned = compactTotal + currentAmount;
      const remaining = availableBalance - totalPlanned;
      
      // Consider asset drained if remaining is very small (< 0.001)
      return remaining < 0.001;
    });

    return wouldDrainAllAssets;
  };
  const checkAccountClosure = (amount: string, assetCode: string) => {
    if (assetCode !== 'XLM' || !canCloseAccount()) return false;
    const numAmount = parseFloat(amount);
    const availableBalance = getAvailableBalance('XLM');
    return numAmount > availableBalance;
  };

  // CRITICAL: Use proper validation for destination addresses
  const isValidStellarAddress = (s?: string) => !!s && isValidPublicKey(s);
  const fetchRecipientAssets = useCallback(async (accountId: string): Promise<{
    exists: boolean;
    assets: RecipientAsset[];
  }> => {
    const server = new StellarSDK.Horizon.Server(network === 'testnet' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    try {
      const account = await server.loadAccount(accountId);
      const assets: RecipientAsset[] = [];
      account.balances.forEach((b: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }) => {
        if (b.asset_type === 'native') {
          assets.push({
            code: 'XLM',
            balance: b.balance
          });
        } else if (b.asset_code) {
          assets.push({
            code: b.asset_code,
            issuer: b.asset_issuer,
            balance: b.balance
          });
        }
      });
      // Ensure XLM appears even if missing (shouldn't happen for existing accounts)
      if (!assets.some(a => a.code === 'XLM')) assets.unshift({
        code: 'XLM',
        balance: '0'
      });
      return {
        exists: true,
        assets
      };
    } catch {
      // New account: only XLM allowed
      return {
        exists: false,
        assets: [{
          code: 'XLM',
          balance: '0'
        }]
      };
    }
  }, [network]);

  // Fetch recipient assets when destination changes
  useEffect(() => {
    if (!isValidStellarAddress(paymentData.destination)) {
      setRecipientAssetOptions([]);
      setRecipientExists(null);
      return;
    }
    let cancelled = false;
    fetchRecipientAssets(paymentData.destination).then(({
      exists,
      assets
    }) => {
      if (!cancelled) {
        setRecipientExists(exists);
        setRecipientAssetOptions(assets);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [paymentData.destination, network, fetchRecipientAssets]);

// Removed auto-selection of receive asset to respect manual choice and explicit rules
// per user request: no automatic adjustments.

  // Helper to dynamically format fiat value based on current currency context
  const formatDynamicFiatValue = useCallback(async (amount: string, asset: string) => {
    const price = assetPrices[asset] || 0;
    if (price > 0) {
      const usdValue = parseFloat(amount) * price;
      const currency = getCurrentCurrency();
      if (currency.code === 'USD') {
        return `${currency.symbol}${usdValue.toFixed(2)} ${currency.code}`;
      } else {
        try {
          const convertedValue = await convertFromUSD(usdValue, currency.code);
          return `${currency.symbol}${convertedValue.toFixed(2)} ${currency.code}`;
        } catch (error) {
          return `$${usdValue.toFixed(2)} USD`;
        }
      }
    }
    return null;
  }, [assetPrices, getCurrentCurrency]);

  // State to store formatted fiat values for compact payments
  const [compactPaymentFiatValues, setCompactPaymentFiatValues] = useState<Record<string, string>>({});

  // Update fiat values for compact payments when currency changes
  useEffect(() => {
    const updateCompactFiatValues = async () => {
      const newValues: Record<string, string> = {};
      for (const payment of compactPayments) {
        const fiatValue = await formatDynamicFiatValue(payment.amount, payment.asset);
        if (fiatValue) {
          newValues[payment.id] = fiatValue;
        }
      }
      setCompactPaymentFiatValues(newValues);
    };
    
    if (compactPayments.length > 0) {
      updateCompactFiatValues();
    }
  }, [compactPayments, quoteCurrency, assetPrices, getCurrentCurrency, formatDynamicFiatValue]);

  // Helper to handle destination input and domain resolution
  const handleDestinationChange = (inputValue: string) => {
    const trimmedValue = inputValue.trim();
    
    // Update the field immediately
    onPaymentDataChange({
      ...paymentData,
      destination: inputValue // Keep original input with spaces
    });

    // Clear previous timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Clear suggestions if input is empty or looks like a Stellar address
    if (!trimmedValue || isValidPublicKey(trimmedValue)) {
      setShowSuggestions(false);
      setDomainSuggestions([]);
      return;
    }

    // If input looks like a domain, set up debounced resolution
    if (isLikelySorobanDomain(trimmedValue)) {
      const timer = setTimeout(async () => {
        if (isValidDomain(trimmedValue)) {
          setResolvingDomain(true);
          const result = await resolveSorobanDomain(trimmedValue, network);
          
          if (result.success) {
            setDomainSuggestions([{ domain: trimmedValue, address: result.address }]);
            setShowSuggestions(true);
          } else {
            setDomainSuggestions([]);
            setShowSuggestions(false);
          }
          setResolvingDomain(false);
        }
      }, 150);
      
      setDebounceTimer(timer);
    } else {
      setShowSuggestions(false);
      setDomainSuggestions([]);
    }
  };

  // Helper to select a domain suggestion
  const selectDomainSuggestion = (suggestion: { domain: string; address: string }) => {
    onPaymentDataChange({
      ...paymentData,
      destination: suggestion.address
    });
    setShowSuggestions(false);
    setDomainSuggestions([]);
  };

  // Helper to validate destination input
  const isValidDestination = (destination: string): boolean => {
    if (!destination) return true; // Empty is valid (will show as required field)
    return isValidPublicKey(destination) || isValidDomain(destination);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [debounceTimer]);
  const calculateFiatValue = useCallback(async (amount: string, asset: string) => {
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
  }, [assetPrices, quoteCurrency, getCurrentCurrency]);

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
  }, [paymentData.amount, paymentData.asset, quoteCurrency, assetPrices, getCurrentCurrency, calculateFiatValue]);

  // Update amount when willCloseAccount changes or when compactPayments change
  useEffect(() => {
    if (willCloseAccount && paymentData.asset === 'XLM') {
      const leftoverBalance = getLeftoverBalance('XLM');
      onPaymentDataChange({
        ...paymentData,
        amount: leftoverBalance.toFixed(7)
      });
    }
  }, [willCloseAccount, compactPayments, getLeftoverBalance, onPaymentDataChange, paymentData]);
  const formatDisplayAmount = (value: string | number) => {
    const s = String(value);
    if (s === '' || s === '0') return '0.0';
    if (!s.includes('.')) return `${s}.0`;
    const [int, dec] = s.split('.');
    return `${int}.${dec}`;
  };

  const getAssetExplorerUrl = (assetCode: string, assetIssuer?: string): string => {
    const networkPath = network === 'testnet' ? 'testnet' : 'public';
    if (!assetIssuer || assetCode === 'XLM') {
      return `https://stellar.expert/explorer/${networkPath}/asset/XLM`;
    }
    return `https://stellar.expert/explorer/${networkPath}/asset/${assetCode}-${assetIssuer}`;
  };

  const handleAmountChange = (newAmount: string) => {
    // For merge operations, don't allow manual amount changes - use leftover balance
    if (willCloseAccount && paymentData.asset === 'XLM') {
      const leftoverBalance = getLeftoverBalance('XLM');
      const fixed = leftoverBalance.toFixed(7);
      onPaymentDataChange({
        ...paymentData,
        amount: fixed
      });
      return;
    }

    // Enforce 7 decimal places max; do not auto-clamp
    let num = parseFloat(newAmount);
    if (isNaN(num)) num = 0;
    const fixed = num.toFixed(7); // Stellar supports up to 7 decimals

    onPaymentDataChange({
      ...paymentData,
      amount: fixed
    });
    setWillCloseAccount(checkAccountClosure(fixed, paymentData.asset));

    // Auto-adjust removed per user request
  };
  const handleMergeAccount = () => {
    if (!canCloseAccount()) return;
    
    // For merge, show the leftover balance that will be transferred
    const leftoverBalance = getLeftoverBalance('XLM');
    
    // Use current destination if provided, otherwise require user input
    // For account merge, receiving asset must be XLM
    onPaymentDataChange({
      ...paymentData,
      asset: 'XLM',
      assetIssuer: '',
      receiveAsset: 'XLM',
      receiveAssetIssuer: '',
      destination: paymentData.destination || '',
      amount: leftoverBalance.toString()
    });
    setWillCloseAccount(true);
  };

  // Helper function for path payment receive amount calculation
  const calculatePathPaymentReceiveAmount = (amount: string, fromAsset: string, toAsset: string): string => {
    const numAmount = parseFloat(amount);
    if (!numAmount) return '0';
    
    // Get the price ratio between assets if available
    const fromPrice = assetPrices[fromAsset] || 0;
    const toPrice = assetPrices[toAsset] || 0;
    
    if (fromPrice > 0 && toPrice > 0) {
      // Calculate conversion based on USD prices
      const usdValue = numAmount * fromPrice;
      const convertedAmount = usdValue / toPrice;
      
      // Apply slippage tolerance
      const slippageAdjustment = 1 - ((paymentData.slippageTolerance || 0.5) / 100);
      return (convertedAmount * slippageAdjustment).toFixed(7);
    }
    
    // No fallback to 1:1 - return 0 when prices are unavailable
    return '0';
  };
  const handleRevertMerge = () => {
    setWillCloseAccount(false);
    const availableBalance = getAvailableBalance('XLM');
    handleAmountChange(availableBalance.toString());
  };
  const getReceiveOptions = () => {
    // If account doesn't exist, only XLM allowed
    if (recipientExists === false) return [{
      code: 'XLM',
      issuer: undefined,
      balance: '0'
    }];
    // Otherwise, use recipient's actual balances
    const unique = new Map<string, RecipientAsset>();
    recipientAssetOptions.forEach(a => unique.set(a.code, a));
    // Always ensure XLM is present, but preserve existing balance
    if (!unique.has('XLM')) {
      // Find XLM balance from original data or default to '0'
      const xlmBalance = recipientAssetOptions.find(a => a.code === 'XLM')?.balance || '0';
      unique.set('XLM', {
        code: 'XLM',
        balance: xlmBalance
      });
    }
    return Array.from(unique.values());
  };
  const recipientHas = (code: string) => recipientAssetOptions.some(a => a.code === code);
  const recipientBalance = (code: string) => recipientAssetOptions.find(a => a.code === code)?.balance;
  const handleBundlePayment = async () => {
    // Bundle current form: convert it to compact payment and add to list
    if (!isFormValid()) return;

    // Calculate fiat value for the current payment using the same method as the main form
    const currentFiatValue = await calculateFiatValue(paymentData.amount, paymentData.asset);

    // Check if this payment is an account closure - use willCloseAccount state for merge operations
    const isAccountClosure = willCloseAccount || checkAccountClosure(paymentData.amount, paymentData.asset);

    // Create compact payment from current form
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
      fiatValue: currentFiatValue,
      isAccountClosure: isAccountClosure
    };
    setCompactPayments([...compactPayments, compactPayment]);

    // Clear any built transaction since it's no longer valid
    onClearTransaction?.();

    // Reset current payment form
    onPaymentDataChange({
      destination: '',
      amount: '',
      asset: paymentData.asset,
      // Keep same asset
      assetIssuer: paymentData.assetIssuer,
      memo: '',
      receiveAsset: undefined,
      receiveAssetIssuer: undefined,
      slippageTolerance: 0.5
    });
    setWillCloseAccount(false);
    setHasActiveForm(true); // Show bundle actions
  };
  const addPayment = () => {
    // Reset form for new payment entry
    onPaymentDataChange({
      destination: '',
      amount: '',
      asset: paymentData.asset,
      // Keep same asset
      assetIssuer: paymentData.assetIssuer,
      memo: '',
      receiveAsset: undefined,
      receiveAssetIssuer: undefined,
      slippageTolerance: 0.5
    });
    setWillCloseAccount(false);
    setHasActiveForm(false); // Show form with bundle/cancel buttons
  };
  const editCompactPayment = (payment: CompactPayment) => {
    // Load compact payment into form for editing, but keep it in the bundle
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

    setEditingPaymentId(payment.id);
    setHasActiveForm(false);
    setWillCloseAccount(!!payment.isAccountClosure);

    // Do not remove from compact payments to avoid accidental deletion
    onClearTransaction?.(); // Any previously built tx is stale when entering edit mode
  };
  const removeCompactPayment = (id: string) => {
    setCompactPayments(compactPayments.filter(p => p.id !== id));
    
    // Clear any built transaction since it's no longer valid
    onClearTransaction?.();
  };

  const handleSaveEdit = async () => {
    if (!editingPaymentId) return;
    if (!isFormValid()) return;

    const updatedFiat = await calculateFiatValue(paymentData.amount, paymentData.asset);
    const isAccountClosure = willCloseAccount || checkAccountClosure(paymentData.amount, paymentData.asset);

    setCompactPayments(prev => prev.map(p => p.id === editingPaymentId ? {
      ...p,
      destination: paymentData.destination,
      amount: paymentData.amount,
      asset: paymentData.asset,
      assetIssuer: paymentData.assetIssuer,
      receiveAsset: paymentData.receiveAsset,
      receiveAssetIssuer: paymentData.receiveAssetIssuer,
      memo: paymentData.memo,
      slippageTolerance: paymentData.slippageTolerance,
      fiatValue: updatedFiat,
      isAccountClosure
    } : p));

    setEditingPaymentId(null);
    setHasActiveForm(true);

    // Reset current form
    onPaymentDataChange({
      destination: '',
      amount: '',
      asset: paymentData.asset,
      assetIssuer: paymentData.assetIssuer,
      memo: '',
      receiveAsset: undefined,
      receiveAssetIssuer: undefined,
      slippageTolerance: 0.5
    });
    setWillCloseAccount(false);
    onClearTransaction?.();
    onResetTransactionBuilt?.();
  };

  const cancelCurrentPayment = () => {
    // If editing, exit edit mode and keep the bundle unchanged
    if (editingPaymentId) {
      setEditingPaymentId(null);
      setHasActiveForm(true);
      onPaymentDataChange({
        destination: '',
        amount: '',
        asset: paymentData.asset,
        assetIssuer: paymentData.assetIssuer,
        memo: '',
        receiveAsset: undefined,
        receiveAssetIssuer: undefined,
        slippageTolerance: 0.5
      });
      setWillCloseAccount(false);
      onResetTransactionBuilt?.();
      return;
    }

    // Clear current form and go to appropriate state
    onPaymentDataChange({
      destination: '',
      amount: '',
      asset: paymentData.asset,
      assetIssuer: paymentData.assetIssuer,
      memo: '',
      receiveAsset: undefined,
      receiveAssetIssuer: undefined,
      slippageTolerance: 0.5
    });
    setWillCloseAccount(false);
    setHasActiveForm(compactPayments.length > 0);
  };
  const isFormValid = () => {
    // Prevent same source and destination addresses
    if (paymentData.destination === accountPublicKey) {
      return false;
    }
    // New destination accounts can ONLY receive XLM (no cross-asset)
    if (recipientExists === false) {
      if (paymentData.asset !== 'XLM') return false;
      if (paymentData.receiveAsset && paymentData.receiveAsset !== 'XLM') return false;
    }
    if (willCloseAccount) {
      return paymentData.destination && paymentData.destination !== accountPublicKey && canCloseAccount();
    }
    return paymentData.destination && paymentData.amount && paymentData.asset && (paymentData.asset === 'XLM' || paymentData.assetIssuer) && (!trustlineError || trustlineError.includes('will create a new'));
  };
  const handleBuild = () => {

    if (compactPayments.length > 0 && hasActiveForm) {
      // Build batch transaction with compact payments
      // If current form is a merge operation, add it to the batch
      if (willCloseAccount) {
        const mergePayment = {
          id: 'current-merge',
          destination: paymentData.destination,
          amount: paymentData.amount,
          asset: paymentData.asset,
          assetIssuer: paymentData.assetIssuer,
          receiveAsset: paymentData.receiveAsset,
          receiveAssetIssuer: paymentData.receiveAssetIssuer,
          memo: paymentData.memo,
          slippageTolerance: paymentData.slippageTolerance,
          fiatValue: fiatValue,
          isAccountClosure: true
        };
        const allPayments = [...compactPayments, mergePayment];
        onBuild(undefined, false, allPayments);
      } else {
        // Build batch transaction with only compact payments
        onBuild(undefined, false, compactPayments);
      }
    } else if (willCloseAccount) {
      // Single merge operation
      const mergeData = {
        ...paymentData,
        destination: paymentData.destination || accountPublicKey
      };
      onBuild(mergeData, true);
    } else if (compactPayments.length > 0 && !hasActiveForm) {
      // Build batch transaction with compact payments + current payment
      const currentPaymentIsAccountClosure = checkAccountClosure(paymentData.amount, paymentData.asset);
      
      const allPayments = [...compactPayments, {
        id: 'current',
        destination: paymentData.destination,
        amount: paymentData.amount,
        asset: paymentData.asset,
        assetIssuer: paymentData.assetIssuer,
        receiveAsset: paymentData.receiveAsset,
        receiveAssetIssuer: paymentData.receiveAssetIssuer,
        memo: paymentData.memo,
        slippageTolerance: paymentData.slippageTolerance,
        fiatValue: fiatValue,
        isAccountClosure: currentPaymentIsAccountClosure
      }];
      
      // Build all payments as a batch transaction (including any account closures)
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
    const sliderValue = maxAmount > 0 ? Math.round(value / maxAmount * sliderMax) : 0;
    const percentage = sliderMax > 0 ? sliderValue / sliderMax * 100 : 0;
    const availableBalance = getAvailableBalance(paymentData.asset);
    const isOverLimit = value > availableBalance;
    const availablePercentage = maxAmount > 0 ? Math.min(100, availableBalance / maxAmount * 100) : 0;
    const handleEditSubmit = () => {
      // CRITICAL: Validate amount before processing
      if (!isValidAmount(editValue)) {
        toast({
          title: "Invalid Amount",
          description: "Please enter a valid amount",
          variant: "destructive",
        });
        setEditValue(paymentData.amount);
        setIsEditing(false);
        return;
      }
      
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
    }, [isEditing]);
    useEffect(() => {
      const endDrag = () => {
        isDraggingRef.current = false;
      };
      window.addEventListener('mouseup', endDrag);
      window.addEventListener('touchend', endDrag);
      return () => {
        window.removeEventListener('mouseup', endDrag);
        window.removeEventListener('touchend', endDrag);
      };
    }, []);
    return <div className="space-y-3">
        {/* Centered amount display */}
        <div className="text-center">
          {isEditing ? <Input type="text" inputMode="decimal" value={editValue} onChange={e => {
          let sanitized = e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
          const parts = sanitized.split('.');
          if (parts.length > 2) sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
          if (parts[1] && parts[1].length > 7) sanitized = `${parts[0]}.${parts[1].substring(0, 7)}`;
          setEditValue(sanitized);
        }} onBlur={handleEditSubmit} onKeyDown={handleEditKeyDown} onFocus={e => e.currentTarget.select()} className="h-10 w-48 text-2xl font-amount text-center px-3 py-2 bg-background/95 border border-border/60 focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-border rounded-md mx-auto" placeholder="0.0000000" autoFocus /> : <div className="cursor-pointer rounded px-3 py-2 mx-auto w-fit" onClick={() => setIsEditing(true)}>
              <div className={`text-3xl font-amount font-semibold ${willCloseAccount ? 'text-destructive' : 'text-foreground'}`}>
                {formatDisplayAmount(value.toString())}
              </div>
              
            </div>}
        </div>

        {/* Slider */}
        <div className="relative self-center px-2">
          <Slider
            value={[sliderValue]}
            onValueChange={(values) => {
              const v = values[0] || 0;
              const newAmount = maxAmount > 0 ? v / sliderMax * maxAmount : 0;
              isDraggingRef.current = true;
              handleAmountChange(newAmount.toFixed(7));
            }}
            onPointerDown={() => {
              isDraggingRef.current = true;
            }}
            max={sliderMax}
            step={1}
            className={`stellar-slider w-full ${willCloseAccount ? 'slider-merge' : isOverLimit && canCloseAccount() ? 'slider-merge-warning' : isOverLimit ? 'slider-warning' : ''}`}
            style={{
              '--slider-progress': `${percentage}%`,
              '--available-progress': `${availablePercentage}%`
            } as React.CSSProperties}
          />
        </div>
        {/* Meta row: only fiat value */}
        {fiatValue && <div className="text-right text-xs text-muted-foreground px-2">
            <span className="font-amount font-medium text-primary">≈ {fiatValue}</span>
          </div>}
      </div>;
  };
  return (
    <div className="space-y-6">


      {/* Compact Transactions List */}
      {compactPayments.length > 0 && <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">List of Operations</h3>
            <Badge variant="secondary" className="text-xs">
              {compactPayments.length} operation{compactPayments.length > 1 ? 's' : ''}
            </Badge>
          </div>
          
          {compactPayments.map((payment, index) => {
        // Check if this payment will close the account using the stored flag
        const closesAccount = payment.isAccountClosure || false;
        return <Card key={payment.id} className={`p-4 md:p-6 rounded-2xl border border-border/60 ${closesAccount ? 'bg-destructive/5 border-destructive/30' : 'bg-card/60'} hover:bg-card transition-colors shadow-sm`}>
                {/* Mobile-first responsive layout */}
                <div className="space-y-4">
                  {/* Header with operation number, fiat value, and actions - all in one row */}
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">
                      <span className="sm:hidden">Op #{index + 1}</span>
                      <span className="hidden sm:inline">Operation #{index + 1}</span>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {compactPaymentFiatValues[payment.id] && (
                        <span className="text-sm font-semibold text-primary font-amount">≈ {compactPaymentFiatValues[payment.id]}</span>
                      )}
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => editCompactPayment(payment)} 
                          className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
                          title="Edit operation"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => removeCompactPayment(payment.id)} 
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                          title="Remove operation"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Account Closure warning on its own row when present */}
                  {closesAccount && (
                    <div className="col-span-full mt-2">
                      <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                          <p className="text-destructive font-semibold text-sm">Account Closure: This transaction will close your source account and send all remaining funds to the destination. This action cannot be undone.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Asset transfer visualization - single row compact layout */}
                  <div className="bg-background/50 rounded-lg p-2 w-fit mx-auto">
                    {/* Desktop: horizontal layout */}
                    <div className="hidden sm:flex items-center justify-center gap-2 text-xs">
                      {/* From: Logo Currency Amount */}
                      <AssetIcon assetCode={payment.asset} assetIssuer={payment.assetIssuer} size={32} />
                      <a 
                        href={getAssetExplorerUrl(payment.asset, payment.assetIssuer)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground font-medium hover:text-primary transition-colors inline-flex items-center gap-1"
                      >
                        {payment.asset}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <span className="font-semibold font-amount">{formatDisplayAmount(payment.amount)}</span>
                      
                      {/* Arrow */}
                      <ArrowRight className="w-4 h-4 text-muted-foreground mx-1" />
                      
                      {/* To: Logo Currency [Value if path payment] */}
                      <AssetIcon assetCode={payment.receiveAsset || payment.asset} assetIssuer={payment.receiveAssetIssuer || payment.assetIssuer} size={32} />
                      <a 
                        href={getAssetExplorerUrl(payment.receiveAsset || payment.asset, payment.receiveAssetIssuer || payment.assetIssuer)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground font-medium hover:text-primary transition-colors inline-flex items-center gap-1"
                      >
                        {payment.receiveAsset || payment.asset}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {payment.receiveAsset && payment.receiveAsset !== payment.asset && (
                        <span className="text-white font-semibold font-amount">
                          &gt; {calculatePathPaymentReceiveAmount(payment.amount, payment.asset, payment.receiveAsset)}
                        </span>
                      )}
                    </div>
                    
                    {/* Mobile: vertical layout */}
                    <div className="sm:hidden flex flex-col items-center gap-3 text-xs">
                      {/* From: Logo Currency Amount */}
                      <div className="flex items-center gap-2 w-full justify-between">
                        <div className="flex items-center gap-2">
                          <AssetIcon assetCode={payment.asset} assetIssuer={payment.assetIssuer} size={32} />
                          <a 
                            href={getAssetExplorerUrl(payment.asset, payment.assetIssuer)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground font-medium hover:text-primary transition-colors inline-flex items-center gap-1"
                          >
                            {payment.asset}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <span className="font-semibold font-amount">{formatDisplayAmount(payment.amount)}</span>
                      </div>
                      
                      {/* Arrow down */}
                      <ArrowDown className="w-4 h-4 text-muted-foreground" />
                      
                      {/* To: Logo Currency [Value if path payment] */}
                      <div className="flex items-center gap-2 w-full justify-between">
                        <div className="flex items-center gap-2">
                          <AssetIcon assetCode={payment.receiveAsset || payment.asset} assetIssuer={payment.receiveAssetIssuer || payment.assetIssuer} size={32} />
                          <a 
                            href={getAssetExplorerUrl(payment.receiveAsset || payment.asset, payment.receiveAssetIssuer || payment.assetIssuer)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground font-medium hover:text-primary transition-colors inline-flex items-center gap-1"
                          >
                            {payment.receiveAsset || payment.asset}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {payment.receiveAsset && payment.receiveAsset !== payment.asset && (
                          <span className="text-white font-semibold font-amount">
                            &gt; {calculatePathPaymentReceiveAmount(payment.amount, payment.asset, payment.receiveAsset)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                    
                  {/* Destination info - better mobile formatting */}
                  <div className="space-y-2">
                    <div className="text-xs">
                      <span className="text-muted-foreground font-medium">Destination:</span>
                      <div className="font-address text-foreground mt-1 break-all">
                        <span className="sm:hidden">{payment.destination.slice(0, 20)}...{payment.destination.slice(-8)}</span>
                        <span className="hidden sm:inline">{payment.destination}</span>
                      </div>
                    </div>
                    {payment.memo && (
                      <div className="text-xs">
                        <span className="text-muted-foreground font-medium">Memo:</span>
                        <div className="font-address text-foreground mt-1 break-words">{payment.memo}</div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>;
      })}
        </div>}

      {/* Current Payment Form */}
      {(!isTransactionBuilt || editingPaymentId) && (
        <div className="space-y-4">
          {/* Only show header when we have an active form (not in bundle mode) */}
          {!hasActiveForm && <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                Operation #{editingPaymentId ? compactPayments.findIndex(p => p.id === editingPaymentId) + 1 : compactPayments.length + 1}
              </h3>
            </div>}

        {!hasActiveForm && <>
        {/* Same source and destination warning */}
        {paymentData.destination === accountPublicKey && <Alert variant="destructive" className="border-destructive/50 bg-destructive/5">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-destructive">
              Source and destination addresses cannot be the same.
            </AlertDescription>
          </Alert>}

        {/* Destination */}
        <div className="space-y-2">
          <Label htmlFor="destination" className="text-sm font-medium">
            {willCloseAccount ? 'Send All Funds To' : 'Destination Address or Domain'}
          </Label>
          <div className="relative">
            <AddressAutocomplete
              value={paymentData.destination} 
              onChange={handleDestinationChange}
              accountPublicKey={accountPublicKey}
              network={network}
              onQRScan={() => setShowQRScanner(true)}
              onFocus={() => {
                if (domainSuggestions.length > 0) {
                  setShowSuggestions(true);
                }
              }}
              onBlur={() => {
                // Delay hiding suggestions to allow clicking
                setTimeout(() => setShowSuggestions(false), 150);
              }}
              className={`text-xs font-address bg-background focus:border-primary ${
                paymentData.destination && !isValidDestination(paymentData.destination)
                  ? 'border-destructive' 
                  : 'border-border/60'
              }`}
            />
            
            {/* Domain Suggestions Dropdown */}
            {showSuggestions && domainSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 bg-card border border-border rounded-lg shadow-lg mt-1">
                {domainSuggestions.map((suggestion, index) => (
                  <div 
                    key={index}
                    className="p-3 hover:bg-secondary cursor-pointer border-b border-border/50 last:border-b-0"
                    onClick={() => selectDomainSuggestion(suggestion)}
                  >
                    <div className="text-sm font-medium text-primary">{suggestion.domain}</div>
                    <div className="text-xs text-muted-foreground font-address">
                      {suggestion.address.slice(0, 8)}...{suggestion.address.slice(-8)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {paymentData.destination && !isValidDestination(paymentData.destination) && (
            <p className="text-xs text-destructive">
              Please enter a valid Stellar address or domain name
            </p>
          )}
        </div>

        {/* Memo */}
        <div className="space-y-2">
          <Label htmlFor="memo" className="text-sm font-medium">Memo (Optional)</Label>
          <Input id="memo" placeholder="Payment description" className="font-address text-xs bg-background border-border/60 focus:border-primary" value={paymentData.memo} onChange={e => onPaymentDataChange({
            ...paymentData,
            memo: e.target.value
          })} />
        </div>

        {/* Payment Details Row */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Amount & Assets</Label>
          </div>
          
          <SwapInterface
            fromAsset={paymentData.asset}
            fromAssetIssuer={paymentData.assetIssuer}
            toAsset={paymentData.receiveAsset}
            toAssetIssuer={paymentData.receiveAssetIssuer}
            amount={paymentData.amount}
            availableAssets={recipientExists === false ? availableAssets.filter(a => a.code === "XLM") : availableAssets}
            recipientAssets={getReceiveOptions()}
            maxAmount={getMaxSliderValue(paymentData.asset)}
            reserveAmount={paymentData.asset === 'XLM' ? 1 : 0} // XLM minimum balance requirement
            previousOperations={compactPayments.map(p => ({ asset: p.asset, amount: p.amount, type: 'payment' }))}
            fiatValue={fiatValue}
            receiveAmount={paymentData.receiveAmount || (
              paymentData.receiveAsset && paymentData.receiveAsset !== paymentData.asset ? 
                calculatePathPaymentReceiveAmount(paymentData.amount, paymentData.asset, paymentData.receiveAsset) : 
                undefined
            )}
            slippageTolerance={paymentData.slippageTolerance}
            willCloseAccount={willCloseAccount}
            onAmountChange={handleAmountChange}
            onFromAssetChange={(asset, issuer) => {
              // Check if recipient has trustline for this asset
              const recipientHasAsset = recipientAssetOptions.some(a => 
                a.code === asset && 
                (asset === 'XLM' || a.issuer === issuer)
              );
              
              // Check if current receive asset is still valid for recipient
              const currentReceiveAssetValid = paymentData.receiveAsset ? 
                recipientAssetOptions.some(a => 
                  a.code === paymentData.receiveAsset && 
                  (paymentData.receiveAsset === 'XLM' || a.issuer === paymentData.receiveAssetIssuer)
                ) : true;
              
              onPaymentDataChange({
                ...paymentData,
                asset,
                assetIssuer: issuer || '',
                amount: '',
                // Auto-set receive asset only if recipient has trustline
                receiveAsset: recipientHasAsset ? asset : (currentReceiveAssetValid ? paymentData.receiveAsset : undefined),
                receiveAssetIssuer: recipientHasAsset ? (issuer || '') : (currentReceiveAssetValid ? paymentData.receiveAssetIssuer : undefined)
              });
              setWillCloseAccount(false);
            }}
            onToAssetChange={(asset, issuer) => {
              onPaymentDataChange({
                ...paymentData,
                receiveAsset: asset,
                receiveAssetIssuer: issuer
              });
            }}
            onSlippageToleranceChange={(t) => onPaymentDataChange({
              ...paymentData,
              slippageTolerance: t
            })}
            onReceiveAmountChange={(amount) => {
              // Handle manual receive amount input for swaps
              if (paymentData.receiveAsset && paymentData.receiveAsset !== paymentData.asset) {
                // This is a cross-asset swap, store the manual receive amount
                onPaymentDataChange({
                  ...paymentData,
                  receiveAmount: amount
                });
              }
            }}
            assetPrices={assetPrices}
            onFetchAssetPrice={onFetchAssetPrice}
          />

          {/* Merge Account Button */}
          {paymentData.asset === 'XLM' && canCloseAccount() && !willCloseAccount && (
            <div className="text-center">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleMergeAccount} 
                className="h-8 px-4 text-sm border-primary/30 hover:border-primary hover:bg-primary/10"
              >
                <Merge className="h-4 w-4 mr-2" />
                Merge Account
              </Button>
            </div>
          )}
        </div>




        {/* Destination Account Info */}
        {paymentData.destination && <DestinationAccountInfo destination={paymentData.destination} />}

        {/* Trustline Error */}
        {trustlineError && <div className={`p-3 rounded-lg border ${trustlineError.includes('will create a new') ? 'bg-muted/50 border-border' : 'bg-destructive/10 border-destructive/30'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${trustlineError.includes('will create a new') ? 'bg-muted' : 'bg-destructive/10'}`}>
                {trustlineError.includes('will create a new') ? <Info className="w-3 h-3 text-muted-foreground" /> : <AlertTriangle className="w-3 h-3 text-destructive" />}
              </div>
              <div className="flex-1">
                <p className={`text-xs font-medium ${trustlineError.includes('will create a new') ? 'text-foreground' : 'text-foreground'}`}>
                  {trustlineError}
                </p>
              </div>
            </div>
          </div>}
        </>}

        {/* Action Buttons */}
        <div className="flex gap-3 px-1">
            {/* Bundle Actions - Show when hasActiveForm is true (after bundling payments) */}
            {hasActiveForm && <>
                <Button 
                  onClick={addPayment} 
                  variant="outline" 
                  size="lg" 
                  className="flex-1 min-w-0 border-dashed border-primary hover:border-primary hover:bg-primary/5 text-primary hover:text-primary transition-colors hover:animate-[glow-pulse_1s_ease-in-out] active:animate-[glow-expand_0.3s_ease-out]"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  <span className="truncate">Add Operation</span>
                </Button>
                <Button 
                  onClick={handleBuild} 
                  disabled={isBuilding || compactPayments.length === 0} 
                  className="flex-1 min-w-0 bg-gradient-success hover:opacity-90 disabled:opacity-50 hover:animate-[glow-pulse-purple_1s_ease-in-out] active:animate-[glow-expand-purple_0.3s_ease-out]"
                  size="lg"
                >
                  {isBuilding ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      <span className="truncate">Building...</span>
                    </div>
                  ) : (
                    <span className="truncate">Build Transaction</span>
                  )}
                </Button>
              </>}

          {/* Form with Bundle/Cancel - Show when hasActiveForm is false and form has content */}
          {!hasActiveForm && (
            editingPaymentId ? (
              <>
                <Button 
                  onClick={handleSaveEdit} 
                  disabled={!isFormValid()} 
                  size="mobile"
                  className="flex-1 min-w-0 bg-gradient-primary hover:opacity-90 disabled:opacity-50"
                >
                  <span className="truncate">Save Changes</span>
                </Button>
                <Button 
                  onClick={cancelCurrentPayment} 
                  variant="destructive" 
                  className="flex-1 min-w-0" 
                  size="mobile"
                >
                  <span className="truncate">Cancel Edit</span>
                </Button>
              </>
            ) : (
              <>
               <Button 
                 onClick={handleBundlePayment} 
                 variant="outline" 
                 disabled={!isFormValid()} 
                 size="mobile"
                 className="flex-1 min-w-0 border-dashed border-primary hover:border-primary hover:bg-primary/5 text-primary hover:text-primary transition-colors disabled:opacity-50 disabled:border-border/60 disabled:text-muted-foreground hover:animate-[glow-pulse_1s_ease-in-out] active:animate-[glow-expand_0.3s_ease-out]"
               >
                 <Plus className="w-4 h-4 mr-2" />
                 <span className="truncate">Bundle</span>
               </Button>
               <Button 
                 onClick={cancelCurrentPayment} 
                 variant="destructive" 
                 className="flex-1 min-w-0" 
                 size="mobile"
               >
                 <span className="truncate">Cancel</span>
               </Button>
              </>
            )
          )}


        </div>
        </div>
      )}
      
      {/* QR Scanner */}
      <QRScanner
        isOpen={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={(data: string) => {
          // Handle QR code data - could be an address or deep link
          try {
            const url = new URL(data);
            const destination = url.searchParams.get('destination');
            if (destination) {
              onPaymentDataChange({
                ...paymentData,
                destination
              });
              return;
            }
          } catch {
            // Not a URL, assume it's a Stellar address
            onPaymentDataChange({
              ...paymentData,
              destination: data
            });
          }
        }}
      />
    </div>
  );
};