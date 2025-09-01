import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Send, FileCode, Shield, Share2, Check, ExternalLink, AlertTriangle } from 'lucide-react';
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
import { signTransaction, submitTransaction, submitToRefractor, pullFromRefractor, createHorizonServer } from '@/lib/stellar';
import { signWithWallet } from '@/lib/walletKit';
import { XdrDetails } from './XdrDetails';
import { SignerSelector } from './SignerSelector';
import { NetworkSelector } from './NetworkSelector';
import { RefractorIntegration } from './RefractorIntegration';
import { MultisigConfigBuilder } from './MultisigConfigBuilder';
import { SuccessModal } from './SuccessModal';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { getAssetPrice } from '@/lib/reflector';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { PaymentForm } from './payment/PaymentForm';
import { XdrProcessor } from './transaction/XdrProcessor';
import { TransactionSubmitter } from './transaction/TransactionSubmitter';


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
  onAccountRefresh?: () => Promise<void>;
}

export const TransactionBuilder = ({ onBack, accountPublicKey, accountData, initialTab = 'payment', onAccountRefresh }: TransactionBuilderProps) => {
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
  const [successData, setSuccessData] = useState<{ hash: string; network: 'mainnet' | 'testnet'; type: 'network' | 'refractor' } | null>(null);
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    // Reset tab-specific state when switching tabs to avoid stale data
    setPaymentData({ destination: '', amount: '', asset: 'XLM', assetIssuer: '', memo: '' });
    setTrustlineError('');
    setXdrData({ input: '', output: '' });
    setSignedBy([]);
    setRefractorId('');
    setSuccessData(null);
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
  const checkTrustline = async (destination: string, assetCode: string, assetIssuer: string) => {
    if (assetCode === 'XLM') return true;
    
    try {
      const server = createHorizonServer(currentNetwork);
      
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
      const server = createHorizonServer(currentNetwork);

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
      setSuccessData({ hash: result.hash, network: currentNetwork, type: 'network' });
      
      // Reset form
      setXdrData({ input: '', output: '' });
      setSignedBy([]);
      
      // If this was a multisig configuration change, refresh account data
      if (activeTab === 'multisig' && onAccountRefresh) {
        await onAccountRefresh();
      }
    } catch (error) {
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
      
      // Show success modal instead of just toast
      setSuccessData({ hash: id, network: currentNetwork, type: 'refractor' });
    } catch (error) {
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


  return (
    <div className="min-h-screen bg-background p-3 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Button 
            onClick={onBack}
            className="self-start bg-success hover:bg-success/90 text-success-foreground"
          >
            Back to Wallet
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold whitespace-nowrap">Transaction Builder</h1>
            <p className="text-muted-foreground text-sm">Create and prepare transactions for multisig</p>
          </div>
        </div>

        {/* Source Account Info */}
        <Card className="shadow-card">
          <CardContent className="pt-4 sm:pt-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="min-w-0 flex-1">
                <Label className="text-sm text-muted-foreground">Source Account</Label>
                <p className="font-mono text-xs sm:text-sm mt-1 break-all">{accountPublicKey}</p>
              </div>
              <Badge variant="outline" className="shrink-0">Connected</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Transaction Builder */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg whitespace-nowrap">Build Transaction</CardTitle>
            <CardDescription>
              Create a payment or import existing XDR for signing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="p-2 bg-muted/50 rounded-lg">
                <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full p-0 bg-transparent gap-2">
                  <TabsTrigger 
                    value="payment" 
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <Send className="w-4 h-4" />
                    <span>Payment</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="multisig"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <Shield className="w-4 h-4" />
                    <span>Multisig</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="xdr"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <FileCode className="w-4 h-4" />
                    <span>XDR</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="refractor"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Refractor</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="payment" className="space-y-4 mt-6">
                <PaymentForm
                  paymentData={paymentData}
                  onPaymentDataChange={(data) => {
                    setPaymentData(data);
                    if (data.asset !== paymentData.asset) {
                      setTrustlineError(''); // Clear error when changing asset
                    }
                  }}
                  availableAssets={getAvailableAssets()}
                  assetPrices={assetPrices}
                  trustlineError={trustlineError}
                  onBuild={handlePaymentBuild}
                  isBuilding={isBuilding}
                />
              </TabsContent>

              <TabsContent value="xdr" className="space-y-4 mt-6">
                <XdrProcessor
                  xdrInput={xdrData.input}
                  onXdrInputChange={(xdr) => setXdrData(prev => ({ ...prev, input: xdr }))}
                  onProcess={handleXdrProcess}
                  isProcessing={isBuilding}
                />
              </TabsContent>

              <TabsContent value="multisig" className="space-y-4 mt-6">
                <MultisigConfigBuilder
                  accountPublicKey={accountPublicKey}
                  currentSigners={accountData.signers}
                  currentThresholds={accountData.thresholds}
                  currentNetwork={currentNetwork}
                  onXdrGenerated={(xdr) => setXdrData(prev => ({ ...prev, output: xdr }))}
                  onAccountRefresh={onAccountRefresh}
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


        {/* Transaction Success Modal */}
        {successData && (
          <SuccessModal
            type={successData.type}
            hash={successData.type === 'network' ? successData.hash : undefined}
            refractorId={successData.type === 'refractor' ? successData.hash : undefined}
            network={successData.network}
            onClose={() => setSuccessData(null)}
          />
        )}

      </div>
    </div>
  );
};