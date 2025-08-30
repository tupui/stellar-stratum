import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Users, CheckCircle, Circle, Plus } from 'lucide-react';

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
  signers: Signer[];
  currentAccountKey: string;
  signedBy: SignedBySigner[];
  requiredWeight: number;
  onSignWithSigner: (signerKey: string) => Promise<void>;
  isSigning: boolean;
}

export const SignerSelector = ({ 
  signers, 
  currentAccountKey, 
  signedBy, 
  requiredWeight, 
  onSignWithSigner,
  isSigning 
}: SignerSelectorProps) => {
  const [selectedSigner, setSelectedSigner] = useState<string>('');

  const getCurrentWeight = () => {
    return signedBy.reduce((total, signed) => {
      const signer = signers.find(s => s.key === signed.signerKey);
      return total + (signer?.weight || 0);
    }, 0);
  };

  const getAvailableSigners = () => {
    return signers.filter(signer => 
      !signedBy.some(signed => signed.signerKey === signer.key)
    );
  };

  const isSignerSigned = (signerKey: string) => {
    return signedBy.some(signed => signed.signerKey === signerKey);
  };

  const truncateKey = (key: string) => {
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
  };

  const currentWeight = getCurrentWeight();
  const availableSigners = getAvailableSigners();
  const hasMinimumSignatures = currentWeight >= requiredWeight;

  const handleSign = async () => {
    if (selectedSigner) {
      await onSignWithSigner(selectedSigner);
      setSelectedSigner('');
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Signature Management
        </CardTitle>
        <div className="flex items-center gap-4">
          <Badge variant={hasMinimumSignatures ? 'default' : 'secondary'}>
            Weight: {currentWeight}/{requiredWeight}
          </Badge>
          <Badge variant="outline">
            {signedBy.length} of {signers.length} signers
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Signatures */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Current Signatures</h4>
          {signedBy.length === 0 ? (
            <p className="text-sm text-muted-foreground">No signatures yet</p>
          ) : (
            signedBy.map((signed, index) => {
              const signer = signers.find(s => s.key === signed.signerKey);
              return (
                <div key={index} className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <div>
                      <p className="font-mono text-sm">{truncateKey(signed.signerKey)}</p>
                      {signed.signerKey === currentAccountKey && (
                        <Badge variant="outline" className="text-xs mt-1">Current Account</Badge>
                      )}
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
              <div className="flex gap-2">
                <Select value={selectedSigner} onValueChange={setSelectedSigner}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a signer to sign with" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSigners.map((signer) => (
                      <SelectItem key={signer.key} value={signer.key}>
                        <div className="flex items-center justify-between w-full">
                          <span className="font-mono text-sm">{truncateKey(signer.key)}</span>
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
                <Button 
                  onClick={handleSign} 
                  disabled={!selectedSigner || isSigning}
                  size="sm"
                >
                  {isSigning ? (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Signing...
                    </div>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Sign
                    </>
                  )}
                </Button>
              </div>

              {/* Unsigned Signers Preview */}
              <div className="space-y-2">
                {availableSigners.map((signer) => (
                  <div key={signer.key} className="flex items-center justify-between p-2 bg-secondary/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Circle className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="font-mono text-sm">{truncateKey(signer.key)}</p>
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

        {hasMinimumSignatures && (
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm text-green-700 dark:text-green-300">
              ✓ Minimum signature weight reached. Transaction can be submitted.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};