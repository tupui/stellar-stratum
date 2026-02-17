import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowDownUp, Plus, Minus, Loader2, RefreshCw } from 'lucide-react';
import { soroswapSDK, getSoroswapNetwork } from '@/lib/soroswap-client';
import {
  SupportedAssetLists,
  SupportedProtocols,
  TradeType,
  type AssetInfo,
  type QuoteResponse,
  type UserPositionResponse,
  type Pool,
} from '@soroswap/sdk';

interface SoroswapTabProps {
  accountPublicKey: string;
  network: 'mainnet' | 'testnet';
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
}

type Operation = 'swap' | 'addLiquidity' | 'removeLiquidity';

export const SoroswapTab = ({
  accountPublicKey,
  network,
  onBuild,
  isBuilding,
  isTransactionBuilt,
}: SoroswapTabProps) => {
  const [operation, setOperation] = useState<Operation>('swap');
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [error, setError] = useState('');

  const xlmContract = network === 'mainnet'
    ? 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA'
    : 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

  const xlmAsset: AssetInfo = {
    code: 'XLM',
    name: 'Stellar Lumens',
    contract: xlmContract,
    decimals: 7,
  };

  // Fetch asset list on mount / network change
  useEffect(() => {
    const fetchAssets = async () => {
      setIsLoadingAssets(true);
      try {
        const list = await soroswapSDK.getAssetList(SupportedAssetLists.SOROSWAP);
        if ('assets' in list) {
          const hasXlm = list.assets.some((a) => a.contract === xlmContract);
          setAssets(hasXlm ? list.assets : [xlmAsset, ...list.assets]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load asset list');
      } finally {
        setIsLoadingAssets(false);
      }
    };
    fetchAssets();
  }, [network, xlmContract]);

  if (isLoadingAssets) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-sm">Loading assets...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Operation Toggle */}
      <div className="flex gap-2">
        <Button
          variant={operation === 'swap' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => { setOperation('swap'); setError(''); }}
        >
          <ArrowDownUp className="w-4 h-4 mr-1" />
          Swap
        </Button>
        <Button
          variant={operation === 'addLiquidity' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => { setOperation('addLiquidity'); setError(''); }}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Liquidity
        </Button>
        <Button
          variant={operation === 'removeLiquidity' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => { setOperation('removeLiquidity'); setError(''); }}
        >
          <Minus className="w-4 h-4 mr-1" />
          Remove
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      {operation === 'swap' && (
        <SwapForm
          assets={assets}
          network={network}
          accountPublicKey={accountPublicKey}
          onBuild={onBuild}
          isBuilding={isBuilding}
          isTransactionBuilt={isTransactionBuilt}
          onError={setError}
        />
      )}
      {operation === 'addLiquidity' && (
        <AddLiquidityForm
          assets={assets}
          network={network}
          accountPublicKey={accountPublicKey}
          onBuild={onBuild}
          isBuilding={isBuilding}
          isTransactionBuilt={isTransactionBuilt}
          onError={setError}
        />
      )}
      {operation === 'removeLiquidity' && (
        <RemoveLiquidityForm
          network={network}
          accountPublicKey={accountPublicKey}
          onBuild={onBuild}
          isBuilding={isBuilding}
          isTransactionBuilt={isTransactionBuilt}
          onError={setError}
        />
      )}
    </div>
  );
};

// --- Swap Sub-Form ---

interface SwapFormProps {
  assets: AssetInfo[];
  network: 'mainnet' | 'testnet';
  accountPublicKey: string;
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
  onError: (error: string) => void;
}

const SwapForm = ({ assets, network, accountPublicKey, onBuild, isBuilding, isTransactionBuilt, onError }: SwapFormProps) => {
  const [assetIn, setAssetIn] = useState('');
  const [assetOut, setAssetOut] = useState('');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState('50');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isBuildingTx, setIsBuildingTx] = useState(false);

  const selectedIn = assets.find((a) => a.contract === assetIn);
  const selectedOut = assets.find((a) => a.contract === assetOut);

  const handleQuote = async () => {
    onError('');
    setQuote(null);

    if (!assetIn || !assetOut || !amount) {
      onError('Select both assets and enter an amount');
      return;
    }
    if (assetIn === assetOut) {
      onError('Select different assets');
      return;
    }

    setIsQuoting(true);
    try {
      const decimals = selectedIn?.decimals ?? 7;
      const stroops = BigInt(Math.floor(parseFloat(amount) * 10 ** decimals));
      const result = await soroswapSDK.quote(
        {
          assetIn,
          assetOut,
          amount: stroops,
          tradeType: TradeType.EXACT_IN,
          protocols: [SupportedProtocols.SOROSWAP, SupportedProtocols.AQUA],
          slippageBps: parseInt(slippageBps) || 50,
        },
        getSoroswapNetwork(network)
      );
      setQuote(result);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to get quote');
    } finally {
      setIsQuoting(false);
    }
  };

  const handleBuild = async () => {
    if (!quote) return;
    onError('');
    setIsBuildingTx(true);
    try {
      const buildResponse = await soroswapSDK.build(
        { quote, from: accountPublicKey },
        getSoroswapNetwork(network)
      );
      onBuild(buildResponse.xdr);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to build swap transaction');
    } finally {
      setIsBuildingTx(false);
    }
  };

  const loading = isBuildingTx || isBuilding;
  const outDecimals = selectedOut?.decimals ?? 7;

  return (
    <div className="space-y-4">
      {/* Asset In */}
      <div className="space-y-2">
        <Label>From</Label>
        <Select value={assetIn} onValueChange={(v) => { setAssetIn(v); setQuote(null); }}>
          <SelectTrigger>
            <SelectValue placeholder="Select token" />
          </SelectTrigger>
          <SelectContent>
            {assets.map((a) => (
              <SelectItem key={a.contract} value={a.contract!}>
                {a.code || a.name || a.contract}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Asset Out */}
      <div className="space-y-2">
        <Label>To</Label>
        <Select value={assetOut} onValueChange={(v) => { setAssetOut(v); setQuote(null); }}>
          <SelectTrigger>
            <SelectValue placeholder="Select token" />
          </SelectTrigger>
          <SelectContent>
            {assets.map((a) => (
              <SelectItem key={a.contract} value={a.contract!}>
                {a.code || a.name || a.contract}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Amount */}
      <div className="space-y-2">
        <Label>Amount</Label>
        <Input
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setQuote(null); }}
          min="0"
          step="0.0000001"
        />
      </div>

      {/* Slippage */}
      <div className="space-y-2">
        <Label>Slippage (bps)</Label>
        <Input
          type="number"
          value={slippageBps}
          onChange={(e) => setSlippageBps(e.target.value)}
          min="1"
          max="1000"
          step="1"
        />
        <p className="text-xs text-muted-foreground">{(parseInt(slippageBps) / 100 || 0).toFixed(2)}%</p>
      </div>

      {/* Get Quote */}
      <Button
        variant="outline"
        className="w-full"
        onClick={handleQuote}
        disabled={isQuoting || !assetIn || !assetOut || !amount}
      >
        {isQuoting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        <RefreshCw className="w-4 h-4 mr-2" />
        Get Quote
      </Button>

      {/* Quote Results */}
      {quote && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected output</span>
              <span className="font-mono">
                {(Number(quote.amountOut) / 10 ** outDecimals).toFixed(7)} {selectedOut?.code || ''}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Price impact</span>
              <span className="font-mono">{quote.priceImpactPct}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Route</span>
              <span>{quote.routePlan.length} hop{quote.routePlan.length !== 1 ? 's' : ''}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Build Transaction */}
      {quote && (
        <Button
          className="w-full"
          onClick={handleBuild}
          disabled={loading || isTransactionBuilt}
        >
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Build Swap Transaction
        </Button>
      )}
    </div>
  );
};

// --- Add Liquidity Sub-Form ---

interface LiquidityFormProps {
  assets: AssetInfo[];
  network: 'mainnet' | 'testnet';
  accountPublicKey: string;
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
  onError: (error: string) => void;
}

const AddLiquidityForm = ({ assets, network, accountPublicKey, onBuild, isBuilding, isTransactionBuilt, onError }: LiquidityFormProps) => {
  const [assetA, setAssetA] = useState('');
  const [assetB, setAssetB] = useState('');
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [poolInfo, setPoolInfo] = useState<Pool | null>(null);
  const [isLoadingPool, setIsLoadingPool] = useState(false);
  const [isBuildingTx, setIsBuildingTx] = useState(false);

  // Fetch pool when both assets are selected
  useEffect(() => {
    if (!assetA || !assetB || assetA === assetB) {
      setPoolInfo(null);
      return;
    }

    const fetchPool = async () => {
      setIsLoadingPool(true);
      onError('');
      try {
        const pools = await soroswapSDK.getPoolByTokens(
          assetA,
          assetB,
          getSoroswapNetwork(network),
          [SupportedProtocols.SOROSWAP]
        );
        if (pools.length > 0) {
          setPoolInfo(pools[0]);
        } else {
          setPoolInfo(null);
          onError('No pool found for this pair');
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load pool info');
      } finally {
        setIsLoadingPool(false);
      }
    };
    fetchPool();
  }, [assetA, assetB, network, onError]);

  // Auto-calculate amount B from pool ratio
  useEffect(() => {
    if (!poolInfo || !amountA || parseFloat(amountA) <= 0) {
      setAmountB('');
      return;
    }
    const ratio = Number(poolInfo.reserveB) / Number(poolInfo.reserveA);
    const calculated = (parseFloat(amountA) * ratio).toFixed(7);
    setAmountB(calculated);
  }, [amountA, poolInfo]);

  const handleBuild = async () => {
    onError('');
    if (!assetA || !assetB || !amountA || !amountB) {
      onError('Fill in all fields');
      return;
    }

    setIsBuildingTx(true);
    try {
      const response = await soroswapSDK.addLiquidity(
        {
          assetA,
          assetB,
          amountA: BigInt(Math.floor(parseFloat(amountA) * 10_000_000)),
          amountB: BigInt(Math.floor(parseFloat(amountB) * 10_000_000)),
          to: accountPublicKey,
          slippageBps: '100',
        },
        getSoroswapNetwork(network)
      );
      onBuild(response.xdr);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to build add liquidity transaction');
    } finally {
      setIsBuildingTx(false);
    }
  };

  const loading = isBuildingTx || isBuilding;
  const selectedA = assets.find((a) => a.contract === assetA);
  const selectedB = assets.find((a) => a.contract === assetB);

  return (
    <div className="space-y-4">
      {/* Asset A */}
      <div className="space-y-2">
        <Label>Asset A</Label>
        <Select value={assetA} onValueChange={(v) => { setAssetA(v); setAmountA(''); }}>
          <SelectTrigger>
            <SelectValue placeholder="Select token" />
          </SelectTrigger>
          <SelectContent>
            {assets.map((a) => (
              <SelectItem key={a.contract} value={a.contract!}>
                {a.code || a.name || a.contract}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Asset B */}
      <div className="space-y-2">
        <Label>Asset B</Label>
        <Select value={assetB} onValueChange={(v) => { setAssetB(v); setAmountA(''); }}>
          <SelectTrigger>
            <SelectValue placeholder="Select token" />
          </SelectTrigger>
          <SelectContent>
            {assets.map((a) => (
              <SelectItem key={a.contract} value={a.contract!}>
                {a.code || a.name || a.contract}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Pool Info */}
      {isLoadingPool && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading pool...
        </div>
      )}
      {poolInfo && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reserve A</span>
              <span className="font-mono">{(Number(poolInfo.reserveA) / 10_000_000).toFixed(2)} {selectedA?.code || ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reserve B</span>
              <span className="font-mono">{(Number(poolInfo.reserveB) / 10_000_000).toFixed(2)} {selectedB?.code || ''}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Amount A */}
      <div className="space-y-2">
        <Label>Amount A {selectedA?.code ? `(${selectedA.code})` : ''}</Label>
        <Input
          type="number"
          placeholder="0.00"
          value={amountA}
          onChange={(e) => setAmountA(e.target.value)}
          min="0"
          step="0.0000001"
        />
      </div>

      {/* Amount B (auto-calculated) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label>Amount B {selectedB?.code ? `(${selectedB.code})` : ''}</Label>
          {poolInfo && <Badge variant="secondary" className="text-xs">Auto</Badge>}
        </div>
        <Input
          type="number"
          placeholder="0.00"
          value={amountB}
          onChange={(e) => setAmountB(e.target.value)}
          min="0"
          step="0.0000001"
          disabled={!!poolInfo}
        />
      </div>

      {/* Build */}
      <Button
        className="w-full"
        onClick={handleBuild}
        disabled={loading || !amountA || !amountB || !assetA || !assetB || isTransactionBuilt}
      >
        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Build Add Liquidity Transaction
      </Button>
    </div>
  );
};

// --- Remove Liquidity Sub-Form ---

interface RemoveLiquidityFormProps {
  network: 'mainnet' | 'testnet';
  accountPublicKey: string;
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
  onError: (error: string) => void;
}

const RemoveLiquidityForm = ({ network, accountPublicKey, onBuild, isBuilding, isTransactionBuilt, onError }: RemoveLiquidityFormProps) => {
  const [positions, setPositions] = useState<UserPositionResponse[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [lpAmount, setLpAmount] = useState('');
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [isBuildingTx, setIsBuildingTx] = useState(false);

  useEffect(() => {
    const fetchPositions = async () => {
      setIsLoadingPositions(true);
      onError('');
      try {
        const result = await soroswapSDK.getUserPositions(
          accountPublicKey,
          getSoroswapNetwork(network)
        );
        setPositions(result);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load positions');
      } finally {
        setIsLoadingPositions(false);
      }
    };

    if (accountPublicKey) {
      fetchPositions();
    }
  }, [accountPublicKey, network, onError]);

  const selectedPosition = selectedIndex !== null ? positions[selectedIndex] : null;

  const handleBuild = async () => {
    if (!selectedPosition || !lpAmount) return;
    onError('');
    setIsBuildingTx(true);
    try {
      const response = await soroswapSDK.removeLiquidity(
        {
          assetA: selectedPosition.poolInformation.tokenA.address,
          assetB: selectedPosition.poolInformation.tokenB.address,
          liquidity: BigInt(Math.floor(parseFloat(lpAmount) * 10_000_000)),
          amountA: BigInt(0),
          amountB: BigInt(0),
          to: accountPublicKey,
          slippageBps: '100',
        },
        getSoroswapNetwork(network)
      );
      onBuild(response.xdr);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to build remove liquidity transaction');
    } finally {
      setIsBuildingTx(false);
    }
  };

  const loading = isBuildingTx || isBuilding;

  if (isLoadingPositions) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading positions...</span>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 text-center text-muted-foreground text-sm">
          No liquidity positions found for this account.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Positions List */}
      <div className="space-y-2">
        <Label>Select Position</Label>
        <div className="space-y-2">
          {positions.map((pos, i) => (
            <Card
              key={pos.poolInformation.address}
              className={`cursor-pointer transition-colors ${selectedIndex === i ? 'border-primary' : 'hover:border-primary/50'}`}
              onClick={() => { setSelectedIndex(i); setLpAmount(''); }}
            >
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {pos.poolInformation.tokenA.symbol}/{pos.poolInformation.tokenB.symbol}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {pos.poolInformation.protocol}
                    </Badge>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {pos.userShares.toLocaleString()} shares
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {(Number(pos.tokenAAmountEquivalent) / 10_000_000).toFixed(4)} {pos.poolInformation.tokenA.symbol}
                  {' / '}
                  {(Number(pos.tokenBAmountEquivalent) / 10_000_000).toFixed(4)} {pos.poolInformation.tokenB.symbol}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* LP Amount */}
      {selectedPosition && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>LP Amount</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => setLpAmount((selectedPosition.userShares / 10_000_000).toFixed(7))}
            >
              Max: {(selectedPosition.userShares / 10_000_000).toFixed(4)}
            </Button>
          </div>
          <Input
            type="number"
            placeholder="0.00"
            value={lpAmount}
            onChange={(e) => setLpAmount(e.target.value)}
            min="0"
            step="0.0000001"
          />
        </div>
      )}

      {/* Build */}
      {selectedPosition && (
        <Button
          className="w-full"
          onClick={handleBuild}
          disabled={loading || !lpAmount || parseFloat(lpAmount) <= 0 || isTransactionBuilt}
        >
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Build Remove Liquidity Transaction
        </Button>
      )}
    </div>
  );
};
