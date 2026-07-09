import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ContractAddressInput } from './ContractAddressInput';
import { ContractFunctionForm } from './ContractFunctionForm';
import {
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
}

export const ContractCallTab = ({
  accountPublicKey,
  network,
  onBuild,
  isBuilding,
  isTransactionBuilt,
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
      setError(e instanceof Error ? e.message : 'Failed to load contract');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRecent = (id: string) => {
    setAddress(id);
  };

  const handleRemoveRecent = (id: string) => {
    removeRecentContract(network, id);
    setRecents(getRecentContracts(network));
  };

  return (
    <div className="space-y-4">
      <ContractAddressInput
        value={address}
        onChange={setAddress}
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

      {loaded && loaded.functions.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Function</Label>
              <Select value={selectedFn} onValueChange={setSelectedFn}>
                <SelectTrigger>
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

            {selectedFn && (
              <ContractFunctionForm
                key={`${loaded.contractId}:${selectedFn}`}
                loaded={loaded}
                functionName={selectedFn}
                publicKey={accountPublicKey}
                onBuild={onBuild}
                isBuilding={isBuilding}
                isTransactionBuilt={isTransactionBuilt}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
