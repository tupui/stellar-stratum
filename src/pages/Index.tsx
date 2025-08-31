import { useState } from 'react';
import { WalletConnect } from '@/components/WalletConnect';
import { AccountOverview } from '@/components/AccountOverview';
import { TransactionBuilder } from '@/components/TransactionBuilder';
import { Footer } from '@/components/Footer';
import { fetchAccountData } from '@/lib/stellar';
import { useToast } from '@/hooks/use-toast';

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
  const [appState, setAppState] = useState<AppState>('connecting');
  const [connectedWallet, setConnectedWallet] = useState<string>('');
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [publicKey, setPublicKey] = useState<string>('');

  const handleWalletConnect = async (walletType: string, publicKey: string) => {
    setConnectedWallet(walletType);
    setPublicKey(publicKey);
    setLoading(true);
    
    try {
      // Fetch real account data from Horizon
      const realAccountData = await fetchAccountData(publicKey);
      setAccountData(realAccountData);
      setAppState('dashboard');
      
      toast({
        title: 'Account loaded',
        description: 'Successfully loaded account data from Stellar network',
      });
    } catch (error) {
      console.error('Failed to load account:', error);
      toast({
        title: 'Failed to load account',
        description: error instanceof Error ? error.message : 'Could not load account data',
        variant: 'destructive',
      });
      
      // Fall back to connection screen
      setAppState('connecting');
    } finally {
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
    console.log('Sign transaction flow');
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
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1">
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-center space-y-4">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-muted-foreground">Loading account data...</p>
            </div>
          </div>
        )}

        {/* Wallet Connection */}
        {!loading && appState === 'connecting' && (
          <WalletConnect onConnect={handleWalletConnect} />
        )}

        {/* Transaction Builder */}
        {!loading && (appState === 'transaction' || appState === 'multisig-config') && publicKey && accountData && (
          <TransactionBuilder
            onBack={handleBackToDashboard}
            accountPublicKey={publicKey}
            accountData={accountData}
            initialTab={appState === 'multisig-config' ? 'multisig' : 'payment'}
          />
        )}

        {/* Account Dashboard */}
        {!loading && appState === 'dashboard' && publicKey && accountData && (
          <AccountOverview
            accountData={accountData}
            onInitiateTransaction={handleInitiateTransaction}
            onSignTransaction={() => {}}
            onRefreshBalances={async () => {
              if (!publicKey) return;
              const realAccountData = await fetchAccountData(publicKey);
              setAccountData(realAccountData);
            }}
            onDisconnect={handleDisconnect}
          />
        )}
      </div>
      
      {/* Only show footer when not on connecting page */}
      {appState !== 'connecting' && <Footer />}
    </div>
  );
};

export default Index;
