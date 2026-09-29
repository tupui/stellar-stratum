import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowRight, RefreshCw, AlertCircle, Usb, KeyRound, Plus, ChevronDown } from 'lucide-react';
import { useNetwork } from '@/contexts/NetworkContext';
import { useWalletKit } from '@/contexts/WalletKitContext';
import { useToast } from '@/hooks/use-toast';
import type { ISupportedWallet } from '@creit-tech/stellar-wallets-kit/types';
import { appConfig } from '@/lib/appConfig';
import { isValidPublicKey } from '@/lib/validation';
import { TrezorLogo } from '@/components/icons/TrezorLogo';

interface WalletConnectProps {
  onConnect: (publicKey: string, network: 'mainnet' | 'testnet') => void;
  /** Hardware wallets show their own dialogs, so the wallet modal steps aside for them. */
  onModalControl?: (isOpen: boolean) => void;
}

const isHardwareWallet = (wallet: ISupportedWallet) => {
  const id = wallet.id.toLowerCase();
  return id.includes('ledger') || id.includes('trezor');
};

/** Hides a broken logo and reveals the fallback icon rendered right after it. */
const showFallbackIcon = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const target = e.currentTarget;
  target.style.display = 'none';
  const fallback = target.nextElementSibling as HTMLElement | null;
  if (fallback) fallback.style.display = 'flex';
};

const WalletIcon = ({ wallet }: { wallet: ISupportedWallet }) => {
  const id = wallet.id.toLowerCase();
  if (id.includes('ledger')) {
    return <img src={`${import.meta.env.BASE_URL}ledger-logo.png`} alt="Ledger logo" className="w-7 h-7 object-contain" onError={showFallbackIcon} />;
  }
  if (id.includes('trezor')) return <TrezorLogo className="w-7 h-7 text-foreground" />;
  if (wallet.icon) {
    return <img src={wallet.icon} alt={wallet.name} className="w-7 h-7 rounded object-contain" onError={showFallbackIcon} />;
  }
  return (
    <div className="w-7 h-7 bg-gradient-primary rounded flex items-center justify-center text-sm font-bold text-primary-foreground">
      {wallet.name.charAt(0)}
    </div>
  );
};

const walletTooltip = (wallet: ISupportedWallet) => {
  const id = wallet.id.toLowerCase();
  if (id.includes('ledger')) {
    return 'Hardware wallet setup: 1) Connect via USB 2) Unlock device 3) Open Stellar app 4) Select account from device modal';
  }
  if (id.includes('trezor')) {
    return 'Hardware wallet setup: 1) Run Trezor Suite (required for Safe 7) or install Trezor Bridge 2) Connect device 3) Approve connection 4) Select account from device modal';
  }
  if (!wallet.isAvailable) return `${wallet.name} is not available in this browser`;
  return `Connect with ${wallet.name}`;
};

interface WalletButtonProps {
  wallet: ISupportedWallet;
  connecting: string | null;
  onConnect: (wallet: ISupportedWallet) => void;
}

