import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Info } from 'lucide-react';
import { Spinner } from '@/components/brand/Mark';
import { Notice } from '@/components/brand/Shell';
import { cn } from '@/lib/utils';
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


  

  // One threshold input; values are clamped to 0..255 as they are typed
  const thresholdField = (id: string, label: string, key: keyof Thresholds) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="field-label">{label}</label>
      <Input
        id={id}
        type="number"
        min="0"
        max="255"
        value={newThresholds[key]}
        className="font-mono"
        onChange={(e) => {
          const value = parseInt(e.target.value);
          const clamped = isNaN(value) || value < 0 ? 0 : value > 255 ? 255 : value;
          setNewThresholds(prev => ({ ...prev, [key]: clamped }));
        }}
      />
    </div>
  );

  // Phone: bare sections with full-bleed dividers. From md up: one level of panel.
  const section = 'border-t border-line md:border md:bg-ink-2';
  const sectionHead = (id: string, title: string, aside?: ReactNode) => (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <h2 id={id} className="sec">{title}</h2>
      {aside}
    </div>
  );

  return (
    <div className="flex flex-col md:gap-6">
      {/* Header */}
      <section aria-labelledby="edit-multisig" className="flex flex-col gap-4 border-t border-line p-4 md:border-0 md:p-0">
        <h2 id="edit-multisig" className="sec">Edit Multisig Configuration</h2>
        <p>
          Modify account signers and operation thresholds. This change needs signatures worth at least{' '}
          <b className="font-mono font-medium">{Math.max(currentThresholds.high_threshold, 1)}</b> (the current high threshold).
        </p>
        <Notice level="warning" title="Lockout risk">
          Changing multisig configuration can lock you out of your account.
          Ensure thresholds don't exceed available signer weights and that you maintain access to sufficient signers.
        </Notice>
      </section>

      {/* Signers */}
      <section aria-labelledby="edit-signers" className={section}>
        <div className="p-4">
          {sectionHead('edit-signers', 'Signers')}
          <p className="mt-1 text-[13px] text-muted-foreground">
            Modify signer weights or add new signers. Set weight to 0 to remove a signer.
          </p>
        </div>
        <ul>
          {editableSigners.map((signer, index) => {
            const isModified = !signer.isNew && signer.originalWeight !== undefined && signer.weight !== signer.originalWeight;
            return (
              <li key={index} className="flex flex-col gap-2 border-t border-line px-4 py-3 md:flex-row md:flex-wrap md:items-center md:gap-4">
                <span className="font-address text-[13px] break-all md:flex-1">{signer.key}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="order-last flex flex-wrap gap-2 md:order-first">
                    {signer.key === accountPublicKey && <Badge>Current Account (master key)</Badge>}
                    {signer.key[0] !== 'G' && (
                      <Badge>{{ T: 'Pre-authorized transaction', X: 'Hash(x)', P: 'Signed payload' }[signer.key[0]] ?? 'Signer'}</Badge>
                    )}
                    {signer.isNew && <Badge variant="outline">New</Badge>}
                    {isModified && <Badge variant="outline">Modified</Badge>}
                  </span>
                  <span className="field-label">Weight</span>
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
                    className="w-[72px] text-center font-mono"
                  />
                  <Button
                    aria-label="Remove signer"
                    variant="outline"
                    size="icon"
                    onClick={() => removeSigner(index)}
                    className="text-destructive hover:border-destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}

          {/* Add a signer */}
          <li className="flex flex-col gap-2 border-t border-line px-4 py-3 md:flex-row md:items-center md:gap-4">
            <Input
              id="new-signer-key"
              aria-label="New signer public key"
              placeholder="GABC...XYZ"
              value={newSignerKey}
              onChange={(e) => setNewSignerKey(e.target.value.trim())}
              className="font-address text-[13px] md:flex-1"
            />
            <div className="flex items-center gap-2">
              <span className="field-label">Weight</span>
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
                className="w-[72px] text-center font-mono"
              />
              <Button onClick={addNewSigner} disabled={!newSignerKey.trim()}>
                <Plus />
                Add
              </Button>
            </div>
          </li>
        </ul>
      </section>

      {/* Thresholds */}
      <section aria-labelledby="edit-thresholds" className={cn(section, 'p-4')}>
        {sectionHead('edit-thresholds', 'Operation Thresholds', <ThresholdInfoTooltip />)}
        <div className="mt-3 grid grid-cols-3 gap-3">
          {thresholdField('lowThreshold', 'Low', 'low_threshold')}
          {thresholdField('medThreshold', 'Medium', 'med_threshold')}
          {thresholdField('highThreshold', 'High', 'high_threshold')}
        </div>
      </section>

      {/* Validation, then the build or the hint to change something */}
      <div className="flex flex-col gap-2 border-t border-line p-4 md:border-0 md:p-0">
        {validation.errors.map((error, index) => (
          <Notice key={`e${index}`} level="error">{error}</Notice>
        ))}
        {validation.warnings.map((warning, index) => (
          <Notice key={`w${index}`} level="warning">{warning}</Notice>
        ))}
        {hasChanges ? (
          <div className="flex justify-end pt-2 [&>*]:flex-1 md:[&>*]:flex-none">
            <Button onClick={buildTransaction} disabled={!validation.isValid || isBuilding}>
              {isBuilding ? <><Spinner mono /> Building...</> : 'Build Configuration Transaction'}
            </Button>
          </div>
        ) : (
          <div role="status" className="notice">
            <Info className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>Make changes to signers or thresholds to generate a configuration transaction.</span>
          </div>
        )}
      </div>

      {/* Current Configuration */}
      <section aria-labelledby="current-configuration" className={section}>
        <div className="p-4">{sectionHead('current-configuration', 'Current Configuration')}</div>
        <h3 className="sub px-4 pb-3">Current Signers</h3>
        <ul>
          {currentSigners.map((signer, index) => (
            <li key={index} className="flex items-start gap-3 border-t border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <span className="font-address text-[13px] break-all">{signer.key}</span>
                {signer.key === accountPublicKey && <div className="mt-1"><Badge>Current Account</Badge></div>}
              </div>
              <span className="whitespace-nowrap text-right text-[13px] text-muted-foreground">Weight {signer.weight}</span>
            </li>
          ))}
        </ul>
        <h3 className="sub border-t border-line px-4 pb-3 pt-4">Current Thresholds</h3>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] [&>*]:border-t [&>*]:border-line [&>*]:px-4 [&>*]:py-2.5">
          <dt className="text-muted-foreground">Low</dt><dd className="text-right font-mono">{currentThresholds.low_threshold}</dd>
          <dt className="text-muted-foreground">Medium</dt><dd className="text-right font-mono">{currentThresholds.med_threshold}</dd>
          <dt className="text-muted-foreground">High</dt><dd className="text-right font-mono">{currentThresholds.high_threshold}</dd>
        </dl>
      </section>
    </div>
  );
};
