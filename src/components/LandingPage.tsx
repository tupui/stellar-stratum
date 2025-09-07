import { useState, Suspense, lazy } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Wallet, RefreshCw } from 'lucide-react';
const WalletConnect = lazy(() => import('@/components/WalletConnect').then(module => ({
  default: module.WalletConnect
})));
interface LandingPageProps {
  onConnect: (walletType: string, publicKey: string, network: 'mainnet' | 'testnet') => void;
}
export const LandingPage = ({
  onConnect
}: LandingPageProps) => {
  const [showWalletModal, setShowWalletModal] = useState(false);
  const handleConnect = (walletType: string, publicKey: string, network: 'mainnet' | 'testnet') => {
    setShowWalletModal(false);
    onConnect(walletType, publicKey, network);
  };
  return <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Subtle Background Elements */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-background to-background/50" />
        
        {/* Multi-sig layers visualization */}
        <div className="absolute right-10 top-1/3 opacity-5 rotate-12">
          <div className="flex flex-col gap-4">
            {Array.from({
            length: 5
          }).map((_, i) => <div key={i} className={`h-1 bg-stellar-yellow rounded-full`} style={{
            width: `${200 - i * 20}px`
          }} />)}
          </div>
        </div>
        
        <div className="absolute left-10 bottom-1/3 opacity-5 -rotate-12">
          <div className="flex flex-col gap-4">
            {Array.from({
            length: 4
          }).map((_, i) => <div key={i} className={`h-1 bg-stellar-yellow rounded-full`} style={{
            width: `${180 - i * 30}px`
          }} />)}
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-20 p-6">
        <div className="container mx-auto flex justify-between items-center">
          <div className="text-2xl font-bold text-stellar-yellow text-glow-yellow transition-all duration-300">Stratum</div>
          <Button variant="outline" className="border-muted-foreground/20 hover:border-stellar-yellow hover:text-stellar-yellow" asChild>
            <a href="https://github.com/tupui/stellar-stratum/issues" target="_blank" rel="noopener noreferrer">
              Support
            </a>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex items-center justify-center min-h-screen px-6 pt-24">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-6xl md:text-8xl lg:text-9xl font-black leading-none mb-8 tracking-tight">
            <span className="text-foreground">Multi-Signature</span>
            <br />
            <span className="text-foreground">Transactions</span>
            <br />
            <span className="text-stellar-yellow">Made Simple</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground max-w-4xl mx-auto mb-16 leading-relaxed">
            Stellar's threshold-based authorization system. Configure signature weights, 
            manage signer permissions, and execute secure multi-signature transactions.
          </p>

          <div className="flex flex-col sm:flex-row gap-6 justify-center items-center w-full max-w-md sm:max-w-none mx-auto">
            <Button size="lg" className="w-full sm:w-auto h-12 sm:h-16 px-8 sm:px-12 text-base sm:text-lg font-semibold bg-stellar-yellow text-black hover:bg-stellar-yellow/90 transition-all duration-300 hover:scale-105" onClick={() => setShowWalletModal(true)}>
              Connect wallet
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="w-full sm:w-auto h-12 sm:h-16 px-8 sm:px-12 text-base sm:text-lg font-semibold border-stellar-yellow text-stellar-yellow hover:bg-stellar-yellow hover:text-black transition-all duration-300 hover:scale-105"
              onClick={() => window.open('/sign', '_blank')}
            >
              Air-gapped Signer
            </Button>
          </div>

          <div className="mt-20 text-sm text-muted-foreground">
            Built on <span className="text-stellar-yellow font-medium">Stellar</span> by{' '}
            <a href="https://consulting-manao.com/" target="_blank" rel="noopener noreferrer" className="text-stellar-yellow font-medium hover:underline transition-all duration-300">
              Consulting Manao GmbH
            </a>
          </div>
        </div>
      </div>

      {/* Wallet Connect Modal */}
      <Dialog open={showWalletModal} onOpenChange={setShowWalletModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              Connect Wallet
            </DialogTitle>
            
          </DialogHeader>
          <Suspense fallback={<div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Loading wallets...</span>
              </div>
            </div>}>
            <WalletConnect onConnect={handleConnect} isModal />
          </Suspense>
        </DialogContent>
      </Dialog>
    </div>;
};