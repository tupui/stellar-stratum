import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowRight, AlertCircle, Usb, Key, Plus, ChevronDown } from 'lucide-react';
import { Spinner } from '@/components/brand/Mark';
import { cn } from '@/lib/utils';
import { useNetwork } from '@/contexts/NetworkContext';
import { useWalletKit } from '@/contexts/WalletKitContext';
import { useToast } from '@/hooks/use-toast';
import type { ISupportedWallet } from '@creit-tech/stellar-wallets-kit/types';
import { appConfig } from '@/lib/appConfig';
import { accountIdOf } from '@/lib/validation';
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
    return <img src={wallet.icon} alt={wallet.name} className="w-7 h-7 object-contain" onError={showFallbackIcon} />;
  }
  return (
    <div className="w-7 h-7 border border-line-2 bg-ink-3 flex items-center justify-center text-sm font-bold text-foreground">
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

/** A row of the wallet list: a 32 px glyph, the name, and an arrow. */
const ROW =
  'flex min-h-[60px] w-full items-center gap-3 px-4 text-left text-[15px] font-semibold text-foreground transition-colors hover:bg-ink-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:text-muted-foreground';
const ROW_FRAME = 'border border-line-2 bg-ink';

const WalletButton = ({ wallet, connecting, onConnect }: WalletButtonProps) => (
  <div className={ROW_FRAME}>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={ROW}
            onClick={() => onConnect(wallet)}
            disabled={connecting !== null || !wallet.isAvailable}
          >
            <span className="inline-grid h-8 w-8 shrink-0 place-items-center">
              <WalletIcon wallet={wallet} />
              <Usb className="w-7 h-7 text-foreground hidden" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">{wallet.name}</span>
              {!wallet.isAvailable && <span className="block text-[13px] font-normal text-muted-foreground">Not available in this browser</span>}
            </span>
            {connecting === wallet.id && <Spinner />}
            <ArrowRight className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{walletTooltip(wallet)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
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
    const address = accountIdOf(manualAddress.trim());
    if (!address) {
      toast({
        title: 'Invalid address',
        description: 'Please enter a valid Stellar account address (G…) or muxed address (M…)',
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

  const networkButton = (value: 'mainnet' | 'testnet', label: string) => {
    const selected = selectedNetwork === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => setSelectedNetwork(value)}
        className={cn(
          'min-h-11 flex-1 border-l border-line-2 text-sm font-semibold transition-colors first:border-l-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
          selected ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Network" className="mb-4 flex border border-line-2">
        {networkButton('mainnet', 'Mainnet')}
        {networkButton('testnet', 'Testnet')}
      </div>

      <div className="flex flex-col gap-3">
        {/* Watch-only access works even when no wallet is installed */}
        <div className={ROW_FRAME}>
          <button
            type="button"
            className={ROW}
            aria-expanded={showManualInput}
            onClick={() => setShowManualInput(!showManualInput)}
          >
            <span className="inline-grid h-8 w-8 shrink-0 place-items-center">
              <Key className="h-[22px] w-[22px] text-foreground" aria-hidden="true" />
            </span>
            <span className="flex-1">Enter Address Manually</span>
            <ArrowRight className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          </button>

          {showManualInput && (
            <div className="flex flex-col gap-4 border-t border-line px-4 pb-4 pt-3">
              <p className="text-[13px] text-muted-foreground">Enter a Stellar address to view account details (no signing required)</p>
              <div className="flex gap-2">
                <Input
                  id="manual-address"
                  aria-label="Stellar address"
                  placeholder="GABC...XYZ"
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && manualAddress.trim()) handleManualConnect();
                  }}
                  className="min-w-0 flex-1 font-address text-[13px]"
                />
                <Button onClick={handleManualConnect} disabled={!manualAddress.trim()}>
                  <Plus />
                  Connect
                </Button>
              </div>
            </div>
          )}
        </div>

        {loading && wallets.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner />
              <span className="text-[15px]">Loading wallets...</span>
            </div>
          </div>
        ) : wallets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="w-5 h-5 text-muted-foreground mb-2" aria-hidden="true" />
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
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center gap-2 text-[15px] font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    See More Wallets ({secondaryWallets.length})
                    <ChevronDown
                      className={cn('h-[18px] w-[18px] transition-transform', showMoreWallets && 'rotate-180')}
                      aria-hidden="true"
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 flex flex-col gap-3">
                  {secondaryWallets.map((wallet) => (
                    <WalletButton key={wallet.id} wallet={wallet} connecting={connecting} onConnect={handleConnect} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </div>
    </div>
  );
};
