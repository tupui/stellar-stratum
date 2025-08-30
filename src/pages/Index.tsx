import { useState } from 'react';
import { WalletConnect } from '@/components/WalletConnect';
import { AccountOverview } from '@/components/AccountOverview';
import { TransactionBuilder } from '@/components/TransactionBuilder';
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

type AppState = 'connecting' | 'dashboard' | 'transaction';

const Index = () => {
  const { toast } = useToast();
  const [appState, setAppState] = useState<AppState>('connecting');
  const [connectedWallet, setConnectedWallet] = useState<string>('');
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);

  const handleWalletConnect = async (walletType: string, publicKey: string) => {
    setConnectedWallet(walletType);
    setLoading(true);
    
    try {
      // Fetch real account data from Horizon
      const realAccountData = await fetchAccountData(publicKey);
      setAccountData(realAccountData);
      setAppState('dashboard');
      
      toast({
        title: "Account loaded",
        description: "Successfully loaded account data from Stellar network",
      });
    } catch (error) {
      console.error('Failed to load account:', error);
      toast({
        title: "Failed to load account",
        description: error instanceof Error ? error.message : "Could not load account data",
        variant: "destructive",
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

  const handleSignTransaction = () => {
    // Handle signing flow
    console.log('Sign transaction flow');
  };

  const handleBackToDashboard = () => {
    setAppState('dashboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg font-medium">Loading account data...</p>
          <p className="text-sm text-muted-foreground">Fetching data from Stellar network</p>
        </div>
      </div>
    );
  }

  if (appState === 'connecting') {
    return <WalletConnect onConnect={handleWalletConnect} />;
  }

  if (appState === 'transaction' && accountData) {
    return (
      <TransactionBuilder 
        onBack={handleBackToDashboard} 
        accountPublicKey={accountData.publicKey}
      />
    );
  }

  if (appState === 'dashboard' && accountData) {
    return (
      <AccountOverview 
        accountData={accountData}
        onInitiateTransaction={handleInitiateTransaction}
        onSignTransaction={handleSignTransaction}
      />
    );
  }

  return null;
};

export default Index;
