import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Users, 
  Shield, 
  Plus, 
  Trash2, 
  AlertTriangle, 
  CheckCircle,
  Info,
} from 'lucide-react';
import { ThresholdInfoTooltip } from './ThresholdInfoTooltip';
import { useToast } from '@/hooks/use-toast';
import { isValidPublicKey } from '@/lib/validation';
import { TransactionBuilder as StellarTransactionBuilder } from '@stellar/stellar-sdk';
import { createHorizonServer, getNetworkPassphrase } from '@/lib/stellar';
import { appConfig } from '@/lib/appConfig';
import { planConfigChange, sameConfig, validateConfig } from '@/lib/multisig';
import { useNetwork } from '@/contexts/NetworkContext';

interface Signer {
  key: string;
  weight: number;
  type: string;
}

interface Thresholds {
  low_threshold: number;
  med_threshold: number;
  high_threshold: number;
}

interface MultisigConfigBuilderProps {
  accountPublicKey: string;
  currentSigners: Signer[];
  currentThresholds: Thresholds;
  onXdrGenerated: (xdr: string) => void;
  onPendingCreated?: (id: string, xdr: string) => void;
  onAccountRefresh?: () => Promise<void>;
}

interface EditableSigner {
  key: string;
  weight: number;
  isNew: boolean;
  originalWeight?: number;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export const MultisigConfigBuilder = ({ 
  accountPublicKey, 
  currentSigners, 
  currentThresholds,
  onXdrGenerated,
  onPendingCreated,
  onAccountRefresh,
}: MultisigConfigBuilderProps) => {
  const { toast } = useToast();
  const { network: currentNetwork } = useNetwork();
  
  // State for new configuration
  const [editableSigners, setEditableSigners] = useState<EditableSigner[]>([]);
  const [newThresholds, setNewThresholds] = useState<Thresholds>(currentThresholds);
  const [isBuilding, setIsBuilding] = useState(false);

  // Form state for adding new signers
  const [newSignerKey, setNewSignerKey] = useState('');
  const [newSignerWeight, setNewSignerWeight] = useState(1);

  // Reset form when current data changes
  useEffect(() => {
    setEditableSigners(currentSigners.map(s => ({ ...s, isNew: false, originalWeight: s.weight })));
    setNewThresholds(currentThresholds);
    setNewSignerKey('');
    setNewSignerWeight(1);
  }, [currentSigners, currentThresholds]);

  const currentConfig = { signers: currentSigners, thresholds: currentThresholds };
  const nextConfig = { signers: editableSigners, thresholds: newThresholds };

  const validateConfiguration = (): ValidationResult => {
    const { errors, warnings } = validateConfig(accountPublicKey, nextConfig);
    return { isValid: errors.length === 0, errors, warnings };
  };

  const addNewSigner = () => {
    if (!newSignerKey.trim()) {
      toast({
        title: "Invalid signer key",
        description: "Please enter a valid Stellar public key",
        variant: "destructive",
      });
      return;
    }

    // Basic validation for Stellar public key format
    if (!isValidPublicKey(newSignerKey)) {
      toast({
        title: "Invalid public key format",
        description: "Public key must start with 'G' and be 56 characters long",
        variant: "destructive",
      });
      return;
    }

    if (newSignerKey === accountPublicKey) {
      toast({
        title: "This is the account's own key",
        description: "Change the weight of the Current Account row instead.",
        variant: "destructive",
      });
      return;
    }

    // Check if signer already exists
    const alreadyExists = editableSigners.some(s => s.key === newSignerKey);
    
    if (alreadyExists) {
      toast({
        title: "Signer already exists",
        description: "This signer is already in the list",
        variant: "destructive",
      });
      return;
    }

    setEditableSigners(prev => [...prev, { key: newSignerKey, weight: newSignerWeight, isNew: true }]);
    setNewSignerKey('');
    setNewSignerWeight(1);
  };

  const removeSigner = (index: number) => {
    setEditableSigners(prev => prev.filter((_, i) => i !== index));
  };

  const updateSignerWeight = (index: number, weight: number) => {
    setEditableSigners(prev => prev.map((signer, i) => 
      i === index ? { ...signer, weight } : signer
    ));
  };

  const buildTransaction = async () => {
    const validation = validateConfiguration();
    if (!validation.isValid) {
      toast({
        title: "Configuration invalid",
        description: validation.errors[0],
        variant: "destructive",
      });
      return;
    }

    setIsBuilding(true);
    try {
      const networkPassphrase = getNetworkPassphrase(currentNetwork);
      const sourceAccount = await createHorizonServer(currentNetwork).loadAccount(accountPublicKey);

      // The change is computed against what the page shows. If another signer changed the
      // account in the meantime, the lockout check above would be wrong: start over instead.
      const live = { signers: sourceAccount.signers, thresholds: sourceAccount.thresholds };
      if (!sameConfig(live, currentConfig)) {
        toast({
          title: "Configuration changed on the network",
          description: "The signers or thresholds changed since this page loaded. The latest configuration was loaded; review your changes again.",
          variant: "destructive",
        });
        await onAccountRefresh?.();
        return;
      }

      const operations = planConfigChange(accountPublicKey, currentConfig, nextConfig);
      if (operations.length === 0) {
        toast({ title: "Nothing to change", description: "The new configuration is the same as the current one." });
        return;
      }

      const transaction = new StellarTransactionBuilder(sourceAccount, {
        fee: appConfig.DEFAULT_BASE_FEE_STROOPS.toString(),
        networkPassphrase,
      });
      operations.forEach((operation) => transaction.addOperation(operation));
      const xdr = transaction.setTimeout(appConfig.TX_VALIDITY_SECONDS).build().toXDR();

      onXdrGenerated(xdr);
      if (onPendingCreated) onPendingCreated('', xdr);
      
      toast({
        title: "Multisig configuration built",
        description: "Transaction is ready for signing",
        duration: 2000,
      });
    } catch (error) {
      toast({
        title: "Build failed",
        description: error instanceof Error ? error.message : "Could not build the configuration change",
        variant: "destructive",
      });
    } finally {
      setIsBuilding(false);
    }
  };

  const validation = validateConfiguration();
  
  // Check for changes
  const hasChanges = !sameConfig(nextConfig, currentConfig);


  

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <p className="text-muted-foreground">
          Modify account signers and operation thresholds. This change needs signatures worth at least{' '}
          <span className="font-semibold">{Math.max(currentThresholds.high_threshold, 1)}</span> (the current high threshold).
        </p>
      </div>

      {/* Safety Alert */}
      <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
        <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-500 mb-1">Operating</p>
          <p className="text-sm text-red-500">
            Changing multisig configuration can lock you out of your account. 
            Ensure thresholds don't exceed available signer weights and that you maintain access to sufficient signers.
          </p>
        </div>
      </div>

      {/* Current Configuration */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 whitespace-nowrap text-base sm:text-lg">
            <Users className="w-5 h-5" />
            Current Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Signers */}
          <div>
            <h4 className="font-medium mb-2">Current Signers</h4>
            <div className="space-y-2">
              {currentSigners.map((signer, index) => (
                <div 
                  key={index} 
                  className="flex items-center justify-between p-3 rounded-lg border bg-secondary/30 border-border"
                >
                  <div className="flex-1">
                    <p className="font-address text-sm break-all">{signer.key}</p>
                    <div className="flex gap-2 mt-1">
                      {signer.key === accountPublicKey && (
                        <Badge variant="outline" className="text-xs">Current Account</Badge>
                      )}
                      <Badge variant="outline" className="text-xs">Weight: {signer.weight}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Current Thresholds */}
          <div>
            <h4 className="font-medium mb-2">Current Thresholds</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Low</p>
                <p className="text-lg font-semibold font-amount">{currentThresholds.low_threshold}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Medium</p>
                <p className="text-lg font-semibold font-amount">{currentThresholds.med_threshold}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">High</p>
                <p className="text-lg font-semibold font-amount">{currentThresholds.high_threshold}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signers Configuration */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 whitespace-nowrap text-base sm:text-lg">
            <Users className="w-5 h-5" />
            Signers
          </CardTitle>
          <CardDescription>
            Modify signer weights or add new signers. Set weight to 0 to remove a signer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing/Editable Signers */}
          {editableSigners.length > 0 && (
            <div className="space-y-2">
              {editableSigners.map((signer, index) => {
                const isModified = !signer.isNew && signer.originalWeight !== undefined && signer.weight !== signer.originalWeight;
                return (
                  <div 
                    key={index}
                    className={`p-3 rounded-lg border transition-smooth ${
                      signer.isNew
                        ? 'bg-green-500/10 border-green-500/30'
                        : isModified
                        ? 'bg-orange-500/10 border-orange-500/30'
                        : 'bg-secondary/30 border-border'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="min-w-0">
                        <p className="font-address text-sm break-all">{signer.key}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Weight</span>
                          <Input
                            id={`weight-${index}`}
                            aria-label={`Weight for signer ${index + 1}`}
                            type="number"
                            min="0"
                            max="255"
                            value={signer.weight}
                            onChange={(e) => {
                              const value = parseInt(e.target.value);
                              if (isNaN(value) || value < 0) {
                                updateSignerWeight(index, 0);
                              } else if (value > 255) {
                                updateSignerWeight(index, 255);
                              } else {
                                updateSignerWeight(index, value);
                              }
                            }}
                            className="w-20 h-10 text-center text-sm"
                          />
                        </div>
                        <Button
                          aria-label="Remove signer"
                          variant="destructive"
                          size="icon"
                          onClick={() => removeSigner(index)}
                          className="h-10 w-10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                        <div className="flex gap-2 flex-wrap text-xs mt-1">
                          {signer.key === accountPublicKey && (
                            <Badge variant="outline">Current Account (master key)</Badge>
                          )}
                          {signer.key[0] !== 'G' && (
                            <Badge variant="outline">{{ T: 'Pre-authorised tx', X: 'Hash(x)', P: 'Signed payload' }[signer.key[0]] ?? 'Signer'}</Badge>
                          )}
                          {signer.isNew && (
                            <Badge variant="outline" className="bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30">New</Badge>
                          )}
                          {isModified && (
                            <Badge variant="outline" className="bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/30">Modified</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add New Signer (mobile responsive layout) */}
          <div className="p-3 rounded-lg border border-border bg-secondary/20">
            <div className="space-y-2">
              <Input
                id="new-signer-key"
                placeholder="GABC...XYZ"
                value={newSignerKey}
                onChange={(e) => setNewSignerKey(e.target.value.trim())}
                className="font-address text-xs sm:text-sm h-8"
              />
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Weight</span>
                  <Input
                    aria-label="New signer weight"
                    id="new-signer-weight"
                    type="number"
                    min="1"
                    max="255"
                    value={newSignerWeight}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (isNaN(value) || value < 1) {
                        setNewSignerWeight(1);
                      } else if (value > 255) {
                        setNewSignerWeight(255);
                      } else {
                        setNewSignerWeight(value);
                      }
                    }}
                    className="w-20 h-10 text-center text-sm"
                  />
                </div>
                <Button
                  onClick={addNewSigner}
                  disabled={!newSignerKey.trim()}
                  className="h-10 px-3"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Threshold Configuration */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2 whitespace-nowrap text-base sm:text-lg">
              <Shield className="w-6 h-6" />
              Operation Thresholds
            </div>
            <ThresholdInfoTooltip />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="lowThreshold">Low</Label>
              <Input
                id="lowThreshold"
                type="number"
                min="0"
                max="255"
                value={newThresholds.low_threshold}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (isNaN(value) || value < 0) {
                    setNewThresholds(prev => ({ ...prev, low_threshold: 0 }));
                  } else if (value > 255) {
                    setNewThresholds(prev => ({ ...prev, low_threshold: 255 }));
                  } else {
                    setNewThresholds(prev => ({ ...prev, low_threshold: value }));
                  }
                }}
              />
            </div>
            <div>
              <Label htmlFor="medThreshold">Medium</Label>
              <Input
                id="medThreshold"
                type="number"
                min="0"
                max="255"
                value={newThresholds.med_threshold}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (isNaN(value) || value < 0) {
                    setNewThresholds(prev => ({ ...prev, med_threshold: 0 }));
                  } else if (value > 255) {
                    setNewThresholds(prev => ({ ...prev, med_threshold: 255 }));
                  } else {
                    setNewThresholds(prev => ({ ...prev, med_threshold: value }));
                  }
                }}
              />
            </div>
            <div>
              <Label htmlFor="highThreshold">High</Label>
              <Input
                id="highThreshold"
                type="number"
                min="0"
                max="255"
                value={newThresholds.high_threshold}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (isNaN(value) || value < 0) {
                    setNewThresholds(prev => ({ ...prev, high_threshold: 0 }));
                  } else if (value > 255) {
                    setNewThresholds(prev => ({ ...prev, high_threshold: 255 }));
                  } else {
                    setNewThresholds(prev => ({ ...prev, high_threshold: value }));
                  }
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Validation Results */}
      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-2">
        {validation.errors.map((error, index) => (
          <Alert key={index} variant="destructive" className="border-destructive/50 bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <AlertDescription className="text-destructive">{error}</AlertDescription>
          </Alert>
        ))}
        {validation.warnings.map((warning, index) => (
          <Alert key={index} className="border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <AlertDescription className="text-destructive">{warning}</AlertDescription>
          </Alert>
        ))}
        </div>
      )}

      {/* Build Button */}
      {hasChanges && (
        <div className="flex justify-end">
          <Button 
            onClick={buildTransaction}
            disabled={!validation.isValid || isBuilding}
            className="!bg-stellar-yellow !text-black hover:!bg-stellar-yellow/90"
          >
            {isBuilding ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Building...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Build Configuration Transaction
              </div>
            )}
          </Button>
        </div>
      )}

      {!hasChanges && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Make changes to signers or thresholds to generate a configuration transaction.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};