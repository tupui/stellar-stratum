import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wallet, Shield, ArrowRight } from 'lucide-react';

interface WalletOption {
  name: string;
  description: string;
  icon: string;
}

const SUPPORTED_WALLETS: WalletOption[] = [
  { name: 'Freighter', description: 'Browser extension wallet', icon: '🚀' },
  { name: 'Ledger', description: 'Hardware wallet support', icon: '🔒' },
  { name: 'Lobstr', description: 'Mobile & web wallet', icon: '🦞' },
  { name: 'Albedo', description: 'Universal Stellar signer', icon: '⭐' },
  { name: 'WalletConnect', description: 'Connect multiple wallets', icon: '🔗' },
];

interface WalletConnectProps {
  onConnect: (walletType: string, publicKey: string) => void;
}

export const WalletConnect = ({ onConnect }: WalletConnectProps) => {
  const [connecting, setConnecting] = useState<string | null>(null);

  const handleConnect = async (walletName: string) => {
    setConnecting(walletName);
    
    try {
      // Mock connection for now - will be replaced with actual wallet integration
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Generate mock public key for demo
      const mockPublicKey = `G${'ABCDEFGHIJK1234567890'.slice(0, 16)}${'EXAMPLE'.slice(0, 16)}`;
      onConnect(walletName, mockPublicKey);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    } finally {
      setConnecting(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center shadow-glow">
            <Shield className="w-8 h-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">Stellar Multisig Wallet</CardTitle>
          <CardDescription>
            Connect your wallet to manage multisig operations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {SUPPORTED_WALLETS.map((wallet) => (
            <Button
              key={wallet.name}
              variant="outline"
              className="w-full justify-between h-16 border-border hover:border-primary/50 hover:bg-secondary/50 transition-smooth"
              onClick={() => handleConnect(wallet.name)}
              disabled={connecting !== null}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{wallet.icon}</span>
                <div className="text-left">
                  <div className="font-medium">{wallet.name}</div>
                  <div className="text-sm text-muted-foreground">{wallet.description}</div>
                </div>
              </div>
              {connecting === wallet.name ? (
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
            </Button>
          ))}
          
          <div className="pt-4 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Wallet className="w-4 h-4" />
              <span>Secure connection protected by encryption</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};