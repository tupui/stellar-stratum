import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Users, CheckCircle, Circle, Plus, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { useWalletKit } from '@/contexts/WalletKitContext';
import { THRESHOLD_LABELS } from '@/lib/xdr/interpret';
import type { SignatureRequirement, SignerInfo } from '@/lib/signatures';

interface SignerSelectorProps {
  /** Signers of every account the transaction involves (weight > 0). */
  signers: SignerInfo[];
  requirements: SignatureRequirement[];
  currentAccountKey: string;
  onSignWithSigner: (signerKey: string, walletId: string) => Promise<void>;
  isSigning: boolean;
  /** Signers of another involved account are still being loaded. */
  loading?: boolean;
}

const truncateKey = (key: string) => `${key.slice(0, 8)}...${key.slice(-8)}`;

export const SignerSelector = ({
  signers,
  requirements,
  currentAccountKey,
  onSignWithSigner,
  isSigning,
  loading = false,
}: SignerSelectorProps) => {
  const { wallets: allWallets } = useWalletKit();
  const wallets = allWallets.filter((w) => w.isAvailable);
  const [selectedSigner, setSelectedSigner] = useState<string>('');
  const [selectedWalletId, setSelectedWalletId] = useState<string>('');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Only signatures that verify against this transaction count.
  const signedKeys = new Set(requirements.flatMap((r) => r.signedBy));
  const signedSigners = signers.filter((s) => signedKeys.has(s.key));
  const availableSigners = signers.filter((s) => !signedKeys.has(s.key) && s.key.startsWith('G'));
  const unknownAccounts = requirements.filter((r) => !r.known);
  const ready = !loading && requirements.length > 0 && requirements.every((r) => r.known && r.weight >= r.threshold);
  const multipleAccounts = requirements.length > 1;

  const handleSign = async () => {
    if (!selectedSigner || !selectedWalletId) return;
    await onSignWithSigner(selectedSigner, selectedWalletId);
    setSelectedSigner('');
    setSelectedWalletId('');
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base sm:text-lg whitespace-nowrap flex items-center gap-2">
              <Users className="w-4 h-4" />
              Signature Management
            </CardTitle>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {requirements.map((req) => (
                <Badge
                  key={`${req.account}-${req.level}`}
                  variant={req.known && req.weight >= req.threshold ? 'default' : 'secondary'}
                  title={`${THRESHOLD_LABELS[req.level].name} threshold of ${req.account}`}
                >
                  {multipleAccounts && <span className="font-address mr-1">{req.account.slice(0, 4)}…{req.account.slice(-4)}</span>}
                  Weight: <span className="font-amount ml-1">{req.known ? `${req.weight}/${req.threshold}` : '?'}</span>
                </Badge>
              ))}
              <Badge variant="outline">
                {signedSigners.length} of {signers.length} signers
              </Badge>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setIsCollapsed(!isCollapsed)} className="shrink-0 ml-2">
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {!isCollapsed && (
        <CardContent className="space-y-4">
          {loading && <p className="text-sm text-muted-foreground">Loading the signers of the accounts this transaction uses…</p>}
          {unknownAccounts.map((req) => (
            <div key={req.account} className="p-3 bg-warning/10 border border-warning/30 rounded-lg flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <p className="text-sm text-foreground">
                Could not load the signers of <span className="font-address">{truncateKey(req.account)}</span>, so its
                signatures cannot be checked. Make sure the account exists on this network.
              </p>
            </div>
          ))}

          <div className="space-y-3">
            <h4 className="text-sm font-medium">Current Signatures</h4>
            {signedSigners.length === 0 ? (
              <p className="text-sm text-muted-foreground">No signatures yet</p>
            ) : (
              signedSigners.map((signer) => (
                <div key={signer.key} className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-4">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <div>
                      <p className="font-address text-sm">{truncateKey(signer.key)}</p>
                      {signer.key === currentAccountKey && (
                        <Badge variant="outline" className="text-xs mt-1">Current Account</Badge>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline">
                    Weight: <span className="font-amount">{signer.weight}</span>
                  </Badge>
                </div>
              ))
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <h4 className="text-sm font-medium">Available Signers</h4>
            {availableSigners.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {signers.length === 0 ? 'No signers to show' : 'All signers have signed'}
              </p>
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
                            {signer.key === currentAccountKey && (
                              <Badge variant="outline" className="text-xs ml-4">Current</Badge>
                            )}
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

                  <Button onClick={handleSign} disabled={!selectedSigner || !selectedWalletId || isSigning} size="sm">
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
                        Weight: <span className="font-amount">{signer.weight}</span>
                      </Badge>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {ready && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <p className="text-sm text-foreground">Minimum signature weight reached. Transaction can be submitted.</p>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
};
