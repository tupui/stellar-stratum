import { useState, useEffect, Suspense, lazy, memo, useCallback, useMemo } from 'react';
import { LandingPage } from '@/components/LandingPage';
import { LoadingPill } from '@/components/ui/loading-pill';
import { Footer } from '@/components/Footer';
import { DeepLinkHandler } from '@/components/DeepLinkHandler';

// Lazy load heavy components to improve TTI - fixed double lazy wrapping
const AccountOverview = lazy(() => import('@/components/AccountOverview').then(module => ({
  default: module.AccountOverview
})));
const TransactionBuilder = lazy(() => import('@/components/TransactionBuilder').then(module => ({
  default: module.TransactionBuilder
})));
import { fetchAccountData } from '@/lib/stellar';
import { useToast } from '@/hooks/use-toast';
import { FiatCurrencyProvider } from '@/contexts/FiatCurrencyContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useRequestDeduplication } from '@/hooks/useRequestDeduplication';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

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
  const { dedupe } = useRequestDeduplication();
  
  const [appState, setAppState] = useState<AppState>('connecting');
  const [connectedWallet, setConnectedWallet] = useState<string>('');
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [publicKey, setPublicKey] = useState<string>('');
  const [deepLinkReady, setDeepLinkReady] = useState(false);

  // Performance monitoring for development
  usePerformanceMonitor('Index');

  // Deep links are processed by DeepLinkHandler; we do not auto-switch app state here to ensure account loads first.


  // Optimized account data fetching with deduplication
  const handleDeepLinkLoaded = useCallback(async (sourceAccount: string) => {
    // Load account data from the XDR's source account
    setPublicKey(sourceAccount);
    setLoading(true);
    
    try {
      // Use dedupe to prevent duplicate requests for same account
      const realAccountData = await dedupe(
        `account-${sourceAccount}-${network}`,
        () => fetchAccountData(sourceAccount, network)
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

  const handleWalletConnect = useCallback(async (walletType: string, publicKey: string, selectedNetwork: 'mainnet' | 'testnet') => {
    setConnectedWallet(walletType);
    setPublicKey(publicKey);
    setNetwork(selectedNetwork);
    setLoading(true);
    
    // Immediately switch to appropriate state for better perceived performance
    const deepLinkXdr = sessionStorage.getItem('deeplink-xdr');
    if (deepLinkXdr) {
      setDeepLinkReady(true);
      setAppState('transaction');
    } else {
      setDeepLinkReady(false);
      setAppState('dashboard');
    }
    
    // Defer account data fetching to not block TTI
    setTimeout(async () => {
      try {
        // Use regular version for consistency with transaction history revert
        const realAccountData = await dedupe(
          `account-${publicKey}-${selectedNetwork}`,
          () => fetchAccountData(publicKey, selectedNetwork)
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
    setAppState('transaction');
  }, []);

  const handleConfigureMultisig = useCallback(() => {
    setAppState('multisig-config');
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setDeepLinkReady(false);
    setAppState('dashboard');
  }, []);

  const handleDisconnect = useCallback(() => {
    setConnectedWallet('');
    setPublicKey('');
    setAccountData(null);
    setDeepLinkReady(false);
    setAppState('connecting');
  }, []);

  // Memoized account refresh function
  const handleAccountRefresh = useCallback(async () => {
    if (!publicKey) return;
    const realAccountData = await dedupe(
      `account-${publicKey}-${network}`,
      () => fetchAccountData(publicKey, network)
    );
    setAccountData(realAccountData);
  }, [publicKey, network, dedupe]);

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
                key={`${appState}-${publicKey}`}
                onBack={handleBackToDashboard}
                accountPublicKey={publicKey || ''}
                accountData={accountData}
                initialTab={appState === 'multisig-config' ? 'multisig' : (deepLinkReady ? 'import' : 'payment')}
                onAccountRefresh={handleAccountRefresh}
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
