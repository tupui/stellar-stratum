import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Wallet, Shield, ArrowRight, RefreshCw, AlertCircle, Usb, Info, KeyRound, Plus, Globe, ChevronDown } from 'lucide-react';

import { getSupportedWallets, connectWallet, getNetworkPassphrase } from '@/lib/stellar';
import { useNetwork } from '@/contexts/NetworkContext';
import { useToast } from '@/hooks/use-toast';
import { ISupportedWallet } from '@creit.tech/stellar-wallets-kit';
import { isValidPublicKey, isValidDomain, sanitizeError } from '@/lib/validation';

interface WalletConnectProps {
  onConnect: (walletType: string, publicKey: string, network: 'mainnet' | 'testnet') => void;
  isModal?: boolean;
}

export const WalletConnect = ({ onConnect, isModal = false }: WalletConnectProps) => {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [supportedWallets, setSupportedWallets] = useState<ISupportedWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualAddress, setManualAddress] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [sorobanDomain, setSorobanDomain] = useState('');
  const [showSorobanInput, setShowSorobanInput] = useState(false);
  const [resolvingDomain, setResolvingDomain] = useState(false);
  const [showMoreWallets, setShowMoreWallets] = useState(false);
  const { network: selectedNetwork, setNetwork: setSelectedNetwork } = useNetwork();

  const loadWallets = async () => {
    try {
      setLoading(true);
      const wallets = await getSupportedWallets(selectedNetwork);
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
    let interval: NodeJS.Timeout;
    let timeout: NodeJS.Timeout;
    
    const checkWallets = async () => {
      await loadWallets();
      const wallets = await getSupportedWallets(selectedNetwork);
      
      // Stop scanning if we found available wallets
      if (wallets.some(wallet => wallet.isAvailable)) {
        clearInterval(interval);
        clearTimeout(timeout);
        setLoading(false);
      }
    };
    
    checkWallets();
    
    // Check for wallet availability every 2 seconds for max 10 seconds
    interval = setInterval(checkWallets, 2000);
    timeout = setTimeout(() => {
      clearInterval(interval);
      clearTimeout(timeout);
      setLoading(false);
    }, 10000);
    
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [selectedNetwork]); // Re-run when network changes

  const getWalletIcon = (wallet: ISupportedWallet) => {
    const isLedger = wallet.id.toLowerCase().includes('ledger');
    const isHardware = isLedger || wallet.id.toLowerCase().includes('trezor');
    
    if (isLedger) {
      return (
        <img 
          src="/ledger-logo.png" 
          alt="Ledger logo" 
          className="w-8 h-8"
          onError={(e) => {
            // Fallback to USB icon if SVG fails to load
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const fallback = target.nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
      );
    }
    
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
      return 'Hardware wallet setup: 1) Connect via USB 2) Unlock device 3) Open Stellar app 4) Select account from device modal';
    }
    if (wallet.id.toLowerCase().includes('trezor')) {
      return 'Hardware wallet setup: 1) Install Trezor Bridge 2) Connect device 3) Approve connection 4) Select account from device modal';
    }
    if (!wallet.isAvailable) {
      return `Install the ${wallet.name} browser extension to connect`;
    }
    return `Connect with ${wallet.name}`;
  };

  const handleManualConnect = () => {
    if (!manualAddress.trim()) {
      toast({
        title: "Address required",
        description: "Please enter a valid Stellar address",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

    // Basic validation for Stellar address format
    if (!isValidPublicKey(manualAddress)) {
      toast({
        title: "Invalid address",
        description: "Please enter a valid Stellar public key (starts with G, 56 characters)",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

    toast({
      title: "Address connected",
      description: "Successfully connected with manual address",
      duration: 2000,
    });

    onConnect("Manual Address", manualAddress.trim(), selectedNetwork);
  };

  const handleSorobanConnect = async () => {
    if (!sorobanDomain.trim()) {
      toast({
        title: "Domain required",
        description: "Please enter a Soroban domain name",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

    if (!isValidDomain(sorobanDomain.trim())) {
      toast({
        title: "Invalid domain",
        description: "Please enter a valid domain name",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

    setResolvingDomain(true);
    
    try {
      // Import required modules  
      const StellarSDK = await import('@stellar/stellar-sdk');
      const { SorobanDomainsSDK } = await import('@creit.tech/sorobandomains-sdk');
      
      // Use proper SDK structure from working example
      const networkPassphrase = selectedNetwork === 'testnet' ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC;
      const rpcUrl = selectedNetwork === 'testnet' ? 'https://soroban-testnet.stellar.org' : 'https://mainnet.sorobanrpc.com';
      const rpcServer = new StellarSDK.rpc.Server(rpcUrl);
      
      const sdk = new SorobanDomainsSDK({
        stellarSDK: StellarSDK,
        rpc: rpcServer,
        network: networkPassphrase,
        vaultsContractId: 'CATRNPHYKNXAPNLHEYH55REB6YSAJLGCPA4YM6L3WUKSZOPI77M2UMKI',
        defaultFee: '100',
        defaultTimeout: 300,
        simulationAccount: 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV'
      });
      
      // Search for the domain using working pattern
      const res = await sdk.searchDomain({ domain: sorobanDomain.trim().toLowerCase() });
      
      // Extract values using working pattern
      const v = (res && (res.value ?? res)) as any;
      
      if (v && typeof v.owner === 'string') {
        const resolvedAddress = v.address || v.owner;
        
        toast({
          title: "Domain Resolved",
          description: `${sorobanDomain} → ${resolvedAddress.slice(0, 8)}...${resolvedAddress.slice(-8)}`,
        });
        
        setSorobanDomain('');
        onConnect("Soroban Domain", resolvedAddress, selectedNetwork);
      } else {
        toast({
          title: "Domain Not Found",
          description: `The domain "${sorobanDomain}" could not be resolved.`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      const { userMessage, fullError } = sanitizeError(error);
      
      let errorMessage = userMessage;
      
      if (error.name === 'Domain404Error') {
        errorMessage = `Domain "${sorobanDomain}" not found`;
      }
      
      toast({
        title: "Domain resolution failed", 
        description: errorMessage,
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setResolvingDomain(false);
    }
  };
  const handleConnect = async (walletId: string, walletName: string) => {
    setConnecting(walletId);
    
    try {
      const { publicKey } = await connectWallet(walletId, selectedNetwork);
      
      toast({
        title: "Wallet connected",
        description: `Successfully connected to ${walletName}`,
        duration: 2000,
      });
      
      onConnect(walletName, publicKey, selectedNetwork);
    } catch (error) {
      const { userMessage, fullError } = sanitizeError(error);
      console.error('Failed to connect wallet:', fullError);
      
      const isHardware = walletId.toLowerCase().includes('ledger') || walletId.toLowerCase().includes('trezor');
      
      toast({
        title: "Connection failed",
        description: userMessage,
        variant: "destructive",
        duration: isHardware ? 6000 : 3000, // Longer duration for hardware wallet errors
      });
    } finally {
      setConnecting(null);
    }
  };

  const walletContent = (
    <>
      {/* Network Selection */}
      <div className="mb-6 space-y-2">
        <Label className="text-sm font-medium">Network</Label>
        <Select value={selectedNetwork} onValueChange={(value: 'mainnet' | 'testnet') => setSelectedNetwork(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mainnet">
              <div className="flex items-center gap-2">
                <Badge variant="default">Mainnet</Badge>
                <span>horizon.stellar.org</span>
              </div>
            </SelectItem>
            <SelectItem value="testnet">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Testnet</Badge>
                <span>horizon-testnet.stellar.org</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator className="mb-6" />
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
        <div className="space-y-3">
          {/* Manual Address as a card option */}
          <Button
            variant="outline"
             className="w-full justify-between h-14 md:h-16 border-border hover:border-primary/50 hover:bg-secondary/50 transition-smooth"
            onClick={() => setShowManualInput(!showManualInput)}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-primary rounded flex items-center justify-center">
                <KeyRound className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="text-left">
                <div className="font-medium">Enter address manually</div>
                <div className="text-sm text-muted-foreground">View any account by public key</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4" />
          </Button>

          {showManualInput && (
            <div className="p-4 border border-border rounded-lg bg-secondary/20">
              <div className="space-y-3">
                <div>
                  <Label htmlFor="manual-address" className="text-sm font-medium">Stellar Public Key</Label>
                  <p className="text-xs text-muted-foreground mt-1">Enter a Stellar address to view account details (no signing required)</p>
                </div>
                <div className="flex gap-2">
                  <Input id="manual-address" placeholder="GABC...XYZ" value={manualAddress} onChange={(e) => setManualAddress(e.target.value)} className="font-mono text-sm" maxLength={56} />
                  <Button onClick={handleManualConnect} disabled={!manualAddress.trim()} size="sm">
                    <Plus className="w-4 h-4 mr-1" />
                    Connect
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Soroban Domains Option */}
          <Button
            variant="outline"
            className="w-full justify-between h-14 md:h-16 border-border hover:border-primary/50 hover:bg-secondary/50 transition-smooth"
            onClick={() => setShowSorobanInput(!showSorobanInput)}
          >
            <div className="flex items-center gap-3">
              <img src="/images/soroban-domains-logo.png" alt="Soroban Domains logo" className="w-8 h-8 rounded" />
              <div className="text-left">
                <div className="font-medium">Soroban Domains</div>
                <div className="text-sm text-muted-foreground">Resolve domain to address</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4" />
          </Button>

          {showSorobanInput && (
            <div className="p-4 border border-border rounded-lg bg-secondary/20">
              <div className="space-y-3">
                <div>
                  <Label htmlFor="soroban-domain" className="text-sm font-medium">Soroban Domain</Label>
                  <p className="text-xs text-muted-foreground mt-1">Enter a domain name to resolve to Stellar address</p>
                </div>
                <div className="flex gap-2">
                  <Input 
                    id="soroban-domain" 
                    placeholder="mydomain" 
                    value={sorobanDomain} 
                    onChange={(e) => setSorobanDomain(e.target.value)} 
                    className="text-sm" 
                  />
                  <Button 
                    onClick={handleSorobanConnect} 
                    disabled={!sorobanDomain.trim() || resolvingDomain} 
                    size="sm"
                  >
                    {resolvingDomain ? (
                      <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 mr-1" />
                    )}
                    Resolve
                  </Button>
                </div>
              </div>
            </div>
          )}

          {(() => {
            const isMobile = window.innerWidth < 768;
            
            // Define wallet order based on user requirements
            const mobileOrder = ['xbull', 'hot', 'albedo'];
            const desktopOrder = ['freighter', 'xbull', 'ledger', 'hot', 'albedo'];
            
            // Order and filter wallets to match exactly the requested list
            const orderAndFilter = (wallets: typeof supportedWallets, order: string[]) => {
              const added = new Set<string>();
              const result: ISupportedWallet[] = [];
              const matches = (w: ISupportedWallet, token: string) =>
                w.id.toLowerCase().includes(token) || w.name.toLowerCase().includes(token);
              for (const token of order) {
                for (const w of wallets) {
                  if (added.has(w.id)) continue;
                  if (matches(w, token)) {
                    result.push(w);
                    added.add(w.id);
                  }
                }
              }
              return result;
            };
            
            if (isMobile) {
              const orderedWallets = orderAndFilter(supportedWallets, mobileOrder);
              
              return (
                <>
                  {orderedWallets.map((wallet) => {
                    const isHardware = wallet.id.toLowerCase().includes('ledger') || wallet.id.toLowerCase().includes('trezor');
                    
                    return (
                      <TooltipProvider key={wallet.id}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-between h-14 md:h-16 border-border hover:border-primary/50 hover:bg-secondary/50 transition-smooth"
                              onClick={() => handleConnect(wallet.id, wallet.name)}
                              disabled={connecting !== null || !wallet.isAvailable}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 flex items-center justify-center">
                                  {getWalletIcon(wallet)}
                                  <Usb className="w-8 h-8 text-primary hidden" />
                                </div>
                                <div className="text-left">
                                  <div className="font-medium">{wallet.name}</div>
                                  <div className="text-sm text-muted-foreground">{getWalletDescription(wallet)}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {connecting === wallet.id && <RefreshCw className="w-4 h-4 animate-spin" />}
                                <ArrowRight className="w-4 h-4" />
                              </div>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{getWalletTooltip(wallet)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </>
              );
            } else {
              // Desktop: First 3 visible (since Manual + Soroban are the first two), rest in collapsible
              const orderedWallets = orderAndFilter(supportedWallets, desktopOrder);
              const primaryWallets = orderedWallets.slice(0, 3);
              const secondaryWallets = orderedWallets.slice(3);
              
              return (
                <>
                  {primaryWallets.map((wallet) => {
                    const isHardware = wallet.id.toLowerCase().includes('ledger') || wallet.id.toLowerCase().includes('trezor');
                    
                    return (
                      <TooltipProvider key={wallet.id}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-between h-14 md:h-16 border-border hover:border-primary/50 hover:bg-secondary/50 transition-smooth"
                              onClick={() => handleConnect(wallet.id, wallet.name)}
                              disabled={connecting !== null || !wallet.isAvailable}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 flex items-center justify-center">
                                  {getWalletIcon(wallet)}
                                  <Usb className="w-8 h-8 text-primary hidden" />
                                </div>
                                <div className="text-left">
                                  <div className="font-medium">{wallet.name}</div>
                                  <div className="text-sm text-muted-foreground">{getWalletDescription(wallet)}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {connecting === wallet.id && <RefreshCw className="w-4 h-4 animate-spin" />}
                                <ArrowRight className="w-4 h-4" />
                              </div>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{getWalletTooltip(wallet)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                  
                  {secondaryWallets.length > 0 && (
                    <Collapsible open={showMoreWallets} onOpenChange={setShowMoreWallets}>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="link"
                          className="justify-start px-0 text-sm"
                        >
                          <span>See more wallets ({secondaryWallets.length})</span>
                          <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showMoreWallets ? 'rotate-180' : ''}`} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-3 mt-3">
                        {secondaryWallets.map((wallet) => {
                          const isHardware = wallet.id.toLowerCase().includes('ledger') || wallet.id.toLowerCase().includes('trezor');
                          
                          return (
                            <TooltipProvider key={wallet.id}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className="w-full justify-between h-14 md:h-16 border-border hover:border-primary/50 hover:bg-secondary/50 transition-smooth"
                                    onClick={() => handleConnect(wallet.id, wallet.name)}
                                    disabled={connecting !== null || !wallet.isAvailable}
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 flex items-center justify-center">
                                        {getWalletIcon(wallet)}
                                        <Usb className="w-8 h-8 text-primary hidden" />
                                      </div>
                                      <div className="text-left">
                                        <div className="font-medium">{wallet.name}</div>
                                        <div className="text-sm text-muted-foreground">{getWalletDescription(wallet)}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {connecting === wallet.id && <RefreshCw className="w-4 h-4 animate-spin" />}
                                      <ArrowRight className="w-4 h-4" />
                                    </div>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{getWalletTooltip(wallet)}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </>
              );
            }
          })()}
        </div>
      )}
    </>
  );

  if (isModal) {
    return (
      <div className="space-y-3">
        {walletContent}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center shadow-glow">
            <Shield className="w-8 h-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">Stellar Multisig Wallet</CardTitle>
          <CardDescription>
            A powerful tool for managing Stellar multisig accounts. Build transactions, configure signers, and coordinate signatures across multiple parties with ease.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {walletContent}
          
          <div className="pt-4 border-t border-border">
            <div className="text-center text-xs text-muted-foreground">
              © 2025 Consulting Manao GmbH
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};