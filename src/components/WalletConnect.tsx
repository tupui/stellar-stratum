import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wallet, Shield, ArrowRight } from 'lucide-react';
import { getSupportedWallets, connectWallet } from '@/lib/stellar';
import { useToast } from '@/hooks/use-toast';
import { ISupportedWallet } from '@creit.tech/stellar-wallets-kit';

interface WalletConnectProps {
  onConnect: (walletType: string, publicKey: string) => void;
}

export const WalletConnect = ({ onConnect }: WalletConnectProps) => {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [supportedWallets, setSupportedWallets] = useState<ISupportedWallet[]>([]);

  useEffect(() => {
    const loadWallets = async () => {
      try {
        const wallets = await getSupportedWallets();
        setSupportedWallets(wallets);
      } catch (error) {
        console.error('Failed to load wallets:', error);
        toast({
          title: "Failed to load wallets",
          description: "Could not load supported wallets",
          variant: "destructive",
        });
      }
    };
    
    loadWallets();
  }, [toast]);

  const handleConnect = async (walletId: string, walletName: string) => {
    setConnecting(walletId);
    
    try {
      const { publicKey } = await connectWallet(walletId);
      
      toast({
        title: "Wallet connected",
        description: `Successfully connected to ${walletName}`,
      });
      
      onConnect(walletName, publicKey);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      toast({
        title: "Connection failed",
        description: error instanceof Error ? error.message : "Failed to connect wallet",
        variant: "destructive",
      });
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
          {supportedWallets.map((wallet) => (
            <Button
              key={wallet.id}
              variant="outline"
              className="w-full justify-between h-16 border-border hover:border-primary/50 hover:bg-secondary/50 transition-smooth"
              onClick={() => handleConnect(wallet.id, wallet.name)}
              disabled={connecting !== null}
            >
              <div className="flex items-center gap-3">
                <img 
                  src={wallet.icon} 
                  alt={wallet.name} 
                  className="w-8 h-8 rounded"
                  onError={(e) => {
                    // Fallback to text icon if image fails to load
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const fallback = target.nextElementSibling as HTMLElement;
                    if (fallback) fallback.style.display = 'flex';
                  }}
                />
                <div 
                  className="w-8 h-8 bg-gradient-primary rounded flex items-center justify-center text-sm font-bold text-primary-foreground hidden"
                >
                  {wallet.name.charAt(0)}
                </div>
                <div className="text-left">
                  <div className="font-medium">{wallet.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {wallet.isAvailable ? 'Available' : 'Install required'}
                  </div>
                </div>
              </div>
              {connecting === wallet.id ? (
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