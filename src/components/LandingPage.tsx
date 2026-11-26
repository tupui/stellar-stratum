import { useState, Suspense, lazy } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AppHeader, Wrap } from '@/components/brand/Shell';
import { Spinner } from '@/components/brand/Mark';
import { openExternal } from '@/lib/utils';
const WalletConnect = lazy(() => import('@/components/WalletConnect').then(module => ({
  default: module.WalletConnect
})));
interface LandingPageProps {
  onConnect: (publicKey: string, network: 'mainnet' | 'testnet') => void;
}

const BRAND = `${import.meta.env.BASE_URL}brand/`;

export const LandingPage = ({
  onConnect
}: LandingPageProps) => {
  const [showWalletModal, setShowWalletModal] = useState(false);

  const handleConnect = (publicKey: string, network: 'mainnet' | 'testnet') => {
    setShowWalletModal(false);
    onConnect(publicKey, network);
  };

  const handleModalControl = (isOpen: boolean) => {
    setShowWalletModal(isOpen);
  };
  return <div className="flex-1 flex flex-col bg-background">
      <AppHeader
        right={
          <Button variant="outline" size="sm" asChild>
            <a href="https://github.com/tupui/stellar-stratum/issues" target="_blank" rel="noopener noreferrer">
              Support
            </a>
          </Button>
        }
      />

      {/* phone: the summit, then the words; desktop: the words beside the summit */}
      <Wrap className="flex flex-1 flex-col gap-4 pb-8 pt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:gap-16 lg:py-12">
        <picture className="flex justify-center lg:order-2">
          <source media="(min-width: 1024px)" srcSet={`${BRAND}summit-desktop.svg`} width={440} height={357} />
          <img
            src={`${BRAND}summit-phone.svg`}
            alt=""
            width={358}
            height={246}
            className="crt-on h-auto max-w-full"
          />
        </picture>

        <div className="flex flex-col gap-4 lg:gap-6">
          <div className="mt-2 flex flex-col gap-3 lg:mt-0 lg:gap-6">
            <span className="font-pix text-xl leading-none tracking-[0.02em] text-muted-foreground">
              Multi-Signature Transactions Made Simple
            </span>
            <h1 className="font-pix text-[64px] font-normal leading-[0.9] tracking-[0.005em] min-[1120px]:text-[88px]">
              Nobody summits<br className="hidden lg:inline" /> alone.
            </h1>
          </div>

          <p className="lede lg:max-w-[560px]">
            Stellar's threshold-based authorization system. Configure signature weights, manage signer permissions,
            and execute secure multi-signature transactions.
          </p>

          <div className="mt-1 flex flex-col gap-3 lg:mt-2 lg:flex-row">
            <Button className="w-full lg:w-auto lg:min-w-[220px]" onClick={() => setShowWalletModal(true)}>
              Connect Wallet
            </Button>
            <Button
              variant="outline"
              className="w-full lg:w-auto lg:min-w-[220px]"
              onClick={() => openExternal(`${import.meta.env.BASE_URL}sign`)}
            >
              Air-gapped Signer
            </Button>
          </div>
        </div>
      </Wrap>

      {/* Wallet Connect Modal */}
      <Dialog open={showWalletModal} onOpenChange={setShowWalletModal}>
        {/* the close button sits in the title row, as on the board */}
        <DialogContent className="sm:max-w-md [&>button:last-child]:top-7 sm:[&>button:last-child]:right-6 sm:[&>button:last-child]:top-6">
          <DialogHeader className="min-h-11 justify-center">
            <DialogTitle>Connect Wallet</DialogTitle>
            <DialogDescription className="sr-only">
              Select a wallet provider to connect to your Stellar account
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner />
                <span className="text-[15px]">Loading wallets...</span>
              </div>
            </div>}>
            <WalletConnect onConnect={handleConnect} onModalControl={handleModalControl} />
          </Suspense>
        </DialogContent>
      </Dialog>
    </div>;
};
