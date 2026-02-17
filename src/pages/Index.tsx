import { useState, useEffect, Suspense, lazy, memo, useCallback, useMemo } from 'react';
import { LandingPage } from '@/components/LandingPage';
import { LoadingPill } from '@/components/ui/loading-pill';
import { Footer } from '@/components/Footer';
import { DeepLinkHandler } from '@/components/DeepLinkHandler';

// Lazy load heavy components to improve TTI
const AccountOverview = lazy(() => import('@/components/AccountOverview'));
const TransactionBuilder = lazy(() => import('@/components/TransactionBuilder').then(module => ({
  default: module.TransactionBuilder
})));
import { fetchAccountData } from '@/lib/stellar';
import { useToast } from '@/hooks/use-toast';
import { FiatCurrencyProvider } from '@/contexts/FiatCurrencyContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useWalletKit } from '@/contexts/WalletKitContext';
import { useRequestDeduplication } from '@/hooks/useRequestDeduplication';

interface AccountData {
  publicKey: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: Array<{
    key: string;
    weight: number;
    type: string;
  }>;
}

type AppState = 'connecting' | 'dashboard' | 'transaction' | 'multisig-config';

const Index = memo(() => {
  const { toast } = useToast();
  const { network, setNetwork } = useNetwork();
  const { disconnectWallet } = useWalletKit();
  const { dedupe } = useRequestDeduplication();
  
  const [appState, setAppState] = useState<AppState>('connecting');
  const [connectedWallet, setConnectedWallet] = useState<string>('');
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [publicKey, setPublicKey] = useState<string>(''); // Connected wallet's public key (signer)
  const [sourceAccount, setSourceAccount] = useState<string>(''); // Source account for transactions (editable)
  const [deepLinkReady, setDeepLinkReady] = useState(false);

  // Deep links are processed by DeepLinkHandler; we do not auto-switch app state here to ensure account loads first.


  // Optimized account data fetching with deduplication
  const handleDeepLinkLoaded = useCallback(async (xdrSourceAccount: string) => {
    // Load account data from the XDR's source account
    setSourceAccount(xdrSourceAccount);
    setPublicKey(xdrSourceAccount); // Set as initial signer if no wallet connected
    setLoading(true);
    
    try {
      // Use dedupe to prevent duplicate requests for same account
      const realAccountData = await dedupe(
        `account-${xdrSourceAccount}-${network}`,
        () => fetchAccountData(xdrSourceAccount, network)
      );
      setAccountData(realAccountData);
      setDeepLinkReady(true);
      setAppState('transaction');
      
      toast({
        title: 'Account Loaded',
        description: 'Ready to review and sign transaction',
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to load source account:', error);
      toast({
        title: 'Failed to load source account',
        description: error instanceof Error ? error.message : 'Could not load account data',
        variant: 'destructive',
      });
      setAppState('connecting');
    } finally {
      setLoading(false);
    }
  }, [network, dedupe, toast]);

  const handleWalletConnect = useCallback(async (walletType: string, walletPublicKey: string, selectedNetwork: 'mainnet' | 'testnet') => {
    setConnectedWallet(walletType);
    setPublicKey(walletPublicKey);
    setSourceAccount(walletPublicKey); // Default source account to connected wallet
    setNetwork(selectedNetwork);
    setLoading(true);
    
    // Scroll to top when transitioning from landing page
    window.scrollTo({ top: 0, behavior: 'instant' });
    
    // Immediately switch to appropriate state for better perceived performance
    const deepLinkXdr = sessionStorage.getItem('deeplink-xdr');
    if (deepLinkXdr) {
      // If there's a deep link, use its source account
      const deepLinkSourceAccount = sessionStorage.getItem('deeplink-source-account');
      if (deepLinkSourceAccount) {
        setSourceAccount(deepLinkSourceAccount);
      }
      setDeepLinkReady(true);
      setAppState('transaction');
    } else {
      setDeepLinkReady(false);
      setAppState('dashboard');
    }
    
    // Defer account data fetching to not block TTI
    setTimeout(async () => {
      try {
        // Fetch account data for the source account (may differ from connected wallet with deep links)
        const accountToFetch = sessionStorage.getItem('deeplink-source-account') || walletPublicKey;
        const realAccountData = await dedupe(
          `account-${accountToFetch}-${selectedNetwork}`,
          () => fetchAccountData(accountToFetch, selectedNetwork)
        );
        setAccountData(realAccountData);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load account:', error);
        toast({
          title: 'Failed to load account',
          description: error instanceof Error ? error.message : 'Could not load account data',
          variant: 'destructive',
        });
        
        // Fall back to connection screen
        setAppState('connecting');
        setLoading(false);
      }
    }, 100); // Small delay to allow UI transition first
  }, [setNetwork, dedupe, toast]);

  // Memoize frequently used callbacks
  const handleInitiateTransaction = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setAppState('transaction');
  }, []);

  const handleConfigureMultisig = useCallback(() => {
    setAppState('multisig-config');
  }, []);

  const handleBackToDashboard = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setDeepLinkReady(false);
    setAppState('dashboard');
  }, []);

  const handleDisconnect = useCallback(() => {
    disconnectWallet();
    sessionStorage.removeItem('deeplink-xdr');
    sessionStorage.removeItem('deeplink-refractor-id');
    sessionStorage.removeItem('deeplink-source-account');
    setConnectedWallet('');
    setPublicKey('');
    setSourceAccount('');
    setAccountData(null);
    setDeepLinkReady(false);
    setAppState('connecting');
  }, [disconnectWallet]);

  // Handler for when user changes the source account
  const handleSourceAccountChange = useCallback(async (newSourceAccount: string) => {
    if (!newSourceAccount || newSourceAccount === sourceAccount) return;
    
    setSourceAccount(newSourceAccount);
    setLoading(true);
    
    try {
      const realAccountData = await dedupe(
        `account-${newSourceAccount}-${network}`,
        () => fetchAccountData(newSourceAccount, network)
      );
      setAccountData(realAccountData);
      toast({
        title: 'Source Account Updated',
        description: 'Account data loaded for new source account',
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to load source account:', error);
      toast({
        title: 'Failed to load account',
        description: error instanceof Error ? error.message : 'Could not load account data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [sourceAccount, network, dedupe, toast]);

  // Memoized account refresh function - uses sourceAccount for transactions
  const handleAccountRefresh = useCallback(async () => {
    const accountToRefresh = sourceAccount || publicKey;
    if (!accountToRefresh) return;
    const realAccountData = await dedupe(
      `account-${accountToRefresh}-${network}`,
      () => fetchAccountData(accountToRefresh, network)
    );
    setAccountData(realAccountData);
  }, [sourceAccount, publicKey, network, dedupe]);

  return (
    <FiatCurrencyProvider>
      <DeepLinkHandler onDeepLinkLoaded={handleDeepLinkLoaded} />
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1">
          {/* Landing Page */}
          {appState === 'connecting' && (
            <LandingPage onConnect={handleWalletConnect} />
          )}

          {/* Transaction Builder */}
          {(appState === 'transaction' || appState === 'multisig-config') && (
            <Suspense fallback={
              <div className="min-h-screen flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                  <LoadingPill size="lg" glowColor="primary" />
                  <span className="text-muted-foreground">Loading transaction builder...</span>
                </div>
              </div>
            }>
              <TransactionBuilder
                key={`${appState}-${sourceAccount}`}
                onBack={handleBackToDashboard}
                accountPublicKey={sourceAccount || publicKey || ''}
                signerPublicKey={publicKey}
                accountData={accountData}
                initialTab={appState === 'multisig-config' ? 'multisig' : (deepLinkReady ? 'import' : 'payment')}
                onAccountRefresh={handleAccountRefresh}
                onSourceAccountChange={handleSourceAccountChange}
              />
            </Suspense>
          )}

          {/* Account Dashboard */}
          {appState === 'dashboard' && publicKey && accountData && (
            <Suspense fallback={
              <div className="min-h-screen flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                  <LoadingPill size="lg" glowColor="primary" />
                  <span className="text-muted-foreground">Loading dashboard...</span>
                </div>
              </div>
            }>
              <AccountOverview
                accountData={accountData}
                onInitiateTransaction={handleInitiateTransaction}
                onSignTransaction={() => {}}
                onRefreshBalances={handleAccountRefresh}
                onDisconnect={handleDisconnect}
              />
            </Suspense>
          )}

          {appState === 'dashboard' && publicKey && !accountData && (
            <div className="min-h-screen flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <LoadingPill size="lg" glowColor="primary" />
                <span className="text-muted-foreground">Loading dashboard...</span>
              </div>
            </div>
          )}
        </div>
        
        {/* Only show footer when not on connecting page */}
        {appState !== 'connecting' && <Footer />}
      </div>
    </FiatCurrencyProvider>
  );
});

export default Index;
