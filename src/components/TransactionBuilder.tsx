import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { updateUrlParams } from '@/lib/urlState';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, FileCode, ArrowLeftRight, Landmark, Blocks, Coins } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { pullFromRefractor, createHorizonServer, type AccountData } from '@/lib/stellar';
import { parseTransactionPayload } from '@/lib/sep7';
import { tryParseTransaction } from '@/lib/xdr/parse';
import { XdrDetails } from './XdrDetails';
import { TransactionSigningPanel } from './transaction/TransactionSigningPanel';
import { getAssetPrice } from '@/lib/reflector';
import { useNetwork } from '@/contexts/NetworkContext';
import { PaymentForm, type PaymentDraft, type PaymentOperation, type TransactionMemo } from './payment/PaymentForm';
import { buildPaymentTransaction } from '@/lib/payments';
import { priceKey } from '@/lib/balance-utils';
import { useRefreshOnNewTransaction } from '@/hooks/useRefreshOnNewTransaction';
import { ImportTab } from './ImportTab';
import { SourceAccountSelector } from './SourceAccountSelector';
import { SoroswapTab } from './soroswap/SoroswapTab';
import { DeFindexTab } from './defindex/DeFindexTab';
import { ContractCallTab } from './contract/ContractCallTab';


const EMPTY_PAYMENT: PaymentDraft = { destination: '', amount: '', asset: 'XLM', assetIssuer: '', slippageTolerance: 0.5 };

interface TransactionBuilderProps {
  onBack: () => void;
  accountPublicKey: string; // Source account for transactions (editable)
  signerPublicKey?: string; // Connected wallet's public key (signer)
  accountData: AccountData | null;
  initialTab?: string;
  onAccountRefresh?: () => Promise<void>;
  onSourceAccountChange?: (newSourceAccount: string) => void;
}

