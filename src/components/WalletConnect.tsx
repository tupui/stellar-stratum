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

export const WalletConnect = ({
  onConnect,
  isModal = false
}: WalletConnectProps) => {
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
        duration: 2000
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
      return <img src="/ledger-logo.png" alt="Ledger logo" className="w-8 h-8" />;
    }
    if (isHardware) {
      return <Usb className="w-8 h-8 text-primary" />;
    }
    return wallet.icon ? 
      <img src={wallet.icon} alt={wallet.name} className="w-8 h-8 rounded" /> : 
      <div className="w-8 h-8 bg-primary/10 rounded flex items-center justify-center text-sm font-bold text-primary">
        {wallet.name.charAt(0)}
      </div>;
  };

  const getWalletDescription = (wallet: ISupportedWallet) => {
    const isHardware = wallet.id.toLowerCase().includes('ledger') || wallet.id.toLowerCase().includes('trezor');
    if (isHardware) {
      return 'Hardware wallet';
    }
    if (wallet.isAvailable) {
      return 'Available';
    }
    return 'Install required';
  };

  const handleManualConnect = () => {
    if (!manualAddress.trim()) {
      toast({
        title: "Address required",
        description: "Please enter a valid Stellar address",
        variant: "destructive",
        duration: 3000
      });
      return;
    }

    if (!isValidPublicKey(manualAddress)) {
      toast({
        title: "Invalid address",
        description: "Please enter a valid Stellar public key (starts with G, 56 characters)",
        variant: "destructive",
        duration: 3000
      });
      return;
    }

    onConnect("Manual Address", manualAddress.trim(), selectedNetwork);
  };

  const handleSorobanConnect = async () => {
    if (!sorobanDomain.trim()) {
      toast({
        title: "Domain required",
        description: "Please enter a Soroban domain name",
        variant: "destructive",
        duration: 3000
      });
      return;
    }

    if (!isValidDomain(sorobanDomain.trim())) {
      toast({
        title: "Invalid domain",
        description: "Please enter a valid domain name",
        variant: "destructive",
        duration: 3000
      });
      return;
    }

    setResolvingDomain(true);
    try {
      const StellarSDK = await import('@stellar/stellar-sdk');
      const { SorobanDomainsSDK } = await import('@creit.tech/sorobandomains-sdk');

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

      const res = await sdk.searchDomain({
        domain: sorobanDomain.trim().toLowerCase()
      });

      const v = (res && (res.value ?? res)) as any;
      if (v && typeof v.owner === 'string') {
        const resolvedAddress = v.address || v.owner;
        setSorobanDomain('');
        onConnect("Soroban Domain", resolvedAddress, selectedNetwork);
      } else {
        toast({
          title: "Domain Not Found",
          description: `The domain "${sorobanDomain}" could not be resolved.`,
          variant: "destructive"
        });
      }
    } catch (error: any) {
      const { userMessage } = sanitizeError(error);
      let errorMessage = userMessage;
      
      if (error.name === 'Domain404Error') {
        errorMessage = `Domain "${sorobanDomain}" not found`;
      }
      
      toast({
        title: "Domain resolution failed",
        description: errorMessage,
        variant: "destructive",
        duration: 3000
      });
    } finally {
      setResolvingDomain(false);
    }
  };

  const handleConnect = async (walletId: string, walletName: string) => {
    setConnecting(walletId);
    try {
      const { publicKey } = await connectWallet(walletId, selectedNetwork);
      onConnect(walletName, publicKey, selectedNetwork);
    } catch (error) {
      const { userMessage, fullError } = sanitizeError(error);
      console.error('Failed to connect wallet:', fullError);
      
      const isHardware = walletId.toLowerCase().includes('ledger') || walletId.toLowerCase().includes('trezor');
      toast({
        title: "Connection failed",
        description: userMessage,
        variant: "destructive",
        duration: isHardware ? 6000 : 3000
      });
    } finally {
      setConnecting(null);
    }
  };

  const availableWallets = supportedWallets.filter(w => w.isAvailable);
  const unavailableWallets = supportedWallets.filter(w => !w.isAvailable);

  const walletContent = (
    <div className="space-y-4">
      {/* Network Selector */}
      <div className="flex justify-center">
        <div className="bg-muted p-1 rounded-lg flex">
          <button
            onClick={() => setSelectedNetwork('mainnet')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              selectedNetwork === 'mainnet'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Mainnet
          </button>
          <button
            onClick={() => setSelectedNetwork('testnet')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              selectedNetwork === 'testnet'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Testnet
          </button>
        </div>
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
        <div className="space-y-2">
          {/* Available Wallets */}
          {availableWallets.map(wallet => (
            <Button
              key={wallet.id}
              variant="outline"
              className="w-full justify-between h-auto p-4"
              onClick={() => handleConnect(wallet.id, wallet.name)}
              disabled={connecting !== null}
            >
              <div className="flex items-center gap-3">
                {getWalletIcon(wallet)}
                <div className="text-left">
                  <div className="font-medium">{wallet.name}</div>
                  <div className="text-sm text-muted-foreground">{getWalletDescription(wallet)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {wallet.isAvailable && <Badge variant="secondary" className="text-xs">Ready</Badge>}
                {connecting === wallet.id ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
              </div>
            </Button>
          ))}

          {/* Manual Address Input */}
          <Collapsible open={showManualInput} onOpenChange={setShowManualInput}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between h-auto p-4">
                <div className="flex items-center gap-3">
                  <KeyRound className="w-8 h-8 text-primary" />
                  <div className="text-left">
                    <div className="font-medium">Manual Address</div>
                    <div className="text-sm text-muted-foreground">Enter any public key</div>
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${showManualInput ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              <div className="p-3 border rounded-lg space-y-3">
                <Label>Stellar Public Key</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="GABC...XYZ"
                    value={manualAddress}
                    onChange={(e) => setManualAddress(e.target.value)}
                    className="font-mono text-sm"
                    maxLength={56}
                  />
                  <Button onClick={handleManualConnect} disabled={!manualAddress.trim()}>
                    Connect
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Soroban Domains */}
          <Collapsible open={showSorobanInput} onOpenChange={setShowSorobanInput}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between h-auto p-4">
                <div className="flex items-center gap-3">
                  <Globe className="w-8 h-8 text-primary" />
                  <div className="text-left">
                    <div className="font-medium">Soroban Domain</div>
                    <div className="text-sm text-muted-foreground">Resolve domain to address</div>
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${showSorobanInput ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              <div className="p-3 border rounded-lg space-y-3">
                <Label>Domain Name</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="mydomain"
                    value={sorobanDomain}
                    onChange={(e) => setSorobanDomain(e.target.value)}
                  />
                  <Button onClick={handleSorobanConnect} disabled={!sorobanDomain.trim() || resolvingDomain}>
                    {resolvingDomain ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      'Resolve'
                    )}
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Unavailable Wallets */}
          {unavailableWallets.length > 0 && (
            <Collapsible open={showMoreWallets} onOpenChange={setShowMoreWallets}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-center text-sm text-muted-foreground">
                  <ChevronDown className={`w-4 h-4 mr-2 transition-transform ${showMoreWallets ? 'rotate-180' : ''}`} />
                  Show more wallets ({unavailableWallets.length})
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2">
                {unavailableWallets.map(wallet => (
                  <Button
                    key={wallet.id}
                    variant="outline"
                    className="w-full justify-between h-auto p-4 opacity-50"
                    disabled
                  >
                    <div className="flex items-center gap-3">
                      {getWalletIcon(wallet)}
                      <div className="text-left">
                        <div className="font-medium">{wallet.name}</div>
                        <div className="text-sm text-muted-foreground">{getWalletDescription(wallet)}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">Not Available</Badge>
                  </Button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}
    </div>
  );

  if (isModal) {
    return walletContent;
  }

  return (
    <div className="container max-w-md mx-auto p-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            <Wallet className="w-6 h-6" />
            Connect Wallet
          </CardTitle>
          <CardDescription>
            Choose how you'd like to connect to Stellar
          </CardDescription>
        </CardHeader>
        <CardContent>
          {walletContent}
        </CardContent>
      </Card>
    </div>
  );
};