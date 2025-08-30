import { useState } from 'react';
import { WalletConnect } from '@/components/WalletConnect';
import { AccountOverview } from '@/components/AccountOverview';
import { TransactionBuilder } from '@/components/TransactionBuilder';

interface AccountData {
  publicKey: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
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
  const [appState, setAppState] = useState<AppState>('connecting');
  const [connectedWallet, setConnectedWallet] = useState<string>('');
  const [accountData, setAccountData] = useState<AccountData | null>(null);

  const handleWalletConnect = async (walletType: string, publicKey: string) => {
    setConnectedWallet(walletType);
    
    // Mock account data - in real app, fetch from Horizon API
    const mockAccountData: AccountData = {
      publicKey,
      balances: [
        { asset_type: 'native', balance: '1234.5678900' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '500.00' },
      ],
      thresholds: {
        low_threshold: 1,
        med_threshold: 2,
        high_threshold: 3,
      },
      signers: [
        { key: publicKey, weight: 1, type: 'ed25519_public_key' },
        { key: 'GBEXAMPLEKEY2ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789', weight: 1, type: 'ed25519_public_key' },
        { key: 'GBEXAMPLEKEY3ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789', weight: 2, type: 'ed25519_public_key' },
      ],
    };
    
    setAccountData(mockAccountData);
    setAppState('dashboard');
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
