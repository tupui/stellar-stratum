import { useState, useEffect } from 'react';
import { LandingPage } from '@/components/LandingPage';
import { AccountOverview } from '@/components/AccountOverview';
import { TransactionBuilder } from '@/components/TransactionBuilder';
import { Footer } from '@/components/Footer';
import { DeepLinkHandler } from '@/components/DeepLinkHandler';
import { fetchAccountData } from '@/lib/stellar';
import { useToast } from '@/hooks/use-toast';
import { FiatCurrencyProvider } from '@/contexts/FiatCurrencyContext';
import { useNetwork } from '@/contexts/NetworkContext';

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

const Index = () => {
  const { toast } = useToast();
  const { network, setNetwork } = useNetwork();
  const [appState, setAppState] = useState<AppState>('connecting');
  const [connectedWallet, setConnectedWallet] = useState<string>('');
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [publicKey, setPublicKey] = useState<string>('');

  const handleDeepLinkLoaded = () => {
    // If wallet is already connected, go to transaction state
    if (connectedWallet && publicKey && accountData) {
      setAppState('transaction');
    }
    // Otherwise, wallet connection will handle the transition
  };

  const handleWalletConnect = async (walletType: string, publicKey: string, selectedNetwork: 'mainnet' | 'testnet') => {
    setConnectedWallet(walletType);
    setPublicKey(publicKey);
    setNetwork(selectedNetwork);
    setLoading(true);
    
    try {
      // Fetch real account data from Horizon
      const realAccountData = await fetchAccountData(publicKey, selectedNetwork);
      setAccountData(realAccountData);
      setLoading(false);
      
      // Check if we have deep link data and should go directly to transaction
      const deepLinkXdr = sessionStorage.getItem('deeplink-xdr');
      if (deepLinkXdr) {
        setAppState('transaction');
      } else {
        setAppState('dashboard');
      }
      
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
  };


  const handleInitiateTransaction = () => {
    setAppState('transaction');
  };

  const handleConfigureMultisig = () => {
    setAppState('multisig-config');
  };

  const handleSignTransaction = () => {
    // Handle signing flow
  };

  const handleBackToDashboard = () => {
    setAppState('dashboard');
  };

  const handleDisconnect = () => {
    setConnectedWallet('');
    setPublicKey('');
    setAccountData(null);
    setAppState('connecting');
  };

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
          {(appState === 'transaction' || appState === 'multisig-config') && publicKey && accountData && (
            <TransactionBuilder
              key={`${appState}-${publicKey}`}
              onBack={handleBackToDashboard}
              accountPublicKey={publicKey}
              accountData={accountData}
              initialTab={appState === 'multisig-config' ? 'multisig' : 'payment'}
              onAccountRefresh={async () => {
                if (!publicKey) return;
                const realAccountData = await fetchAccountData(publicKey, network);
                setAccountData(realAccountData);
              }}
            />
          )}

          {/* Account Dashboard */}
          {appState === 'dashboard' && publicKey && accountData && (
            <AccountOverview
              accountData={accountData}
              onInitiateTransaction={handleInitiateTransaction}
              onSignTransaction={() => {}}
              onRefreshBalances={async () => {
                if (!publicKey) return;
                const realAccountData = await fetchAccountData(publicKey, network);
                setAccountData(realAccountData);
              }}
              onDisconnect={handleDisconnect}
            />
          )}
        </div>
        
        {/* Only show footer when not on connecting page */}
        {appState !== 'connecting' && <Footer />}
      </div>
    </FiatCurrencyProvider>
  );
};

export default Index;
