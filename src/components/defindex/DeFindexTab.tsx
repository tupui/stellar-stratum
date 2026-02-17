import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, Landmark, ArrowDownToLine, ArrowUpFromLine, Loader2 } from 'lucide-react';
import { defindexSDK } from '@/lib/defindex-client';
import { SupportedNetworks, VaultInfoResponse, VaultBalanceResponse } from '@defindex/sdk';
import { appConfig } from '@/lib/appConfig';

interface DeFindexTabProps {
  accountPublicKey: string;
  accountData: {
    balances: Array<{
      asset_type: string;
      asset_code?: string;
      asset_issuer?: string;
      balance: string;
    }>;
  } | null;
  network: 'mainnet' | 'testnet';
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
}

export const DeFindexTab = ({
  accountPublicKey,
  accountData,
  network,
  onBuild,
  isBuilding,
  isTransactionBuilt,
}: DeFindexTabProps) => {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [vaultInfo, setVaultInfo] = useState<VaultInfoResponse | null>(null);
  const [vaultBalance, setVaultBalance] = useState<VaultBalanceResponse | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isBuildingTx, setIsBuildingTx] = useState(false);
  const [error, setError] = useState('');

  // Testnet guard
  if (network === 'testnet') {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3 text-muted-foreground">
            <Info className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-foreground">Mainnet Only</p>
              <p className="text-sm mt-1">
                DeFindex vaults are only available on Mainnet. Switch to Mainnet to access vault operations.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Fetch vault info and balance on mount (mainnet only)
  useEffect(() => {
    const fetchVaultData = async () => {
      setIsLoadingInfo(true);
      setError('');
      try {
        const [info, balance] = await Promise.all([
          defindexSDK.getVaultInfo(appConfig.DEFINDEX_VAULT_ADDRESS, SupportedNetworks.MAINNET),
          defindexSDK.getVaultBalance(appConfig.DEFINDEX_VAULT_ADDRESS, accountPublicKey, SupportedNetworks.MAINNET),
        ]);
        setVaultInfo(info);
        setVaultBalance(balance);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load vault data');
      } finally {
        setIsLoadingInfo(false);
      }
    };

    if (accountPublicKey) {
      fetchVaultData();
    }
  }, [accountPublicKey]);

  const walletUsdcBalance = accountData?.balances.find(
    (b) => b.asset_code === 'USDC'
  )?.balance ?? '0';

  const handleBuild = async () => {
    setError('');
    setIsBuildingTx(true);

    try {
      const stroops = Math.floor(parseFloat(amount) * 10_000_000);
      if (stroops <= 0) {
        setError('Amount must be greater than 0');
        return;
      }

      if (mode === 'deposit') {
        if (parseFloat(amount) > parseFloat(walletUsdcBalance)) {
          setError('Amount exceeds wallet USDC balance');
          return;
        }
        const response = await defindexSDK.depositToVault(
          appConfig.DEFINDEX_VAULT_ADDRESS,
          { amounts: [stroops], invest: false, caller: accountPublicKey },
          SupportedNetworks.MAINNET
        );
        onBuild(response.xdr);
      } else {
        const response = await defindexSDK.withdrawFromVault(
          appConfig.DEFINDEX_VAULT_ADDRESS,
          { amounts: [stroops], caller: accountPublicKey },
          SupportedNetworks.MAINNET
        );
        onBuild(response.xdr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to build ${mode} transaction`);
    } finally {
      setIsBuildingTx(false);
    }
  };

  const maxAmount = mode === 'deposit'
    ? walletUsdcBalance
    : vaultBalance?.underlyingBalance?.[0]
      ? (vaultBalance.underlyingBalance[0] / 10_000_000).toFixed(7)
      : '0';

  const loading = isBuildingTx || isBuilding;

  return (
    <div className="space-y-4">
      {/* Vault Info Header */}
      <Card>
        <CardContent className="pt-4 pb-4">
          {isLoadingInfo ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading vault info...</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-primary" />
                  <span className="font-medium">{appConfig.DEFINDEX_VAULT_NAME}</span>
                </div>
                {vaultInfo?.apy !== undefined && (
                  <Badge variant="secondary" className="text-xs">
                    {vaultInfo.apy.toFixed(2)}% APY
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Wallet USDC</p>
                  <p className="font-mono">{parseFloat(walletUsdcBalance).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vault Shares</p>
                  <p className="font-mono">
                    {vaultBalance ? vaultBalance.dfTokens.toLocaleString() : '—'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deposit / Withdraw Toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'deposit' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => { setMode('deposit'); setAmount(''); setError(''); }}
        >
          <ArrowDownToLine className="w-4 h-4 mr-1" />
          Deposit
        </Button>
        <Button
          variant={mode === 'withdraw' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => { setMode('withdraw'); setAmount(''); setError(''); }}
        >
          <ArrowUpFromLine className="w-4 h-4 mr-1" />
          Withdraw
        </Button>
      </div>

      {/* Amount Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Amount (USDC)</Label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setAmount(maxAmount)}
          >
            Max: {parseFloat(maxAmount).toFixed(2)}
          </Button>
        </div>
        <Input
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="0"
          step="0.01"
        />
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      {/* Build Button */}
      <Button
        className="w-full"
        onClick={handleBuild}
        disabled={loading || !amount || parseFloat(amount) <= 0 || isTransactionBuilt}
      >
        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {mode === 'deposit' ? 'Build Deposit' : 'Build Withdraw'}
      </Button>
    </div>
  );
};
