import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ContractAddressInput } from './ContractAddressInput';
import { ContractFunctionForm } from './ContractFunctionForm';
import {
  errorMessage,
  loadContractSpec,
  type LoadedContract,
  type NetworkType,
} from '@/lib/contract/spec';
import {
  getRecentContracts,
  pushRecentContract,
  removeRecentContract,
} from '@/lib/contract/recent-contracts';

interface ContractCallTabProps {
  accountPublicKey: string;
  network: NetworkType;
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
  /** Called whenever the contract, function or an argument changes, so a transaction built before is not signed. */
  onClearTransaction?: () => void;
}

export const ContractCallTab = ({
  accountPublicKey,
  network,
  onBuild,
  isBuilding,
  isTransactionBuilt,
  onClearTransaction,
}: ContractCallTabProps) => {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState<LoadedContract | null>(null);
  const [selectedFn, setSelectedFn] = useState('');
  const [recents, setRecents] = useState<string[]>(() => getRecentContracts(network));

  // Reset when network changes — a loaded mainnet spec is not valid on testnet.
  useEffect(() => {
    setLoaded(null);
    setSelectedFn('');
    setError('');
    setRecents(getRecentContracts(network));
  }, [network]);

  const handleLoad = async (force = false) => {
    const contractId = address.trim();
    if (!contractId) return;
    onClearTransaction?.();
    setLoading(true);
    setError('');
    setLoaded(null);
    setSelectedFn('');
    try {
      const result = await loadContractSpec(contractId, network, { force });
      setLoaded(result);
      setSelectedFn(result.functions[0] ?? '');
      pushRecentContract(network, contractId);
      setRecents(getRecentContracts(network));
    } catch (e) {
      setError(errorMessage(e, 'Failed to load contract'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFunction = (name: string) => {
    setSelectedFn(name);
    onClearTransaction?.();
  };

  // Once the address no longer names the loaded contract, its functions (and any transaction
  // built from them) must go: Build would otherwise call the old contract.
  const handleAddressChange = (value: string) => {
    setAddress(value);
    if (loaded && value.trim() !== loaded.contractId) {
      setLoaded(null);
      setSelectedFn('');
      onClearTransaction?.();
    }
  };

  const handleSelectRecent = (id: string) => {
    handleAddressChange(id);
  };

  const handleRemoveRecent = (id: string) => {
    removeRecentContract(network, id);
    setRecents(getRecentContracts(network));
  };

  return (
    <div className="flex flex-col gap-4">
      <ContractAddressInput
        value={address}
        onChange={handleAddressChange}
        onLoad={handleLoad}
        isLoading={loading}
        isLoaded={loaded !== null}
        recents={recents}
        onSelectRecent={handleSelectRecent}
        onRemoveRecent={handleRemoveRecent}
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-sm break-all">{error}</AlertDescription>
        </Alert>
      )}

      {loaded && loaded.functions.length === 0 && (
        <Alert>
          <AlertDescription className="text-sm">
            This contract exposes no invokable functions.
          </AlertDescription>
        </Alert>
      )}

      {loaded && loaded.functions.length > 0 && (() => {
        const picker = (
          <div className="flex flex-col gap-2">
            <span id="contract-function" className="text-[13px] text-muted-foreground">Function</span>
            <Select value={selectedFn} onValueChange={handleSelectFunction}>
              <SelectTrigger aria-labelledby="contract-function">
                <SelectValue placeholder="Select function" />
              </SelectTrigger>
              <SelectContent>
                {loaded.functions.map((name) => (
                  <SelectItem key={name} value={name} className="font-mono text-sm">
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
        return selectedFn ? (
          <ContractFunctionForm
            key={`${loaded.contractId}:${selectedFn}`}
            loaded={loaded}
            functionName={selectedFn}
            picker={picker}
            publicKey={accountPublicKey}
            onBuild={onBuild}
            isBuilding={isBuilding}
            isTransactionBuilt={isTransactionBuilt}
            onClearTransaction={onClearTransaction}
          />
        ) : (
          picker
        );
      })()}
    </div>
  );
};
