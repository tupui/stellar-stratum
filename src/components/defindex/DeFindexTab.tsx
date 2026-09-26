import { useState, useEffect } from 'react';
import { Decimal } from 'decimal.js';
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
import { spendableBalance } from '@/lib/balance-utils';
import { apiAmount, apiErrorMessage } from '@/lib/protocols/api';
import { formatUnits, parseUnits, SHARE_DECIMALS } from '@/lib/protocols/tokens';
import { verifyProtocolTransaction, withExpiry } from '@/lib/protocols/verify';

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
  /** Called whenever an input that shapes the transaction changes: a transaction built before no longer matches the form. */
  onClearTransaction?: () => void;
}

const VAULT = appConfig.DEFINDEX_VAULT_ADDRESS;

/** The vault's underlying USDC is a Stellar Asset Contract: 7 decimals. */
const USDC_DECIMALS = 7;

/**
 * A vault balance from the API (JSON numbers), in contract units; 0 when
 * unreadable. A fractional number is truncated rather than rejected.
 */
const readAmount = (value: unknown): bigint => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return BigInt(Math.trunc(value));
  try {
    return apiAmount(value);
  } catch {
    return 0n;
  }
};

const formatShort = (raw: bigint, decimals = USDC_DECIMALS) => Number(formatUnits(raw, decimals)).toFixed(2);

export const DeFindexTab = (props: DeFindexTabProps) =>
  props.network === 'testnet' ? <MainnetOnly /> : <DeFindexVault {...props} />;

const MainnetOnly = () => (
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

const DeFindexVault = ({
  accountPublicKey,
  accountData,
  network,
  onBuild,
  isBuilding,
  isTransactionBuilt,
  onClearTransaction,
}: DeFindexTabProps) => {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [vaultInfo, setVaultInfo] = useState<VaultInfoResponse | null>(null);
  const [vaultBalance, setVaultBalance] = useState<VaultBalanceResponse | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isBuildingTx, setIsBuildingTx] = useState(false);
  const [error, setError] = useState('');

  // Fetch vault info and balance on mount
  useEffect(() => {
    const fetchVaultData = async () => {
      setIsLoadingInfo(true);
      setError('');
      try {
        const [info, balance] = await Promise.all([
          defindexSDK.getVaultInfo(VAULT, SupportedNetworks.MAINNET),
          defindexSDK.getVaultBalance(VAULT, accountPublicKey, SupportedNetworks.MAINNET),
        ]);
        setVaultInfo(info);
        setVaultBalance(balance);
      } catch (err) {
        setError(apiErrorMessage(err, 'Failed to load vault data'));
      } finally {
        setIsLoadingInfo(false);
      }
    };

    if (accountPublicKey) {
      fetchVaultData();
    }
  }, [accountPublicKey]);

  // Circle's USDC only: anyone can issue an asset called "USDC"
  const walletUsdc = accountData
    ? parseUnits(
        spendableBalance(accountData, 'USDC', appConfig.USDC_ISSUER_MAINNET).toFixed(USDC_DECIMALS, Decimal.ROUND_DOWN),
        USDC_DECIMALS
      ) ?? 0n
    : 0n;

  // Underlying USDC deposited in the vault, and the shares that represent it
  const depositedUsdc = readAmount(vaultBalance?.underlyingBalance?.[0] ?? 0);
  const shares = readAmount(vaultBalance?.dfTokens ?? 0);

  const raw = parseUnits(amount, USDC_DECIMALS);

  const handleBuild = async () => {
    setError('');
    if (!raw || raw <= 0n) {
      setError(`Enter an amount greater than 0, with at most ${USDC_DECIMALS} decimal places`);
      return;
    }
    setIsBuildingTx(true);

    try {
      let xdr: string;
      if (mode === 'deposit') {
        if (raw > walletUsdc) {
          setError('Amount exceeds wallet USDC balance');
          return;
        }
        const response = await defindexSDK.depositToVault(
          VAULT,
          { amounts: [Number(raw)], invest: false, caller: accountPublicKey },
          SupportedNetworks.MAINNET
        );
        // The API returns deposits that never expire
        xdr = withExpiry(response.xdr, network);
        verifyProtocolTransaction(xdr, network, accountPublicKey, {
          kind: 'vault-deposit',
          vault: VAULT,
          amounts: [raw],
          invest: false,
        });
      } else {
        if (raw > depositedUsdc) {
          setError('Amount exceeds your vault deposit');
          return;
        }
        // Redeem shares rather than an amount: the whole position leaves no dust,
        // and a share count is something the transaction can be checked against.
        const redeem = raw === depositedUsdc ? shares : (raw * shares) / depositedUsdc;
        const response = await defindexSDK.withdrawShares(
          VAULT,
          { shares: Number(redeem), caller: accountPublicKey },
          SupportedNetworks.MAINNET
        );
        xdr = withExpiry(response.xdr, network);
        verifyProtocolTransaction(xdr, network, accountPublicKey, {
          kind: 'vault-withdraw',
          vault: VAULT,
          shares: redeem,
        });
      }
      onBuild(xdr);
    } catch (err) {
      setError(apiErrorMessage(err, `Failed to build ${mode} transaction`));
    } finally {
      setIsBuildingTx(false);
    }
  };

  const maxAmount = mode === 'deposit' ? walletUsdc : depositedUsdc;

  const updateAmount = (value: string) => {
    setAmount(value);
    onClearTransaction?.();
  };

  const selectMode = (next: 'deposit' | 'withdraw') => {
    setMode(next);
    setError('');
    updateAmount('');
  };

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

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Wallet USDC</p>
                  <p className="font-mono">{formatShort(walletUsdc)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Deposited (USDC)</p>
                  <p className="font-mono font-semibold text-primary">
                    {vaultBalance ? formatShort(depositedUsdc) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vault Shares</p>
                  <p className="font-mono">
                    {vaultBalance ? formatShort(shares, SHARE_DECIMALS) : '—'}
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
          onClick={() => selectMode('deposit')}
        >
          <ArrowDownToLine className="w-4 h-4 mr-1" />
          Deposit
        </Button>
        <Button
          variant={mode === 'withdraw' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => selectMode('withdraw')}
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
            onClick={() => updateAmount(formatUnits(maxAmount, USDC_DECIMALS))}
          >
            Max: {formatShort(maxAmount)}
          </Button>
        </div>
        <Input
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => updateAmount(e.target.value)}
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
        disabled={loading || !raw || isTransactionBuilt}
      >
        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {mode === 'deposit' ? 'Build Deposit' : 'Build Withdraw'}
      </Button>
    </div>
  );
};
