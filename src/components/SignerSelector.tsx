import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Users, CheckCircle, Circle, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { Transaction } from '@stellar/stellar-sdk';
import { getSupportedWallets, getNetworkPassphrase } from '@/lib/stellar';
import { useNetwork } from '@/contexts/NetworkContext';
import { ISupportedWallet } from '@creit.tech/stellar-wallets-kit';

interface Signer {
  key: string;
  weight: number;
  type: string;
}

interface SignedBySigner {
  signerKey: string;
  signedAt: Date;
}

interface SignerSelectorProps {
  xdr: string;
  signers: Signer[];
  currentAccountKey: string;
  signedBy: SignedBySigner[];
  requiredWeight: number;
  onSignWithSigner: (signerKey: string, walletId: string) => Promise<void>;
  isSigning: boolean;
}

export const SignerSelector = ({ 
  xdr,
  signers,
  currentAccountKey, 
  signedBy, 
  requiredWeight, 
  onSignWithSigner,
  isSigning 
}: SignerSelectorProps) => {
  const { network } = useNetwork();
  const [selectedSigner, setSelectedSigner] = useState<string>('');
  const [selectedWalletId, setSelectedWalletId] = useState<string>('');
  const [wallets, setWallets] = useState<ISupportedWallet[]>([]);
  const [existingSignatures, setExistingSignatures] = useState<string[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load available wallets for signing (no manual/domains here)
  useEffect(() => {
    (async () => {
      try {
        const ws = await getSupportedWallets();
        setWallets(ws.filter(w => w.isAvailable));
      } catch (e) {
        console.error('Failed to load wallets for signing:', e);
      }
    })();
  }, []);
  // Extract existing signatures from XDR
  useEffect(() => {
    try {
      const networkPassphrase = getNetworkPassphrase(network);
      const transaction = new Transaction(xdr, networkPassphrase);
      
      // Get public keys of existing signatures by checking which signers match the signature hints
      const existingSigs: string[] = [];
      transaction.signatures.forEach((sig) => {
        const hint = sig.hint();
        // Check if any of our known signers match this signature hint
        signers.forEach((signer) => {
          const signerHint = Buffer.from(signer.key.slice(-8), 'hex');
          if (hint.equals(signerHint)) {
            existingSigs.push(signer.key);
          }
        });
      });
      
      setExistingSignatures(existingSigs);
    } catch (error) {
      console.error('Error parsing XDR for signatures:', error);
      setExistingSignatures([]);
    }
  }, [xdr, network, signers]);

  const getCurrentWeight = () => {
    // Combine UI signatures with existing XDR signatures
    const allSignedKeys = [...new Set([
      ...signedBy.map(s => s.signerKey),
      ...existingSignatures
    ])];
    
    return allSignedKeys.reduce((total, signerKey) => {
      const signer = signers.find(s => s.key === signerKey);
      return total + (signer?.weight || 0);
    }, 0);
  };

  const getAvailableSigners = () => {
    const allSignedKeys = [...new Set([
      ...signedBy.map(s => s.signerKey),
      ...existingSignatures
    ])];
    
    return signers.filter(signer => 
      !allSignedKeys.includes(signer.key)
    );
  };

  const isSignerSigned = (signerKey: string) => {
    return signedBy.some(signed => signed.signerKey === signerKey) || 
           existingSignatures.includes(signerKey);
  };

  const getAllSignedSigners = () => {
    const allSignedKeys = [...new Set([
      ...signedBy.map(s => s.signerKey),
      ...existingSignatures
    ])];
    
    return allSignedKeys.map(signerKey => {
      const fromUI = signedBy.find(s => s.signerKey === signerKey);
      return {
        signerKey,
        signedAt: fromUI?.signedAt || new Date(), // Use current time for existing signatures
        isExisting: !fromUI
      };
    });
  };

  const truncateKey = (key: string) => {
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
  };

  const currentWeight = getCurrentWeight();
  const availableSigners = getAvailableSigners();
  const hasMinimumSignatures = currentWeight >= requiredWeight;

  const handleSign = async () => {
    if (selectedSigner && selectedWalletId) {
      await onSignWithSigner(selectedSigner, selectedWalletId);
      setSelectedSigner('');
      setSelectedWalletId('');
    }
  };

  return (
    <Card className="shadow-card">
      <Collapsible open={!isCollapsed} onOpenChange={(open) => setIsCollapsed(!open)}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base sm:text-lg whitespace-nowrap flex items-center gap-2">
                <Users className="w-4 h-4" />
                Signature Management
              </CardTitle>
              <div className="flex items-center gap-4 mt-2">
                <Badge variant={hasMinimumSignatures ? 'default' : 'secondary'}>
                  Weight: {currentWeight}/{requiredWeight}
                </Badge>
                <Badge variant="outline">
                  {signedBy.length} of {signers.length} signers
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="shrink-0 ml-2"
            >
              {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        {!isCollapsed && (
          <CardContent className="space-y-4">
        {/* Current Signatures */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Current Signatures</h4>
          {getAllSignedSigners().length === 0 ? (
            <p className="text-sm text-muted-foreground">No signatures yet</p>
          ) : (
            getAllSignedSigners().map((signed, index) => {
              const signer = signers.find(s => s.key === signed.signerKey);
              return (
                <div key={index} className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-4">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <div>
                      <p className="font-address text-sm">{truncateKey(signed.signerKey)}</p>
                      <div className="flex gap-2 mt-1">
                        {signed.signerKey === currentAccountKey && (
                          <Badge variant="outline" className="text-xs">Current Account</Badge>
                        )}
                        {signed.isExisting && (
                          <Badge variant="outline" className="text-xs bg-info/10 text-info border-info/30">Pre-signed</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline">
                    Weight: {signer?.weight || 0}
                  </Badge>
                </div>
              );
            })
          )}
        </div>

        <Separator />

        {/* Available Signers */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Available Signers</h4>
          {availableSigners.length === 0 ? (
            <p className="text-sm text-muted-foreground">All signers have signed</p>
          ) : (
            <>
              <div className="flex flex-col md:flex-row gap-2">
                <Select value={selectedSigner} onValueChange={setSelectedSigner}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a signer to sign with" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSigners.map((signer) => (
                      <SelectItem key={signer.key} value={signer.key}>
                        <div className="flex items-center justify-between w-full">
                          <span className="font-address text-sm">{truncateKey(signer.key)}</span>
                          <div className="flex items-center gap-2 ml-4">
                            {signer.key === currentAccountKey && (
                              <Badge variant="outline" className="text-xs">Current</Badge>
                            )}
                            <Badge variant="outline" className="text-xs">
                              Weight: {signer.weight}
                            </Badge>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                  <SelectTrigger className="flex-1 md:max-w-xs">
                    <SelectValue placeholder="Select wallet to sign" />
                  </SelectTrigger>
                  <SelectContent>
                    {wallets.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button 
                  onClick={handleSign} 
                  disabled={!selectedSigner || !selectedWalletId || isSigning}
                  size="sm"
                >
                  {isSigning ? (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Signing...
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Plus className="w-4 h-4" />
                      Sign
                    </div>
                  )}
                </Button>
              </div>

              {/* Unsigned Signers Preview */}
              <div className="space-y-2">
                {availableSigners.map((signer) => (
                  <div key={signer.key} className="flex items-center justify-between p-2 bg-secondary/30 rounded-lg">
                    <div className="flex items-center gap-4">
                      <Circle className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="font-address text-sm">{truncateKey(signer.key)}</p>
                        {signer.key === currentAccountKey && (
                          <Badge variant="outline" className="text-xs mt-1">Current Account</Badge>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline">
                      Weight: {signer.weight}
                    </Badge>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {!hasMinimumSignatures && availableSigners.length > 0 && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <div className="flex items-center gap-2">
              <Circle className="h-4 w-4 text-destructive" />
              <p className="text-sm text-destructive">
                Insufficient signatures. Need {requiredWeight - currentWeight} more weight to submit transaction.
              </p>
            </div>
          </div>
        )}

        {hasMinimumSignatures && (
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <p className="text-sm text-green-700 dark:text-green-300">
                Minimum signature weight reached. Transaction can be submitted.
              </p>
            </div>
          </div>
        )}
          </CardContent>
        )}
      </Collapsible>
    </Card>
  );
};