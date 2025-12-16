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
  Eye,
  EyeOff 
} from 'lucide-react';
import { ThresholdInfoTooltip } from './ThresholdInfoTooltip';
import { useToast } from '@/hooks/use-toast';
import { isValidPublicKey, sanitizeError } from '@/lib/validation';
import { 
  Transaction, 
  TransactionBuilder as StellarTransactionBuilder,
  Networks,
  Operation,
  Horizon
} from '@stellar/stellar-sdk';
import { createHorizonServer, getNetworkPassphrase } from '@/lib/stellar';
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
}: MultisigConfigBuilderProps) => {
  const { toast } = useToast();
  const { network: currentNetwork } = useNetwork();
  
  // State for new configuration
  const [editableSigners, setEditableSigners] = useState<EditableSigner[]>([]);
  const [newThresholds, setNewThresholds] = useState<Thresholds>(currentThresholds);
  const [isBuilding, setIsBuilding] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const validateConfiguration = (): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Calculate final signer configuration
    const finalSigners = editableSigners.filter(s => s.weight > 0);

    // CRITICAL: Validate all signer public keys
    finalSigners.forEach((signer, index) => {
      if (!isValidPublicKey(signer.key)) {
        errors.push(`Signer ${index + 1} has an invalid public key format`);
      }
    });

    // CRITICAL: Check for duplicate signer keys
    const signerKeys = finalSigners.map(s => s.key);
    const duplicateKeys = signerKeys.filter((key, index) => signerKeys.indexOf(key) !== index);
    if (duplicateKeys.length > 0) {
      errors.push('Duplicate signer keys are not allowed');
    }

    // Check maximum signers limit (20)
    if (finalSigners.length > 20) {
      errors.push('Cannot have more than 20 signers');
    }

    // Check minimum signers
    if (finalSigners.length === 0) {
      errors.push('Account must have at least one signer');
    }

    // Calculate total weight
    const totalWeight = finalSigners.reduce((sum, s) => sum + s.weight, 0);

    // Check thresholds vs available weight
    if (newThresholds.low_threshold > totalWeight) {
      errors.push(`Low threshold (${newThresholds.low_threshold}) exceeds total weight (${totalWeight})`);
    }
    if (newThresholds.med_threshold > totalWeight) {
      errors.push(`Medium threshold (${newThresholds.med_threshold}) exceeds total weight (${totalWeight})`);
    }
    if (newThresholds.high_threshold > totalWeight) {
      errors.push(`High threshold (${newThresholds.high_threshold}) exceeds total weight (${totalWeight})`);
    }

    // Check threshold order
    if (newThresholds.low_threshold > newThresholds.med_threshold) {
      errors.push('Low threshold cannot be higher than medium threshold');
    }
    if (newThresholds.med_threshold > newThresholds.high_threshold) {
      errors.push('Medium threshold cannot be higher than high threshold');
    }

    // Warning: removing current account
    const currentAccountSigner = finalSigners.find(s => s.key === accountPublicKey);
    if (!currentAccountSigner || currentAccountSigner.weight === 0) {
      warnings.push('You are removing the current account as a signer');
    }

    // Check for potential lockout scenarios
    // Note: In multisig, what matters is the sum of weights from signers who sign together,
    // not individual signer weights. Multiple signers can combine their weights to meet thresholds.
    
    // Warn if total available weight is insufficient (this would create a lockout)
    if (totalWeight < newThresholds.high_threshold && newThresholds.high_threshold > 0) {
      errors.push(`Total signer weight (${totalWeight}) is less than high threshold (${newThresholds.high_threshold}). This will lock the account.`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
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
      // Determine network and Horizon server
      const networkPassphrase = getNetworkPassphrase(currentNetwork);
      const server = createHorizonServer(currentNetwork);

      // Load source account
      const sourceAccount = await server.loadAccount(accountPublicKey);
      
      // Create transaction builder
      const transaction = new StellarTransactionBuilder(sourceAccount, {
        fee: '100000', // 0.01 XLM
        networkPassphrase,
      });

      // Add operations for signer changes
      editableSigners.forEach(signer => {
        const currentSigner = currentSigners.find(s => s.key === signer.key);
        
        // If it's a new signer or weight changed
        if (!currentSigner || currentSigner.weight !== signer.weight) {
          transaction.addOperation(Operation.setOptions({
            signer: {
              ed25519PublicKey: signer.key,
              weight: signer.weight
            }
          }));
        }
      });

      // Add operations to remove signers (those not in editableSigners anymore)
      currentSigners.forEach(currentSigner => {
        const stillExists = editableSigners.some(s => s.key === currentSigner.key);
        if (!stillExists) {
          transaction.addOperation(Operation.setOptions({
            signer: {
              ed25519PublicKey: currentSigner.key,
              weight: 0 // Setting weight to 0 removes the signer
            }
          }));
        }
      });

      // Add threshold changes if needed
      const hasThresholdChanges = 
        newThresholds.low_threshold !== currentThresholds.low_threshold ||
        newThresholds.med_threshold !== currentThresholds.med_threshold ||
        newThresholds.high_threshold !== currentThresholds.high_threshold;

      if (hasThresholdChanges) {
        transaction.addOperation(Operation.setOptions({
          lowThreshold: newThresholds.low_threshold,
          medThreshold: newThresholds.med_threshold,
          highThreshold: newThresholds.high_threshold
        }));
      }

      // Set timeout
      transaction.setTimeout(86400);

      // Build the transaction
      const builtTransaction = transaction.build();
      const xdr = builtTransaction.toXDR();

      // Transaction built successfully
      onXdrGenerated(xdr);
      if (onPendingCreated) onPendingCreated('', xdr);
      
      toast({
        title: "Multisig configuration built",
        description: "Transaction is ready for signing",
        duration: 2000,
      });
    } catch (error) {
      const { userMessage, fullError } = sanitizeError(error);
      toast({
        title: "Build failed",
        description: userMessage,
        variant: "destructive",
      });
    } finally {
      setIsBuilding(false);
    }
  };

  const validation = validateConfiguration();
  
  // Check for changes
  const signersChanged = editableSigners.length !== currentSigners.length ||
    editableSigners.some(editable => {
      const current = currentSigners.find(c => c.key === editable.key);
      return !current || current.weight !== editable.weight;
    });
  
  const thresholdsChanged = JSON.stringify(newThresholds) !== JSON.stringify(currentThresholds);
  const hasChanges = signersChanged || thresholdsChanged;

  

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <p className="text-muted-foreground">
          Modify account signers and operation thresholds. This requires high threshold approval.
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
                            <Badge variant="outline">Current Account</Badge>
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
                onChange={(e) => setNewSignerKey(e.target.value)}
                className="font-address text-xs sm:text-sm h-8"
                maxLength={56}
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