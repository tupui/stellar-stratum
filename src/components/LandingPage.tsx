import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Shield, Layers, Users, Lock, ArrowRight, Wallet } from 'lucide-react';
import { WalletConnect } from '@/components/WalletConnect';

interface LandingPageProps {
  onConnect: (walletType: string, publicKey: string) => void;
}

export const LandingPage = ({ onConnect }: LandingPageProps) => {
  const [showWalletModal, setShowWalletModal] = useState(false);

  const handleConnect = (walletType: string, publicKey: string) => {
    setShowWalletModal(false);
    onConnect(walletType, publicKey);
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 -z-10">
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-secondary/20" />
        
        {/* Floating Geometric Shapes */}
        <div className="absolute top-20 left-20 w-32 h-32 bg-primary/5 rounded-2xl rotate-12 animate-pulse" />
        <div className="absolute top-40 right-32 w-24 h-24 bg-primary/10 rounded-full animate-pulse delay-1000" />
        <div className="absolute bottom-40 left-32 w-20 h-20 bg-primary/5 rounded-xl rotate-45 animate-pulse delay-2000" />
        <div className="absolute bottom-20 right-20 w-28 h-28 bg-primary/8 rounded-2xl -rotate-12 animate-pulse delay-500" />
        
        {/* Stratum Layers Visual */}
        <div className="absolute right-10 top-1/4 opacity-10">
          <div className="flex flex-col gap-2">
            <div className="w-48 h-2 bg-primary rounded-full" />
            <div className="w-40 h-2 bg-primary/80 rounded-full ml-4" />
            <div className="w-44 h-2 bg-primary/60 rounded-full ml-2" />
            <div className="w-36 h-2 bg-primary/40 rounded-full ml-6" />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-20 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          {/* Header */}
          <div className="mb-8">
            <Badge variant="secondary" className="mb-6 px-4 py-2 text-sm">
              <Layers className="w-4 h-4 mr-2" />
              Multi-Signature Security Protocol
            </Badge>
            
            <h1 className="text-5xl md:text-7xl font-bold leading-tight mb-6">
              <span className="text-foreground">Secure.</span>
              <br />
              <span className="text-foreground">Collaborate.</span>
              <br />
              <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                Stratum.
              </span>
            </h1>
            
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Advanced multi-signature wallet management for Stellar. Build collaborative security through 
              layered authentication and distributed transaction signing.
            </p>
          </div>

          {/* CTA Button */}
          <div className="mb-16">
            <Button
              size="lg"
              className="h-16 px-12 text-lg font-semibold bg-gradient-to-r from-primary to-primary-glow hover:shadow-glow transition-all duration-300 hover:scale-105"
              onClick={() => setShowWalletModal(true)}
            >
              <Wallet className="w-6 h-6 mr-3" />
              Connect Wallet
              <ArrowRight className="w-6 h-6 ml-3" />
            </Button>
            <p className="text-sm text-muted-foreground mt-4">
              Start building secure multi-signature transactions
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-8 mb-20">
            <div className="p-8 rounded-2xl bg-card/50 backdrop-blur border border-border/50 hover:border-primary/50 transition-colors">
              <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/10 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <Shield className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-4">Enhanced Security</h3>
              <p className="text-muted-foreground">
                Require multiple signatures for critical transactions. Distribute risk across 
                trusted signers and hardware devices.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-card/50 backdrop-blur border border-border/50 hover:border-primary/50 transition-colors">
              <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/10 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <Users className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-4">Team Coordination</h3>
              <p className="text-muted-foreground">
                Streamline collaborative signing workflows. Manage complex approval processes 
                with configurable thresholds.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-card/50 backdrop-blur border border-border/50 hover:border-primary/50 transition-colors">
              <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/10 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <Lock className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-4">Institutional Grade</h3>
              <p className="text-muted-foreground">
                Built for organizations requiring robust financial controls and 
                audit-ready transaction history.
              </p>
            </div>
          </div>

          {/* Powered by Stellar */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-4">Powered by Stellar Network</p>
            <div className="flex items-center justify-center gap-4 text-muted-foreground">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <span className="text-xs">Secure</span>
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse delay-500" />
              <span className="text-xs">Decentralized</span>
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse delay-1000" />
              <span className="text-xs">Global</span>
            </div>
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
            <DialogDescription>
              Choose your preferred method to connect and get started with Stratum.
            </DialogDescription>
          </DialogHeader>
          <WalletConnect onConnect={handleConnect} isModal />
        </DialogContent>
      </Dialog>
    </div>
  );
};