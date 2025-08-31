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
import { useToast } from '@/hooks/use-toast';
import { 
  Transaction, 
  TransactionBuilder as StellarTransactionBuilder,
  Networks,
  Operation,
  Horizon
} from '@stellar/stellar-sdk';

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
  currentNetwork: 'mainnet' | 'testnet';
  onXdrGenerated: (xdr: string) => void;
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
  currentNetwork,
  onXdrGenerated 
}: MultisigConfigBuilderProps) => {
  const { toast } = useToast();
  
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

    // Check if current account will have enough weight for high threshold operations
    if (currentAccountSigner && currentAccountSigner.weight < newThresholds.high_threshold) {
      warnings.push('Current account alone cannot meet high threshold requirement');
    }

    // Check for potential lockout
    const canMeetHighThreshold = finalSigners.some(s => s.weight >= newThresholds.high_threshold) ||
      finalSigners.reduce((max, s) => Math.max(max, s.weight), 0) >= newThresholds.high_threshold;
    
    if (!canMeetHighThreshold && newThresholds.high_threshold > 1) {
      warnings.push('No single signer can meet the high threshold requirement');
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
    if (!newSignerKey.startsWith('G') || newSignerKey.length !== 56) {
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
      const networkPassphrase = currentNetwork === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
      const server = currentNetwork === 'testnet'
        ? new Horizon.Server('https://horizon-testnet.stellar.org')
        : new Horizon.Server('https://horizon.stellar.org');

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
      
      onXdrGenerated(xdr);
      
      toast({
        title: "Multisig configuration built",
        description: "Transaction is ready for signing",
        duration: 2000,
      });
    } catch (error) {
      console.error('Build error:', error);
      toast({
        title: "Build failed",
        description: error instanceof Error ? error.message : "Failed to build transaction",
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
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6" />
          Multisig Configuration
        </h2>
        <p className="text-muted-foreground">
          Modify account signers and operation thresholds. This requires high threshold approval.
        </p>
      </div>

      {/* Safety Alert */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Important:</strong> Changing multisig configuration can lock you out of your account. 
          Ensure thresholds don't exceed available signer weights and that you maintain access to sufficient signers.
        </AlertDescription>
      </Alert>

      {/* Current Configuration */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Current Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Signers */}
          <div>
            <h4 className="font-medium mb-2">Current Signers ({currentSigners.length}/20)</h4>
            <div className="space-y-2">
              {currentSigners.map((signer, index) => (
                <div 
                  key={index} 
                  className="flex items-center justify-between p-3 rounded-lg border bg-secondary/30 border-border"
                >
                  <div className="flex-1">
                    <p className="font-mono text-sm break-all">{signer.key}</p>
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
                <p className="text-lg font-semibold">{currentThresholds.low_threshold}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Medium</p>
                <p className="text-lg font-semibold">{currentThresholds.med_threshold}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">High</p>
                <p className="text-lg font-semibold">{currentThresholds.high_threshold}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signers Configuration */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Signers ({editableSigners.length}/20)
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
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      signer.isNew 
                        ? 'bg-green-500/10 border-green-500/20' 
                        : isModified
                        ? 'bg-orange-500/10 border-orange-500/20'
                        : 'bg-secondary/30 border-border'
                    }`}
                  >
                    <div className="flex-1">
                      <p className="font-mono text-sm break-all">{signer.key}</p>
                      <div className="flex gap-2 mt-1">
                        {signer.key === accountPublicKey && (
                          <Badge variant="outline" className="text-xs">Current Account</Badge>
                        )}
                        {signer.isNew && (
                          <Badge variant="outline" className="text-xs bg-green-500/20 text-green-700 dark:text-green-300">New</Badge>
                        )}
                        {isModified && (
                          <Badge variant="outline" className="text-xs bg-orange-500/20 text-orange-700 dark:text-orange-300">Modified</Badge>
                        )}
                      </div>
                    </div>
                    <div className="w-24">
                      <Label htmlFor={`weight-${index}`} className="text-xs">Weight</Label>
                      <Input
                        id={`weight-${index}`}
                        type="number"
                        min="0"
                        max="255"
                        value={signer.weight}
                        onChange={(e) => updateSignerWeight(index, parseInt(e.target.value) || 0)}
                        className="text-center"
                      />
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removeSigner(index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add New Signer */}
          <Separator />
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="newSignerKey">Add New Signer</Label>
              <Input
                id="newSignerKey"
                placeholder="GABC..."
                value={newSignerKey}
                onChange={(e) => setNewSignerKey(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="w-24">
              <Label htmlFor="newSignerWeight">Weight</Label>
              <Input
                id="newSignerWeight"
                type="number"
                min="1"
                max="255"
                value={newSignerWeight}
                onChange={(e) => setNewSignerWeight(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={addNewSigner}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Threshold Configuration */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Operation Thresholds
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showAdvanced ? 'Hide' : 'Show'} Details
            </Button>
          </CardTitle>
          {showAdvanced && (
            <CardDescription>
              <div className="space-y-2 text-sm">
                <p><strong>Low threshold:</strong> Trust lines, bump sequence</p>
                <p><strong>Medium threshold:</strong> Payments, offers, manage data</p>
                <p><strong>High threshold:</strong> Account changes (like this operation), merge account</p>
              </div>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="lowThreshold">Low Threshold</Label>
              <Input
                id="lowThreshold"
                type="number"
                min="0"
                max="255"
                value={newThresholds.low_threshold}
                onChange={(e) => setNewThresholds(prev => ({ 
                  ...prev, 
                  low_threshold: parseInt(e.target.value) || 0 
                }))}
              />
            </div>
            <div>
              <Label htmlFor="medThreshold">Medium Threshold</Label>
              <Input
                id="medThreshold"
                type="number"
                min="0"
                max="255"
                value={newThresholds.med_threshold}
                onChange={(e) => setNewThresholds(prev => ({ 
                  ...prev, 
                  med_threshold: parseInt(e.target.value) || 0 
                }))}
              />
            </div>
            <div>
              <Label htmlFor="highThreshold">High Threshold</Label>
              <Input
                id="highThreshold"
                type="number"
                min="0"
                max="255"
                value={newThresholds.high_threshold}
                onChange={(e) => setNewThresholds(prev => ({ 
                  ...prev, 
                  high_threshold: parseInt(e.target.value) || 0 
                }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Validation Results */}
      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-2">
          {validation.errors.map((error, index) => (
            <Alert key={index} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ))}
          {validation.warnings.map((warning, index) => (
            <Alert key={index}>
              <Info className="h-4 w-4" />
              <AlertDescription>{warning}</AlertDescription>
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
            className="bg-gradient-primary hover:opacity-90"
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