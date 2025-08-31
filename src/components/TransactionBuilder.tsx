import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as SelectPrimitive from '@radix-ui/react-select';
import { AlertTriangle, Send, FileCode, ArrowLeft, Copy, Check, ExternalLink, Shield, TrendingUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  Transaction, 
  TransactionBuilder as StellarTransactionBuilder,
  Networks,
  Operation,
  Asset,
  Memo,
  Horizon
} from '@stellar/stellar-sdk';
import { signTransaction, horizonServer, submitTransaction, submitToRefractor, pullFromRefractor } from '@/lib/stellar';
import { signWithWallet } from '@/lib/walletKit';
import { XdrDetails } from './XdrDetails';
import { SignerSelector } from './SignerSelector';
import { NetworkSelector } from './NetworkSelector';
import { RefractorIntegration } from './RefractorIntegration';
import { MultisigConfigBuilder } from './MultisigConfigBuilder';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { getAssetPrice } from '@/lib/reflector';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import refractorFavicon from '@/assets/refractor-favicon.ico';

interface TransactionBuilderProps {
  onBack: () => void;
  accountPublicKey: string;
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
  initialTab?: string;
}

export const TransactionBuilder = ({ onBack, accountPublicKey, accountData, initialTab = 'payment' }: TransactionBuilderProps) => {
  const { toast } = useToast();
  const { quoteCurrency, availableCurrencies, getCurrentCurrency } = useFiatCurrency();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [paymentData, setPaymentData] = useState({
    destination: '',
    amount: '',
    asset: 'XLM',
    assetIssuer: '',
    memo: '',
  });
  const [trustlineError, setTrustlineError] = useState<string>('');
  const [xdrData, setXdrData] = useState({
    input: '',
    output: '',
  });
  const [isBuilding, setIsBuilding] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState<'mainnet' | 'testnet'>('mainnet');
  const [signedBy, setSignedBy] = useState<Array<{ signerKey: string; signedAt: Date }>>([]);
  const [refractorId, setRefractorId] = useState<string>('');
  const [successData, setSuccessData] = useState<{ hash: string; network: 'mainnet' | 'testnet' } | null>(null);
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});
  const [fiatValue, setFiatValue] = useState<string>('');

  useEffect(() => {
    // Reset tab-specific state when switching tabs to avoid stale data
    setPaymentData({ destination: '', amount: '', asset: 'XLM', assetIssuer: '', memo: '' });
    setTrustlineError('');
    setXdrData({ input: '', output: '' });
    setSignedBy([]);
    setRefractorId('');
    setSuccessData(null);
    setFiatValue('');
  }, [activeTab]);

  useEffect(() => {
    // Load asset prices for fiat conversion in parallel for better performance
    const loadPrices = async () => {
      const pricePromises = accountData.balances.map(async (balance) => {
        const key = balance.asset_code || 'XLM';
        try {
          const price = await getAssetPrice(balance.asset_code, balance.asset_issuer);
          return { key, price };
        } catch (error) {
          console.warn(`Failed to get price for ${key}:`, error);
          return { key, price: 0 };
        }
      });
      
      const results = await Promise.allSettled(pricePromises);
      const prices: Record<string, number> = {};
      
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          prices[result.value.key] = result.value.price;
        }
      });
      
      setAssetPrices(prices);
    };
    loadPrices();
  }, [accountData.balances]);

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
          console.warn('FX conversion failed, showing USD:', error);
          setFiatValue(`$${usdValue.toFixed(2)}`);
        }
      }
    };

    updateFiatValue();
  }, [paymentData.amount, paymentData.asset, quoteCurrency, assetPrices, getCurrentCurrency]);
  // Check trustline for non-XLM assets
  const checkTrustline = async (destination: string, assetCode: string, assetIssuer: string) => {
    if (assetCode === 'XLM') return true;
    
    try {
      const server = currentNetwork === 'testnet'
        ? new Horizon.Server('https://horizon-testnet.stellar.org')
        : new Horizon.Server('https://horizon.stellar.org');
      
      const account = await server.loadAccount(destination);
      const hasTrustline = account.balances.some(balance => 
        'asset_code' in balance && 
        balance.asset_code === assetCode && 
        balance.asset_issuer === assetIssuer
      );
      
      return hasTrustline;
    } catch (error) {
      // If we can't load the account, it might not exist
      throw new Error('Destination account does not exist');
    }
  };

  const handlePaymentBuild = async () => {
    if (!paymentData.destination || !paymentData.amount || !paymentData.asset) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    // Check for trustline if not XLM
    if (paymentData.asset !== 'XLM') {
      if (!paymentData.assetIssuer) {
        toast({
          title: "Missing asset issuer",
          description: "Asset issuer is required for non-XLM assets",
          variant: "destructive",
        });
        return;
      }

      setIsBuilding(true);
      try {
        const hasTrustline = await checkTrustline(paymentData.destination, paymentData.asset, paymentData.assetIssuer);
        if (!hasTrustline) {
          setTrustlineError('The destination account does not have a trustline for this asset');
          setIsBuilding(false);
          return;
        }
        setTrustlineError('');
      } catch (error) {
        setTrustlineError(error instanceof Error ? error.message : 'Failed to verify trustline');
        setIsBuilding(false);
        return;
      }
    } else {
      setTrustlineError('');
      setIsBuilding(true);
    }
    
    try {
      // Determine network and Horizon server
      const networkPassphrase = currentNetwork === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
      const server = currentNetwork === 'testnet'
        ? new Horizon.Server('https://horizon-testnet.stellar.org')
        : new Horizon.Server('https://horizon.stellar.org');

      // Load source account
      const sourceAccount = await server.loadAccount(accountPublicKey);
      
      // Create transaction builder
      const transaction = new StellarTransactionBuilder(sourceAccount, {
        fee: '100000', // 0.01 XLM
        networkPassphrase,
      });

      // Add payment operation
      const asset = paymentData.asset === 'XLM' 
        ? Asset.native() 
        : new Asset(paymentData.asset, paymentData.assetIssuer);
      
      transaction.addOperation(Operation.payment({
        destination: paymentData.destination,
        asset,
        amount: paymentData.amount,
      }));

      // Add memo if provided
      if (paymentData.memo) {
        transaction.addMemo(Memo.text(paymentData.memo));
      }

      // Set timeout
      transaction.setTimeout(86400);

      // Build the transaction
      const builtTransaction = transaction.build();
      const xdr = builtTransaction.toXDR();
      
      setXdrData(prev => ({ ...prev, output: xdr }));
      
      toast({
        title: "Transaction built successfully",
        description: "XDR is ready for signing",
        duration: 2000,
      });
    } catch (error) {
      console.error('Build error:', error);
      toast({
        title: "Build failed",
        description: error instanceof Error ? error.message : "Failed to build transaction",
        variant: "destructive",
      });
    } finally {
      setIsBuilding(false);
    }
  };

  const handleXdrProcess = async () => {
    if (!xdrData.input.trim()) {
      toast({
        title: "Missing XDR",
        description: "Please paste the XDR to process",
        variant: "destructive",
      });
      return;
    }

    setIsBuilding(true);
    
    try {
      // Validate XDR format by parsing it
      try {
        const networkPassphrase = currentNetwork === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
        new Transaction(xdrData.input, networkPassphrase);
      } catch (parseError) {
        throw new Error('Invalid XDR format');
      }
      
      toast({
        title: "XDR processed",
        description: "Transaction is ready for signing",
        duration: 2000,
      });
    } catch (error) {
      console.error('XDR processing error:', error);
      toast({
        title: "Processing failed",
        description: "Invalid XDR format",
        variant: "destructive",
      });
    } finally {
      setIsBuilding(false);
    }
  };

  const handleSignTransaction = async () => {
    const xdrToSign = xdrData.output || xdrData.input;
    if (!xdrToSign) {
      toast({
        title: "No transaction to sign",
        description: "Please build or input a transaction first",
        variant: "destructive",
      });
      return;
    }

    setIsSigning(true);
    
    try {
      const signedXdr = await signTransaction(xdrToSign);
      
      setXdrData(prev => ({ ...prev, output: signedXdr }));
      
      toast({
        title: "Transaction signed",
        description: "Transaction has been signed successfully",
        duration: 2000,
      });
    } catch (error) {
      console.error('Signing error:', error);
      toast({
        title: "Signing failed",
        description: error instanceof Error ? error.message : "Failed to sign transaction",
        variant: "destructive",
      });
    } finally {
      setIsSigning(false);
    }
  };

  const handleSignWithSigner = async (signerKey: string, walletId: string) => {
    const xdrToSign = xdrData.output || xdrData.input;
    if (!xdrToSign) return;

    setIsSigning(true);
    try {
      const { signedXdr, address, walletName } = await signWithWallet(xdrToSign, walletId, currentNetwork);

      if (address !== signerKey) {
        throw new Error(
          `Selected wallet (${walletName}) returned a different address. ` +
          `Expected ${signerKey.slice(0, 8)}... but got ${address.slice(0, 8)}... ` +
          `Please switch account in the wallet to match the signer and try again.`
        );
      }

      setXdrData(prev => ({ ...prev, output: signedXdr }));

      // Add to signed by list
      setSignedBy(prev => [...prev, { signerKey, signedAt: new Date() }]);

      toast({
        title: 'Transaction signed',
        description: `Signed with ${walletName}`,
        duration: 2000,
      });
    } catch (error) {
      console.error('Signing error:', error);
      toast({
        title: 'Signing failed',
        description: error instanceof Error ? error.message : 'Failed to sign transaction',
        variant: 'destructive',
      });
    } finally {
      setIsSigning(false);
    }
  };

  const handleSubmitToNetwork = async () => {
    const xdrToSubmit = xdrData.output;
    if (!xdrToSubmit) return;
    
    setIsSubmitting(true);
    try {
      const result = await submitTransaction(xdrToSubmit, currentNetwork);
      
      // Store success data for display
      setSuccessData({ hash: result.hash, network: currentNetwork });
      
      toast({
        title: "Transaction submitted successfully",
        description: `Transaction hash: ${result.hash}`,
        duration: 2000,
      });
      
      // Reset form
      setXdrData({ input: '', output: '' });
      setSignedBy([]);
    } catch (error) {
      console.error('Submission error:', error);
      toast({
        title: "Submission failed",
        description: error instanceof Error ? error.message : "Failed to submit transaction",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitToRefractor = async () => {
    const xdrToSubmit = xdrData.output || xdrData.input;
    if (!xdrToSubmit) return;
    
    setIsSubmitting(true);
    try {
      const id = await submitToRefractor(xdrToSubmit, currentNetwork);
      setRefractorId(id);
      
      toast({
        title: "Submitted to Refractor",
        description: `Transaction ID: ${id}`,
        duration: 2000,
      });
    } catch (error) {
      console.error('Refractor submission error:', error);
      toast({
        title: "Refractor submission failed",
        description: error instanceof Error ? error.message : "Failed to submit to Refractor",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePullFromRefractor = async (id: string) => {
    try {
      const xdr = await pullFromRefractor(id);
      setXdrData(prev => ({ ...prev, input: xdr, output: '' }));
      setSignedBy([]);
      
      toast({
        title: "Transaction pulled from Refractor",
        description: "XDR loaded successfully",
        duration: 2000,
      });
    } catch (error) {
      console.error('Refractor pull error:', error);
      toast({
        title: "Failed to pull from Refractor",
        description: error instanceof Error ? error.message : "Invalid Refractor ID or network error",
        variant: "destructive",
      });
    }
  };

  const getCurrentWeight = () => {
    return signedBy.reduce((total, signed) => {
      const signer = accountData.signers.find(s => s.key === signed.signerKey);
      return total + (signer?.weight || 0);
    }, 0);
  };

  const getRequiredWeight = () => {
    // For multisig config changes, we need high threshold
    const isMultisigTab = activeTab === 'multisig';
    const threshold = isMultisigTab 
      ? accountData.thresholds.high_threshold 
      : accountData.thresholds.med_threshold;
    // If threshold is 0, default to 1 signature required
    return threshold || 1;
  };

  const canSubmitToNetwork = getCurrentWeight() >= getRequiredWeight();
  const canSubmitToRefractor = Boolean(xdrData.output || xdrData.input);

  const copyXDR = async () => {
    const textToCopy = xdrData.output || xdrData.input;
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied to clipboard",
        description: "XDR has been copied",
        duration: 3000,
      });
    }
  };

  // Get available assets from account balances with prices and balances
  const getAvailableAssets = () => {
    // Deduplicate by asset code (choose the trustline with the largest balance for that code)
    const byCode = new Map<string, { code: string; issuer: string; name: string; balance: string; price: number }>();

    // Add XLM first
    const xlmBalance = accountData.balances.find((b) => b.asset_type === 'native')?.balance || '0';
    byCode.set('XLM', {
      code: 'XLM',
      issuer: '',
      name: 'Stellar Lumens',
      balance: xlmBalance,
      price: assetPrices['XLM'] || 0,
    });

    // Consider other assets; if multiple issuers share the same code, keep the one with the highest balance
    accountData.balances.forEach((balance) => {
      if (balance.asset_type !== 'native' && balance.asset_code && balance.asset_issuer) {
        const existing = byCode.get(balance.asset_code);
        if (!existing || parseFloat(balance.balance) > parseFloat(existing.balance)) {
          byCode.set(balance.asset_code, {
            code: balance.asset_code,
            issuer: balance.asset_issuer,
            name: balance.asset_code,
            balance: balance.balance,
            price: assetPrices[balance.asset_code] || 0,
          });
        }
      }
    });

    return Array.from(byCode.values());
  };

  const availableAssets = getAvailableAssets();

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
      setPaymentData(prev => ({ ...prev, amount: maxAmount }));
    }
  };

  // Check if form is valid for payment build
  const isPaymentFormValid = paymentData.destination && 
    paymentData.amount && 
    paymentData.asset &&
    (paymentData.asset === 'XLM' || paymentData.assetIssuer) &&
    !trustlineError;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Transaction Builder</h1>
            <p className="text-muted-foreground">Create and prepare transactions for multisig</p>
          </div>
        </div>

        {/* Source Account Info */}
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-muted-foreground">Source Account</Label>
                <p className="font-mono text-sm mt-1">{accountPublicKey}</p>
              </div>
              <Badge variant="outline">Connected</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Transaction Builder */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>Build Transaction</CardTitle>
            <CardDescription>
              Create a payment or import existing XDR for signing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="payment" className="flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  Payment
                </TabsTrigger>
                 <TabsTrigger value="multisig" className="flex items-center gap-2">
                   <Shield className="w-4 h-4" />
                   Multisig Configuration
                 </TabsTrigger>
                <TabsTrigger value="xdr" className="flex items-center gap-2">
                  <FileCode className="w-4 h-4" />
                  Generic XDR
                </TabsTrigger>
                <TabsTrigger value="refractor" className="flex items-center gap-2">
                  <img src={refractorFavicon} alt="Refractor" className="w-4 h-4" />
                  Refractor
                </TabsTrigger>
              </TabsList>

              <TabsContent value="payment" className="space-y-4 mt-6">

                <div className="grid grid-cols-1 gap-4">
                  <div className="flex gap-4 items-end">
                    <div className="flex-[2] space-y-2">
                      <Label htmlFor="destination">Destination Address</Label>
                      <Input
                        id="destination"
                        placeholder="GABC..."
                        maxLength={56}
                        value={paymentData.destination}
                        onChange={(e) => setPaymentData(prev => ({ ...prev, destination: e.target.value }))}
                      />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="amount">Amount</Label>
                        {fiatValue && (
                          <span className="text-xs text-muted-foreground">≈ {fiatValue}</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          id="amount"
                          type="text"
                          placeholder="0.00"
                          value={paymentData.amount ? parseFloat(paymentData.amount).toLocaleString('en-US', {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 7,
                            useGrouping: true
                          }) : ''}
                          onChange={(e) => {
                            // Remove commas and convert to number
                            const numericValue = e.target.value.replace(/,/g, '');
                            const maxAmount = getSelectedAssetInfo()?.code === 'XLM' 
                              ? Math.max(0, parseFloat(getSelectedAssetInfo()!.balance) - 0.5)
                              : parseFloat(getSelectedAssetInfo()?.balance || '0');
                            const inputValue = parseFloat(numericValue) || 0;
                            const cappedValue = Math.min(inputValue, maxAmount);
                            // Ensure Stellar precision (max 7 decimal places)
                            const stellarPreciseValue = parseFloat(cappedValue.toFixed(7));
                            setPaymentData(prev => ({ ...prev, amount: stellarPreciseValue.toString() }));
                          }}
                          className="flex-1 text-sm"
                        />
                        <Select
                          value={paymentData.asset}
                          onValueChange={(value) => {
                            const selectedAsset = availableAssets.find(asset => asset.code === value);
                            setPaymentData(prev => ({ 
                              ...prev, 
                              asset: value,
                              assetIssuer: selectedAsset?.issuer || '',
                              amount: '' // Reset amount when changing asset
                            }));
                            setTrustlineError(''); // Clear error when changing asset
                          }}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue>
                              <span className="font-medium text-sm">{paymentData.asset}</span>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="min-w-[300px] max-h-64 overflow-y-auto">
                            {/* Header */}
                            <div className="sticky top-0 z-10 grid grid-cols-[80px_1fr] items-center gap-3 px-6 py-2 text-[11px] text-muted-foreground bg-popover/95 backdrop-blur">
                              <span className="uppercase tracking-wider">Asset</span>
                              <span className="text-right uppercase tracking-wider">Balance</span>
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
                                  className="relative rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                                >
                                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                                    <SelectPrimitive.ItemIndicator>
                                      <Check className="h-4 w-4" />
                                    </SelectPrimitive.ItemIndicator>
                                  </span>
                                  <SelectPrimitive.ItemText>
                                    <div className="grid grid-cols-[80px_1fr] items-center gap-3">
                                      <span className="font-medium">{asset.code}</span>
                                      <span className="font-mono tabular-nums text-right text-xs text-muted-foreground">{formattedBalance}</span>
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
                          step="0.0000001"
                          value={paymentData.amount || '0'}
                          onChange={(e) => setPaymentData(prev => ({ ...prev, amount: e.target.value }))}
                          className="stellar-slider w-full"
                          style={{
                            '--slider-progress': `${((parseFloat(paymentData.amount) || 0) / parseFloat(getSelectedAssetInfo()!.code === 'XLM' 
                              ? Math.max(0, parseFloat(getSelectedAssetInfo()!.balance) - 0.5).toString()
                              : getSelectedAssetInfo()!.balance)) * 100}%`
                          } as React.CSSProperties}
                        />
                      </div>
                      <div className="flex justify-end text-xs text-muted-foreground">
                        <span>Available: {parseFloat(getSelectedAssetInfo()!.balance).toLocaleString('en-US', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 7,
                          useGrouping: true
                        })} {paymentData.asset}</span>
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
                    onChange={(e) => setPaymentData(prev => ({ ...prev, memo: e.target.value }))}
                  />
                </div>
                
                {/* Trustline Error */}
                {trustlineError && (
                  <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm text-foreground">{trustlineError}</p>
                      </div>
                    </div>
                  </div>
                )}
                
                <Button 
                  onClick={handlePaymentBuild} 
                  disabled={isBuilding || !isPaymentFormValid}
                  className="w-full bg-gradient-primary hover:opacity-90 disabled:opacity-50"
                >
                  {isBuilding ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      Building Transaction...
                    </div>
                  ) : (
                    'Build Payment Transaction'
                  )}
                </Button>
              </TabsContent>

              <TabsContent value="xdr" className="space-y-4 mt-6">
                <div className="space-y-2">
                  <Label htmlFor="xdr-input">Transaction XDR</Label>
                  <Textarea
                    id="xdr-input"
                    placeholder="Paste transaction XDR here..."
                    className="min-h-32 font-mono text-sm"
                    value={xdrData.input}
                    onChange={(e) => setXdrData(prev => ({ ...prev, input: e.target.value }))}
                  />
                </div>
                <Button 
                  onClick={handleXdrProcess} 
                  disabled={isBuilding}
                  className="w-full"
                  variant="outline"
                >
                  {isBuilding ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Processing XDR...
                    </div>
                  ) : (
                    'Process XDR'
                  )}
                </Button>
              </TabsContent>

              <TabsContent value="multisig" className="space-y-4 mt-6">
                <MultisigConfigBuilder
                  accountPublicKey={accountPublicKey}
                  currentSigners={accountData.signers}
                  currentThresholds={accountData.thresholds}
                  currentNetwork={currentNetwork}
                  onXdrGenerated={(xdr) => setXdrData(prev => ({ ...prev, output: xdr }))}
                />
              </TabsContent>

              <TabsContent value="refractor" className="space-y-4 mt-6">
                <RefractorIntegration
                  onPullTransaction={handlePullFromRefractor}
                  lastRefractorId={refractorId}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* XDR Details */}
        {(xdrData.output || xdrData.input) && (
          <XdrDetails 
            xdr={xdrData.output || xdrData.input} 
            network={currentNetwork}
          />
        )}

        {/* Signer Selector */}
        {(xdrData.output || xdrData.input) && (
          <SignerSelector
            xdr={xdrData.output || xdrData.input}
            network={currentNetwork}
            signers={accountData.signers}
            currentAccountKey={accountPublicKey}
            signedBy={signedBy}
            requiredWeight={getRequiredWeight()}
            onSignWithSigner={handleSignWithSigner}
            isSigning={isSigning}
          />
        )}

        {/* Network Selector & Submission */}
        {(xdrData.output || xdrData.input) && (
          <NetworkSelector
            currentNetwork={currentNetwork}
            onNetworkChange={setCurrentNetwork}
            onSubmitToNetwork={handleSubmitToNetwork}
            onSubmitToRefractor={handleSubmitToRefractor}
            canSubmitToNetwork={canSubmitToNetwork}
            canSubmitToRefractor={canSubmitToRefractor}
            isSubmitting={isSubmitting}
          />
        )}


        {/* Transaction Success */}
        {successData && (
          <Card className="shadow-card border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
            <CardHeader>
              <CardTitle className="text-green-700 dark:text-green-300 flex items-center gap-2">
                <Check className="w-5 h-5" />
                Transaction Submitted Successfully
              </CardTitle>
              <CardDescription>
                Your transaction has been successfully submitted to the Stellar network
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Transaction Hash</Label>
                <div className="bg-background p-3 rounded-lg">
                  <p className="font-mono text-sm break-all">{successData.hash}</p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => {
                    const baseUrl = successData.network === 'testnet' 
                      ? 'https://stellar.expert/explorer/testnet' 
                      : 'https://stellar.expert/explorer/public';
                    window.open(`${baseUrl}/tx/${successData.hash}`, '_blank');
                  }}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View on Stellar Expert
                </Button>
                
                <Button 
                  variant="secondary"
                  onClick={() => setSuccessData(null)}
                >
                  Create Another Transaction
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
};