const WalletButton = ({ wallet, connecting, onConnect }: WalletButtonProps) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between h-14 md:h-16 border-border hover:border-primary/50 hover:bg-secondary/50 transition-smooth"
          onClick={() => onConnect(wallet)}
          disabled={connecting !== null || !wallet.isAvailable}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center">
              <WalletIcon wallet={wallet} />
              <Usb className="w-8 h-8 text-primary hidden" />
            </div>
            <div className="text-left">
              <div className="font-medium">{wallet.name}</div>
              {!wallet.isAvailable && <div className="text-sm text-muted-foreground">Not available in this browser</div>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {connecting === wallet.id && <RefreshCw className="w-4 h-4 animate-spin" />}
            <ArrowRight className="w-4 h-4" />
          </div>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{walletTooltip(wallet)}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

/** Wallets shown before "See more wallets". */
const PRIMARY_WALLET_COUNT = 3;

export const WalletConnect = ({ onConnect, onModalControl }: WalletConnectProps) => {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualAddress, setManualAddress] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [showMoreWallets, setShowMoreWallets] = useState(false);
  const { network: selectedNetwork, setNetwork: setSelectedNetwork } = useNetwork();
  const { wallets, connectWallet, refreshWallets } = useWalletKit();

  // Extensions inject themselves a moment after page load: keep checking for a while.
  useEffect(() => {
    refreshWallets();
    const interval = setInterval(refreshWallets, appConfig.WALLET_CHECK_INTERVAL);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setLoading(false);
    }, appConfig.WALLET_TIMEOUT);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [selectedNetwork, refreshWallets]);

  useEffect(() => {
    if (wallets.length > 0) setLoading(false);
  }, [wallets]);

  // Already in priority order (WalletKitContext); usable wallets first.
  const orderedWallets = [...wallets.filter((w) => w.isAvailable), ...wallets.filter((w) => !w.isAvailable)];
  const primaryWallets = orderedWallets.slice(0, PRIMARY_WALLET_COUNT);
  const secondaryWallets = orderedWallets.slice(PRIMARY_WALLET_COUNT);

  const handleManualConnect = () => {
    const address = manualAddress.trim();
    if (!isValidPublicKey(address)) {
      toast({
        title: 'Invalid address',
        description: 'Please enter a valid Stellar public key (starts with G, 56 characters)',
        variant: 'destructive',
        duration: 3000,
      });
      return;
    }
    onConnect(address, selectedNetwork);
  };

  const handleConnect = async (wallet: ISupportedWallet) => {
    setConnecting(wallet.id);
    const isHardware = isHardwareWallet(wallet);
    if (isHardware) onModalControl?.(false);

    try {
      const { publicKey } = await connectWallet(wallet.id);
      if (!publicKey) throw new Error(`${wallet.name} did not return an address`);
      onConnect(publicKey, selectedNetwork);
    } catch (error) {
      if (isHardware) onModalControl?.(true);
      toast({
        title: 'Connection failed',
        description: error instanceof Error ? error.message : `Could not connect to ${wallet.name}`,
        variant: 'destructive',
        duration: isHardware ? 6000 : 4000,
      });
    } finally {
      setConnecting(null);
    }
  };

  const networkButton = (value: 'mainnet' | 'testnet', label: string) => (
    <button
      onClick={() => setSelectedNetwork(value)}
      className={`px-6 py-2.5 text-sm font-medium rounded-full transition-all ${
        selectedNetwork === value
          ? 'bg-success text-success-foreground shadow-lg shadow-success/20'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="py-6 flex justify-center">
        <div className="relative bg-muted/50 backdrop-blur-sm rounded-full p-1 flex border border-border/50">
          {networkButton('mainnet', 'Mainnet')}
          {networkButton('testnet', 'Testnet')}
        </div>
      </div>

      {/* Watch-only access works even when no wallet is installed */}
      <div className="border border-border rounded-lg bg-card hover:bg-secondary/50 transition-smooth">
        <Button variant="ghost" className="w-full justify-between h-14 md:h-16 p-4" onClick={() => setShowManualInput(!showManualInput)}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-primary rounded flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="text-left">
              <div className="font-medium">Enter address manually</div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4" />
        </Button>

        {showManualInput && (
          <div className="px-4 pb-4 space-y-3 border-t border-border">
            <div className="pt-3">
              <p className="text-xs text-muted-foreground">Enter a Stellar address to view account details (no signing required)</p>
            </div>
            <div className="flex gap-2">
              <Input
                id="manual-address"
                placeholder="GABC...XYZ"
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualAddress.trim()) handleManualConnect();
                }}
                className="font-address text-sm"
              />
              <Button onClick={handleManualConnect} disabled={!manualAddress.trim()} size="sm">
                <Plus className="w-4 h-4 mr-1" />
                Connect
              </Button>
            </div>
          </div>
        )}
      </div>

      {loading && wallets.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Loading wallets...</span>
          </div>
        </div>
      ) : wallets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No wallets found</p>
          <Button variant="outline" size="sm" onClick={refreshWallets} className="mt-2">
            Try Again
          </Button>
        </div>
      ) : (
        <>
          {primaryWallets.map((wallet) => (
            <WalletButton key={wallet.id} wallet={wallet} connecting={connecting} onConnect={handleConnect} />
          ))}
          {secondaryWallets.length > 0 && (
            <Collapsible open={showMoreWallets} onOpenChange={setShowMoreWallets}>
              <CollapsibleTrigger asChild>
                <Button variant="link" className="justify-start px-0 text-sm">
                  <span>See more wallets ({secondaryWallets.length})</span>
                  <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showMoreWallets ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 mt-3">
                {secondaryWallets.map((wallet) => (
                  <WalletButton key={wallet.id} wallet={wallet} connecting={connecting} onConnect={handleConnect} />
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </div>
  );
};