export const TransactionBuilder = ({ onBack, accountPublicKey, signerPublicKey, accountData, initialTab = 'payment', onAccountRefresh, onSourceAccountChange }: TransactionBuilderProps) => {
  const { toast } = useToast();
  const { network: currentNetwork } = useNetwork();
  const [activeTab, setActiveTab] = useState(initialTab);
  // Reflect the active tab in the URL so the current section can be refreshed or shared
  useEffect(() => {
    updateUrlParams({ tab: activeTab });
  }, [activeTab]);
  const [defiTab, setDefiTab] = useState<string>('soroswap');
  const [paymentData, setPaymentData] = useState<PaymentDraft>(EMPTY_PAYMENT);
  // `input` is what the Import tab shows (pasted/scanned/pulled); `output` is the envelope the
  // builder produced or a signer extended. The one being worked on is `output || input`.
  const [xdrData, setXdrData] = useState({
    input: '',
    output: '',
  });
  const [xdrInputError, setXdrInputError] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [isTransactionBuilt, setIsTransactionBuilt] = useState(false);
  const [refractorId, setRefractorId] = useState<string>('');
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});
  // Bumped after a successful submission so the forms start over empty.
  const [formKey, setFormKey] = useState(0);
  const currentXdr = xdrData.output || xdrData.input;
  useRefreshOnNewTransaction(currentXdr, currentNetwork, onAccountRefresh);

  useEffect(() => {
    // Reset tab-specific state when switching tabs to avoid stale data
    setRefractorId('');
    setIsTransactionBuilt(false);

    if (activeTab === 'import') {
      // Switching to Import view: clear payment-only state; only an imported XDR carries over
      setPaymentData(EMPTY_PAYMENT);
      setXdrData(prev => ({ input: prev.input, output: '' }));
    } else {
      // For payment, soroswap, defindex tabs — clear XDR state
      setXdrData({ input: '', output: '' });
      setXdrInputError('');
    }
  }, [activeTab]);

  // A new transaction was pasted, scanned or linked: it replaces whatever was being signed.
  const handleXdrInputChange = useCallback((text: string) => {
    const payload = parseTransactionPayload(text);
    const xdr = payload?.xdr ?? text.trim();
    setXdrData({ input: xdr, output: '' });
    if (!xdr) {
      setXdrInputError('');
    } else if (payload?.network && payload.network !== currentNetwork) {
      setXdrInputError(
        `This transaction is for ${payload.network === 'testnet' ? 'Testnet' : 'Mainnet'}. Switch networks (disconnect and connect on the right network) before signing it.`,
      );
    } else if (!tryParseTransaction(xdr, currentNetwork)) {
      setXdrInputError('This is not a valid Stellar transaction XDR.');
    } else {
      setXdrInputError('');
    }
  }, [currentNetwork]);

  useEffect(() => {
    const deepLinkXdr = sessionStorage.getItem('deeplink-xdr');
    const deepLinkRefractorId = sessionStorage.getItem('deeplink-refractor-id');
    
    if (deepLinkXdr) {
      // Use the same processing as Import tab
      handleXdrInputChange(deepLinkXdr);
      setActiveTab('import');
      if (deepLinkRefractorId) setRefractorId(deepLinkRefractorId);
      // Clear the deep link data to prevent reprocessing
      sessionStorage.removeItem('deeplink-xdr');
      sessionStorage.removeItem('deeplink-refractor-id');
      sessionStorage.removeItem('deeplink-source-account');
      toast({ title: 'Transaction Loaded', description: 'XDR loaded for review and signing.', duration: 3000 });
    }
  }, [handleXdrInputChange, toast]);

  // Also handle deep link events when already on the builder
  useEffect(() => {
    const handleDeepLinkEvent = () => {
      const deepLinkXdr = sessionStorage.getItem('deeplink-xdr');
      const deepLinkRefractorId = sessionStorage.getItem('deeplink-refractor-id');
      if (deepLinkXdr) {
        handleXdrInputChange(deepLinkXdr);
        setActiveTab('import');
        if (deepLinkRefractorId) setRefractorId(deepLinkRefractorId);
        sessionStorage.removeItem('deeplink-xdr');
        sessionStorage.removeItem('deeplink-refractor-id');
        sessionStorage.removeItem('deeplink-source-account');
        toast({ title: 'Transaction Loaded', description: 'XDR loaded for review and signing.', duration: 3000 });
      }
    };
    // Custom event for deep link handling
    window.addEventListener('deeplink:xdr-loaded', handleDeepLinkEvent as EventListener);
    return () => window.removeEventListener('deeplink:xdr-loaded', handleDeepLinkEvent as EventListener);
  }, [handleXdrInputChange, toast]);


  // Function to fetch additional asset prices with timeout
  // Reflector prices mainnet assets only: testnet balances have no market value.
  const fetchAdditionalAssetPrice = useCallback(async (assetCode: string, assetIssuer?: string) => {
    if (currentNetwork !== 'mainnet') return 0;
    const key = priceKey(assetCode, assetIssuer);
    try {
      const pricePromise = getAssetPrice(assetCode === 'XLM' ? undefined : assetCode, assetIssuer);
      const price = await Promise.race([
        pricePromise,
        new Promise<number>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 2000)
        )
      ]);
      
      setAssetPrices(prev => ({
        ...prev,
        [key]: price
      }));
      return price;
    } catch (error) {
      setAssetPrices(prev => ({
        ...prev,
        [key]: 0
      }));
      return 0;
    }
  }, [currentNetwork]);

  // Memoize account balances to prevent unnecessary re-renders
  const memoizedBalances = useMemo(() => accountData?.balances || [], [accountData?.balances]);

  useEffect(() => {
    // Load asset prices for fiat conversion in parallel for better performance
    if (!memoizedBalances.length || currentNetwork !== 'mainnet') {
      setAssetPrices({});
      return;
    }
    
    const loadPrices = async () => {
      const pricePromises = memoizedBalances.map(async (balance) => {
        const key = priceKey(balance.asset_code, balance.asset_issuer);
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
  }, [memoizedBalances, currentNetwork]);
  // Bumped whenever the transaction is cleared (the form was edited): a build that started
  // before that must not come back and load a transaction the form no longer shows.
  const buildEpoch = useRef(0);

  const handlePaymentBuild = async (operations: PaymentOperation[], memo: TransactionMemo) => {
    const epoch = buildEpoch.current;
    setIsBuilding(true);
    try {
      const xdr = await buildPaymentTransaction(createHorizonServer(currentNetwork), accountPublicKey, currentNetwork, operations, memo);
      if (epoch !== buildEpoch.current) return;
      setXdrData(prev => ({ ...prev, output: xdr }));
      setIsTransactionBuilt(true);
      toast({
        title: "Transaction built successfully",
        description: `${operations.length} operation${operations.length > 1 ? 's' : ''} ready for signing`,
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

  const handleSdkBuild = (xdr: string) => {
    setXdrData(prev => ({ ...prev, output: xdr }));
    setIsTransactionBuilt(true);
    toast({
      title: 'Transaction built',
      description: 'Review the transaction details below and sign when ready.',
      duration: 3000,
    });
  };

  const handlePullFromRefractor = async (id: string) => {
    try {
      const { xdr, network } = await pullFromRefractor(id);
      if (network !== currentNetwork) {
        throw new Error(
          `This transaction is for ${network === 'testnet' ? 'Testnet' : 'Mainnet'}. Open its share link (${window.location.origin}?r=${id}) to sign it on the right network.`,
        );
      }
      setXdrData({ input: xdr, output: '' });
      setXdrInputError('');
      setRefractorId(id);
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

  const clearTransaction = () => {
    buildEpoch.current += 1;
    setXdrData({ input: '', output: '' });
    setXdrInputError('');
    setRefractorId('');
    setIsTransactionBuilt(false);
  };

  const handleSubmitted = async () => {
    clearTransaction();
    setFormKey(key => key + 1);
    await onAccountRefresh?.();
  };

  // Get available assets from account balances with prices and balances
  // Every asset the source holds. Assets are told apart by code AND issuer: anyone can issue a
  // token called "USDC", so two trustlines with the same code are two different assets.
  const getAvailableAssets = () => {
    if (!accountData?.balances) return [];
    return accountData.balances.flatMap((balance) => {
      if (balance.asset_type === 'native') {
        return [{ code: 'XLM', issuer: '', name: 'Stellar Lumens', balance: balance.balance, price: assetPrices[priceKey('XLM')] || 0 }];
      }
      if (!balance.asset_code || !balance.asset_issuer) return []; // liquidity pool shares
      return [{
        code: balance.asset_code,
        issuer: balance.asset_issuer,
        name: balance.asset_code,
        balance: balance.balance,
        price: assetPrices[priceKey(balance.asset_code, balance.asset_issuer)] || 0,
      }];
    });
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
            {accountPublicKey ? 'Back to Wallet' : 'Connect Wallet'}
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold whitespace-nowrap">Transaction Builder</h1>
            <p className="text-muted-foreground text-sm">Create and prepare transactions for multisig</p>
          </div>
        </div>

        {/* Source Account Selector - Editable */}
        {accountData && (
          <Card className="shadow-card">
            <CardContent className="pt-4 sm:pt-6">
              <SourceAccountSelector
                sourceAccount={accountPublicKey}
                connectedWalletKey={signerPublicKey || ''}
                onSourceAccountChange={(newAccount) => onSourceAccountChange?.(newAccount)}
                network={currentNetwork}
              />
            </CardContent>
          </Card>
        )}

        {/* Transaction Builder */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg whitespace-nowrap flex items-center gap-2">
              <FileCode className="w-4 h-4" />
              Build Transaction
            </CardTitle>
            <CardDescription>
              Send payments, call any Soroban contract, use DeFi protocols, or import a transaction to sign
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="p-2 bg-muted/50 rounded-lg">
                <TabsList className="grid grid-cols-4 w-full p-0 bg-transparent gap-2">
                  <TabsTrigger
                    value="payment"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <Send className="w-4 h-4" />
                    <span>Payment</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="contract"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <Blocks className="w-4 h-4" />
                    <span>Contract</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="defi"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <Coins className="w-4 h-4" />
                    <span>DeFi</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="import"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <FileCode className="w-4 h-4" />
                    <span>Import</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="payment" className="space-y-4 mt-6">
                {accountData && (
                  <PaymentForm
                    key={formKey}
                    paymentData={paymentData}
                    onPaymentDataChange={setPaymentData}
                    availableAssets={getAvailableAssets()}
                    assetPrices={assetPrices}
                    onFetchAssetPrice={fetchAdditionalAssetPrice}
                    onBuild={handlePaymentBuild}
                    isBuilding={isBuilding}
                    accountData={accountData}
                    accountPublicKey={accountPublicKey}
                    isTransactionBuilt={isTransactionBuilt}
                    onClearTransaction={clearTransaction}
                  />
                )}
              </TabsContent>

              <TabsContent value="contract" className="space-y-4 mt-6">
                <ContractCallTab
                  key={formKey}
                  accountPublicKey={accountPublicKey}
                  network={currentNetwork}
                  onBuild={handleSdkBuild}
                  isBuilding={isBuilding}
                  isTransactionBuilt={isTransactionBuilt}
                  onClearTransaction={clearTransaction}
                />
              </TabsContent>

              <TabsContent value="defi" className="space-y-4 mt-6">
                <Tabs
                  value={defiTab}
                  onValueChange={(tab) => {
                    // A transaction built in one protocol tab must not linger under the other.
                    clearTransaction();
                    setDefiTab(tab);
                  }}
                >
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="soroswap" className="flex items-center gap-2">
                      <ArrowLeftRight className="w-4 h-4" />
                      <span>Soroswap</span>
                    </TabsTrigger>
                    <TabsTrigger value="defindex" className="flex items-center gap-2">
                      <Landmark className="w-4 h-4" />
                      <span>DeFindex</span>
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="soroswap" className="space-y-4 mt-4">
                    <SoroswapTab
                      key={formKey}
                      accountPublicKey={accountPublicKey}
                      accountData={accountData}
                      network={currentNetwork}
                      onBuild={handleSdkBuild}
                      isBuilding={isBuilding}
                      isTransactionBuilt={isTransactionBuilt}
                      onClearTransaction={clearTransaction}
                    />
                  </TabsContent>
                  <TabsContent value="defindex" className="space-y-4 mt-4">
                    <DeFindexTab
                      key={formKey}
                      accountPublicKey={accountPublicKey}
                      accountData={accountData}
                      network={currentNetwork}
                      onBuild={handleSdkBuild}
                      isBuilding={isBuilding}
                      isTransactionBuilt={isTransactionBuilt}
                      onClearTransaction={clearTransaction}
                    />
                  </TabsContent>
                </Tabs>
              </TabsContent>

              <TabsContent value="import" className="space-y-4 mt-6">
                <ImportTab
                  xdrInput={xdrData.input}
                  xdrError={xdrInputError}
                  onXdrInputChange={handleXdrInputChange}
                  onPullTransaction={handlePullFromRefractor}
                  lastRefractorId={refractorId}
                  network={currentNetwork}
                />
              </TabsContent>

            </Tabs>
          </CardContent>
        </Card>


        {/* Transaction Verification */}
        {currentXdr && (
          <XdrDetails 
            xdr={currentXdr}
            networkType={currentNetwork}
            accountData={accountData}
          />
        )}

        {/* Signing, then submission or coordination */}
        <TransactionSigningPanel
          xdr={currentXdr && !xdrInputError ? currentXdr : ''}
          network={currentNetwork}
          account={accountData}
          onXdrChange={(signedXdr) => setXdrData(prev => ({ ...prev, output: signedXdr }))}
          onSubmitted={handleSubmitted}
          onRefractorSubmitted={setRefractorId}
          onDone={onBack}
        />

      </div>
    </div>
  );
};