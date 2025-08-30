import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Wallet, Shield, ArrowRight, RefreshCw, AlertCircle, Usb, Info } from 'lucide-react';
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
  const [loading, setLoading] = useState(true);

  const loadWallets = async () => {
    try {
      setLoading(true);
      const wallets = await getSupportedWallets();
      setSupportedWallets(wallets);
    } catch (error) {
      console.error('Failed to load wallets:', error);
      toast({
        title: "Failed to load wallets",
        description: "Could not load supported wallets",
        variant: "destructive",
        duration: 2000,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWallets();
    
    // Check for wallet availability every 2 seconds for the first 10 seconds
    // This helps detect browser extensions that load after page load
    const interval = setInterval(() => {
      loadWallets();
    }, 2000);
    
    // Stop checking after 10 seconds
    const timeout = setTimeout(() => {
      clearInterval(interval);
    }, 10000);
    
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  const getWalletIcon = (wallet: ISupportedWallet) => {
    const isHardware = wallet.id.toLowerCase().includes('ledger') || wallet.id.toLowerCase().includes('trezor');
    
    if (isHardware) {
      return <Usb className="w-8 h-8 text-primary" />;
    }
    
    return wallet.icon ? (
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
    ) : (
      <div className="w-8 h-8 bg-gradient-primary rounded flex items-center justify-center text-sm font-bold text-primary-foreground">
        {wallet.name.charAt(0)}
      </div>
    );
  };

  const getWalletDescription = (wallet: ISupportedWallet) => {
    const isHardware = wallet.id.toLowerCase().includes('ledger') || wallet.id.toLowerCase().includes('trezor');
    
    if (isHardware) {
      return 'Hardware wallet';
    }
    
    if (wallet.isAvailable) {
      return 'Available';
    }
    
    // Check if it's a browser extension
    if (wallet.id.toLowerCase().includes('freighter') || 
        wallet.id.toLowerCase().includes('rabet') ||
        wallet.id.toLowerCase().includes('xbull')) {
      return 'Extension required';
    }
    
    return 'Install required';
  };

  const getWalletTooltip = (wallet: ISupportedWallet) => {
    if (wallet.id.toLowerCase().includes('ledger')) {
      return 'Hardware wallet setup: 1) Connect via USB 2) Unlock device 3) Open Stellar app';
    }
    if (wallet.id.toLowerCase().includes('trezor')) {
      return 'Hardware wallet setup: 1) Install Trezor Bridge 2) Connect device 3) Approve connection';
    }
    if (!wallet.isAvailable) {
      return `Install the ${wallet.name} browser extension to connect`;
    }
    return `Connect with ${wallet.name}`;
  };

  const handleConnect = async (walletId: string, walletName: string) => {
    setConnecting(walletId);
    
    try {
      const { publicKey } = await connectWallet(walletId);
      
      toast({
        title: "Wallet connected",
        description: `Successfully connected to ${walletName}`,
        duration: 2000,
      });
      
      onConnect(walletName, publicKey);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      
      const errorMessage = error instanceof Error ? error.message : "Failed to connect wallet";
      const isHardware = walletId.toLowerCase().includes('ledger') || walletId.toLowerCase().includes('trezor');
      
      toast({
        title: "Connection failed",
        description: errorMessage,
        variant: "destructive",
        duration: isHardware ? 6000 : 3000, // Longer duration for hardware wallet errors
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
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-muted-foreground">
              {supportedWallets.length} wallet{supportedWallets.length !== 1 ? 's' : ''} available
            </p>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={loadWallets}
              disabled={loading}
              className="h-8 px-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          
          {loading && supportedWallets.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Loading wallets...</span>
              </div>
            </div>
          ) : supportedWallets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertCircle className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No wallets found</p>
              <Button variant="outline" size="sm" onClick={loadWallets} className="mt-2">
                Try Again
              </Button>
            </div>
          ) : (
            supportedWallets.map((wallet) => {
              const isHardware = wallet.id.toLowerCase().includes('ledger') || wallet.id.toLowerCase().includes('trezor');
              
              return (
                <TooltipProvider key={wallet.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between h-16 border-border hover:border-primary/50 hover:bg-secondary/50 transition-smooth"
                        onClick={() => handleConnect(wallet.id, wallet.name)}
                        disabled={connecting !== null}
                      >
                        <div className="flex items-center gap-3">
                          {getWalletIcon(wallet)}
                          <div 
                            className="w-8 h-8 bg-gradient-primary rounded flex items-center justify-center text-sm font-bold text-primary-foreground hidden"
                          >
                            {wallet.name.charAt(0)}
                          </div>
                          <div className="text-left">
                            <div className="font-medium flex items-center gap-2">
                              {wallet.name}
                              {isHardware && (
                                <Info className="w-3 h-3 text-muted-foreground" />
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                              {getWalletDescription(wallet)}
                              {isHardware && (
                                <span className="text-xs bg-blue-500/10 text-blue-600 px-2 py-1 rounded">
                                  Hardware
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {connecting === wallet.id ? (
                          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <ArrowRight className="w-4 h-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p>{getWalletTooltip(wallet)}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })
          )}
          
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