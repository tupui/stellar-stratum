import { useState, useEffect, useCallback } from 'react';
import { Decimal } from 'decimal.js';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowDownUp, Plus, Minus, Loader2, Settings2, Info } from 'lucide-react';
import { AssetIcon } from '@/components/AssetIcon';
import { formatBalance, spendableBalance } from '@/lib/balance-utils';
import { soroswapSDK, getSoroswapNetwork } from '@/lib/soroswap-client';
import { apiAmount, apiErrorMessage } from '@/lib/protocols/api';
import { formatUnits, parseUnits, SHARE_DECIMALS, shortenAddress } from '@/lib/protocols/tokens';
import { verifyProtocolTransaction } from '@/lib/protocols/verify';
import type { AccountData } from '@/lib/stellar';
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
  accountData?: AccountData | null;
  network: 'mainnet' | 'testnet';
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
  /** Called whenever an input that shapes the transaction changes: a transaction built before no longer matches the form. */
  onClearTransaction?: () => void;
}

type Operation = 'swap' | 'addLiquidity' | 'removeLiquidity';

// The Soroswap token list is mainnet-only, so the tab is too.
const XLM_CONTRACT = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

const XLM_ASSET: AssetInfo = {
  code: 'XLM',
  name: 'Stellar Lumens',
  contract: XLM_CONTRACT,
  decimals: 7,
};

/** Highest swap slippage the form accepts, in basis points (10%). */
const MAX_SLIPPAGE_BPS = 1000;

/** A quote older than this is refreshed before its transaction is built. */
const QUOTE_TTL_MS = 30_000;

/** Slippage the liquidity forms send to the API, in basis points. */
const LIQUIDITY_SLIPPAGE_BPS = 100n;

/**
 * The least the router may settle for on a liquidity leg. One basis point more
 * than the slippage sent to the API leaves room for its rounding of the minimums.
 */
const slippageFloor = (amount: bigint) => (amount * (10_000n - LIQUIDITY_SLIPPAGE_BPS - 1n)) / 10_000n;

/** An API amount for display; 0 when the API sent something unreadable. */
const readAmount = (value: unknown): bigint => {
  try {
    return apiAmount(value);
  } catch {
    return 0n;
  }
};

/** Rounded for reading only, never for what gets signed. */
const formatShort = (raw: bigint, decimals: number, places = 4) => Number(formatUnits(raw, decimals)).toFixed(places);

const TokenIcon = ({ asset, size = 20 }: { asset: AssetInfo; size?: number }) => {
  const [failed, setFailed] = useState(false);
  if (asset.icon && !failed) {
    return (
      <img
        src={asset.icon}
        alt={asset.code || asset.name || ''}
        width={size}
        height={size}
        className="rounded-full shrink-0"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return <AssetIcon assetCode={asset.code} assetIssuer={asset.issuer} size={size} className="shrink-0" />;
};

export const SoroswapTab = (props: SoroswapTabProps) =>
  props.network === 'testnet' ? <MainnetOnly /> : <SoroswapPanel {...props} />;

const MainnetOnly = () => (
  <Card className="border-dashed">
    <CardContent className="pt-6">
      <div className="flex items-start gap-3 text-muted-foreground">
        <Info className="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-foreground">Mainnet Only</p>
          <p className="text-sm mt-1">
            Soroswap swaps and liquidity are only available on Mainnet. Switch to Mainnet to use them.
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
);

const SoroswapPanel = ({
  accountPublicKey,
  accountData,
  network,
  onBuild,
  isBuilding,
  isTransactionBuilt,
  onClearTransaction,
}: SoroswapTabProps) => {
  const [operation, setOperation] = useState<Operation>('swap');
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [error, setError] = useState('');

  // Fetch asset list on mount
  useEffect(() => {
    const fetchAssets = async () => {
      setIsLoadingAssets(true);
      try {
        const list = await soroswapSDK.getAssetList(SupportedAssetLists.SOROSWAP);
        if ('assets' in list) {
          const hasXlm = list.assets.some((a) => a.contract === XLM_CONTRACT);
          setAssets(hasXlm ? list.assets : [XLM_ASSET, ...list.assets]);
        }
      } catch (err) {
        setError(apiErrorMessage(err, 'Failed to load asset list'));
      } finally {
        setIsLoadingAssets(false);
      }
    };
    fetchAssets();
  }, []);

  const balanceLine = (a: AssetInfo) =>
    accountData?.balances.find((b) =>
      a.contract === XLM_CONTRACT
        ? b.asset_type === 'native'
        : b.asset_code === a.code && b.asset_issuer === a.issuer
    );

  const getAssetBalance = (a: AssetInfo): number => {
    const entry = balanceLine(a);
    return entry ? parseFloat(entry.balance) : 0;
  };

  // What MAX may sell: the balance less open offers and, for XLM, the reserve and a fee margin
  const getSpendable = (a: AssetInfo): Decimal => {
    if (!accountData || !balanceLine(a)) return new Decimal(0);
    return a.contract === XLM_CONTRACT
      ? spendableBalance(accountData, 'XLM')
      : spendableBalance(accountData, a.code ?? '', a.issuer);
  };

  // A classic asset can only be received over a trustline; XLM and contract-only tokens need none
  const lacksTrustline = (a: AssetInfo) =>
    !!accountData && !!a.issuer && a.contract !== XLM_CONTRACT && !balanceLine(a);

  // Only tokens the account actually holds can be swapped from
  const fromAssets = accountData ? assets.filter((a) => getAssetBalance(a) > 0) : assets;

  const clearTransaction = () => onClearTransaction?.();

  const selectOperation = (next: Operation) => {
    setOperation(next);
    setError('');
    clearTransaction();
  };

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
          onClick={() => selectOperation('swap')}
        >
          <ArrowDownUp className="w-4 h-4 mr-1" />
          Swap
        </Button>
        <Button
          variant={operation === 'addLiquidity' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => selectOperation('addLiquidity')}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Liquidity
        </Button>
        <Button
          variant={operation === 'removeLiquidity' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => selectOperation('removeLiquidity')}
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
          fromAssets={fromAssets}
          getAssetBalance={getAssetBalance}
          getSpendable={getSpendable}
          lacksTrustline={lacksTrustline}
          network={network}
          accountPublicKey={accountPublicKey}
          onBuild={onBuild}
          isBuilding={isBuilding}
          isTransactionBuilt={isTransactionBuilt}
          onError={setError}
          onInputChange={clearTransaction}
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
          onInputChange={clearTransaction}
        />
      )}
      {operation === 'removeLiquidity' && (
        <RemoveLiquidityForm
          assets={assets}
          network={network}
          accountPublicKey={accountPublicKey}
          onBuild={onBuild}
          isBuilding={isBuilding}
          isTransactionBuilt={isTransactionBuilt}
          onError={setError}
          onInputChange={clearTransaction}
        />
      )}
    </div>
  );
};

// --- Swap Sub-Form ---

// Liquidity sources the aggregator can route a swap through. SDEX is left out:
// its routes come back as classic path payments, which the pre-signing check does not cover.
const ROUTING_PROTOCOLS: Array<{ id: SupportedProtocols; label: string }> = [
  { id: SupportedProtocols.SOROSWAP, label: 'Soroswap' },
  { id: SupportedProtocols.AQUA, label: 'Aqua' },
  { id: SupportedProtocols.PHOENIX, label: 'Phoenix' },
];

interface FormProps {
  assets: AssetInfo[];
  network: 'mainnet' | 'testnet';
  accountPublicKey: string;
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
  onError: (error: string) => void;
  /** An input that shapes the transaction changed. */
  onInputChange: () => void;
}

interface SwapFormProps extends FormProps {
  fromAssets: AssetInfo[];
  getAssetBalance: (asset: AssetInfo) => number;
  getSpendable: (asset: AssetInfo) => Decimal;
  lacksTrustline: (asset: AssetInfo) => boolean;
}

const SwapForm = ({
  assets,
  fromAssets,
  getAssetBalance,
  getSpendable,
  lacksTrustline,
  network,
  accountPublicKey,
  onBuild,
  isBuilding,
  isTransactionBuilt,
  onError,
  onInputChange,
}: SwapFormProps) => {
  const [assetIn, setAssetIn] = useState('');
  const [assetOut, setAssetOut] = useState('');
  // Which field the user last typed into decides the trade type:
  // 'sell' => EXACT_IN (buy side is computed), 'buy' => EXACT_OUT (sell side is computed)
  const [independentField, setIndependentField] = useState<'sell' | 'buy'>('sell');
  const [typedValue, setTypedValue] = useState('');
  const [slippageBps, setSlippageBps] = useState('50');
  const [protocols, setProtocols] = useState<SupportedProtocols[]>([
    SupportedProtocols.SOROSWAP,
    SupportedProtocols.AQUA,
  ]);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isBuildingTx, setIsBuildingTx] = useState(false);

  // Anything that changes the trade drops the quote and any transaction built from it
  const resetQuote = () => {
    setQuote(null);
    onInputChange();
  };

  const toggleProtocol = (id: SupportedProtocols) => {
    setProtocols((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      return next.length ? next : prev; // keep at least one source selected
    });
    resetQuote();
  };

  const selectedIn = assets.find((a) => a.contract === assetIn);
  const selectedOut = assets.find((a) => a.contract === assetOut);
  const inDecimals = selectedIn?.decimals ?? 7;
  const outDecimals = selectedOut?.decimals ?? 7;
  const inBalance = selectedIn ? getAssetBalance(selectedIn) : 0;
  const outBalance = selectedOut ? getAssetBalance(selectedOut) : 0;
  const inSpendable = selectedIn ? getSpendable(selectedIn) : new Decimal(0);
  const needsTrustline = !!selectedOut && lacksTrustline(selectedOut);

  const exactIn = independentField === 'sell';
  const typedDecimals = exactIn ? inDecimals : outDecimals;
  const typedAmount = parseUnits(typedValue, typedDecimals);
  const slippage = /^\d+$/.test(slippageBps) ? Number(slippageBps) : NaN;
  const slippageValid = slippage >= 1 && slippage <= MAX_SLIPPAGE_BPS;

  const sanitizeAmount = (raw: string) => {
    let s = raw.replace(/[^0-9.]/g, '');
    const parts = s.split('.');
    if (parts.length > 2) s = `${parts[0]}.${parts.slice(1).join('')}`;
    return s;
  };

  const handleTypeSell = (raw: string) => {
    setIndependentField('sell');
    setTypedValue(sanitizeAmount(raw));
    resetQuote();
  };
  const handleTypeBuy = (raw: string) => {
    setIndependentField('buy');
    setTypedValue(sanitizeAmount(raw));
    resetQuote();
  };

  const fetchQuote = useCallback(
    (amount: bigint) =>
      soroswapSDK.quote(
        {
          assetIn,
          assetOut,
          amount,
          tradeType: exactIn ? TradeType.EXACT_IN : TradeType.EXACT_OUT,
          protocols,
          slippageBps: slippage,
        },
        getSoroswapNetwork(network)
      ),
    [assetIn, assetOut, exactIn, protocols, slippage, network]
  );

  // Auto-quote (debounced): sell side -> EXACT_IN, buy side -> EXACT_OUT.
  // State is cleared in the type/select handlers, so the effect only schedules the fetch.
  useEffect(() => {
    if (!assetIn || !assetOut || assetIn === assetOut || !typedAmount || !slippageValid || needsTrustline) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      onError('');
      setIsQuoting(true);
      try {
        const result = await fetchQuote(typedAmount);
        if (!cancelled) {
          setQuote(result);
          setQuotedAt(Date.now());
        }
      } catch (err) {
        if (!cancelled) {
          setQuote(null);
          onError(apiErrorMessage(err, 'Failed to get quote'));
        }
      } finally {
        if (!cancelled) setIsQuoting(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [assetIn, assetOut, typedAmount, slippageValid, needsTrustline, fetchQuote, onError]);

  // The slippage bound: minimum received (EXACT_IN) or maximum sold (EXACT_OUT)
  const threshold = (q: QuoteResponse) => apiAmount(q.otherAmountThreshold);

  const handleBuild = async () => {
    if (!quote || !typedAmount) return;
    onError('');
    setIsBuildingTx(true);
    try {
      let current = quote;
      if (Date.now() - quotedAt > QUOTE_TTL_MS) {
        // Refresh an old quote; build only if its bound is no worse than the one on screen
        current = await fetchQuote(typedAmount);
        setQuote(current);
        setQuotedAt(Date.now());
        const noWorse = exactIn ? threshold(current) >= threshold(quote) : threshold(current) <= threshold(quote);
        if (!noWorse) {
          onError('The price moved since this quote. Check the new amounts, then build again.');
          return;
        }
      }
      const buildResponse = await soroswapSDK.build(
        { quote: current, from: accountPublicKey },
        getSoroswapNetwork(network)
      );
      verifyProtocolTransaction(
        buildResponse.xdr,
        network,
        accountPublicKey,
        exactIn
          ? { kind: 'swap', exact: 'in', tokenIn: assetIn, tokenOut: assetOut, amountIn: typedAmount, minOut: threshold(current) }
          : { kind: 'swap', exact: 'out', tokenIn: assetIn, tokenOut: assetOut, amountOut: typedAmount, maxIn: threshold(current) }
      );
      onBuild(buildResponse.xdr);
    } catch (err) {
      onError(apiErrorMessage(err, 'Failed to build swap transaction'));
    } finally {
      setIsBuildingTx(false);
    }
  };

  const loading = isBuildingTx || isBuilding;

  // An API amount as an exact decimal; blank when the API sent something unreadable
  const fmtUnits = (raw: unknown, decimals: number) => {
    try {
      return formatUnits(apiAmount(raw), decimals);
    } catch {
      return '';
    }
  };

  // The side the user did NOT type is computed from the quote
  const derivedSell = quote && independentField === 'buy' && quote.tradeType === TradeType.EXACT_OUT
    ? fmtUnits(quote.amountIn, inDecimals)
    : undefined;
  const derivedBuy = quote && independentField === 'sell' && quote.tradeType === TradeType.EXACT_IN
    ? fmtUnits(quote.amountOut, outDecimals)
    : undefined;

  const sellDisplay = independentField === 'sell' ? typedValue : (derivedSell ?? '');
  const buyDisplay = independentField === 'buy' ? typedValue : (derivedBuy ?? '');

  // Slippage bound from the quote
  const minReceived = quote && quote.tradeType === TradeType.EXACT_IN
    ? fmtUnits(quote.otherAmountThreshold, outDecimals)
    : undefined;
  const maxSold = quote && quote.tradeType === TradeType.EXACT_OUT
    ? fmtUnits(quote.otherAmountThreshold, inDecimals)
    : undefined;

  return (
    <div className="space-y-2">
      {/* Routing config */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Routing via {protocols.map((p) => ROUTING_PROTOCOLS.find((rp) => rp.id === p)?.label).filter(Boolean).join(', ')}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-2">
              <Settings2 className="w-4 h-4" />
              Routing
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Liquidity sources</p>
                <p className="text-xs text-muted-foreground">Choose which protocols the swap can route through.</p>
              </div>
              <div className="space-y-2">
                {ROUTING_PROTOCOLS.map((p) => {
                  const checked = protocols.includes(p.id);
                  const isLastSelected = checked && protocols.length === 1;
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 ${isLastSelected ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={isLastSelected}
                        onCheckedChange={() => toggleProtocol(p.id)}
                      />
                      <span className="text-sm">{p.label}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">At least one source must stay selected.</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* You sell */}
      <div className="space-y-2 rounded-xl border p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">You sell</Label>
          {selectedIn && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground"
              disabled={inSpendable.lte(0)}
              onClick={() => handleTypeSell(inSpendable.toDecimalPlaces(inDecimals, Decimal.ROUND_DOWN).toFixed())}
            >
              Balance: <span className="font-mono">{formatBalance(inBalance)}</span>{inSpendable.gt(0) ? ' · MAX' : ''}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={assetIn} onValueChange={(v) => { setAssetIn(v); resetQuote(); }}>
            <SelectTrigger className="w-[150px] shrink-0">
              <SelectValue placeholder="Select token">
                {selectedIn && (
                  <div className="flex items-center gap-2">
                    <TokenIcon asset={selectedIn} />
                    <span className="truncate">{selectedIn.code || selectedIn.name || selectedIn.contract}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {fromAssets.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No tokens with an active balance</div>
              )}
              {fromAssets.map((a) => (
                <SelectItem key={a.contract} value={a.contract!}>
                  <div className="flex items-center gap-2 min-w-[220px]">
                    <TokenIcon asset={a} />
                    <span className="font-medium">{a.code || a.name || a.contract}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{formatBalance(getAssetBalance(a))}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              className="text-right"
              value={sellDisplay}
              onChange={(e) => handleTypeSell(e.target.value)}
            />
            {independentField === 'buy' && isQuoting && (
              <Loader2 className="w-4 h-4 animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {/* Direction indicator */}
      <div className="flex justify-center">
        <div className="rounded-full border bg-muted/40 p-1.5">
          <ArrowDownUp className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      {/* You buy */}
      <div className="space-y-2 rounded-xl border p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">You buy</Label>
          {selectedOut && (
            <span className="text-xs text-muted-foreground">
              Balance: <span className="font-mono">{formatBalance(outBalance)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={assetOut} onValueChange={(v) => { setAssetOut(v); resetQuote(); }}>
            <SelectTrigger className="w-[150px] shrink-0">
              <SelectValue placeholder="Select token">
                {selectedOut && (
                  <div className="flex items-center gap-2">
                    <TokenIcon asset={selectedOut} />
                    <span className="truncate">{selectedOut.code || selectedOut.name || selectedOut.contract}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {assets.map((a) => (
                <SelectItem key={a.contract} value={a.contract!}>
                  <div className="flex items-center gap-2 min-w-[220px]">
                    <TokenIcon asset={a} />
                    <span>{a.code || a.name || a.contract}</span>
                    {lacksTrustline(a) && (
                      <span className="ml-auto text-xs text-muted-foreground">No trustline</span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              className="text-right"
              value={buyDisplay}
              onChange={(e) => handleTypeBuy(e.target.value)}
            />
            {independentField === 'sell' && isQuoting && (
              <Loader2 className="w-4 h-4 animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            )}
          </div>
        </div>
        {needsTrustline && selectedOut && (
          <p className="text-xs text-destructive">
            This account has no {selectedOut.code} trustline (issuer {shortenAddress(selectedOut.issuer ?? '')}).
            Add it before buying {selectedOut.code}: the swap cannot deliver it otherwise.
          </p>
        )}
      </div>

      {typedValue && typedAmount === null && (
        <p className="text-xs text-destructive">Enter an amount with at most {typedDecimals} decimal places.</p>
      )}

      {/* Slippage */}
      <div className="space-y-2 pt-2">
        <Label>Slippage (bps)</Label>
        <Input
          type="number"
          value={slippageBps}
          onChange={(e) => { setSlippageBps(e.target.value); resetQuote(); }}
          min="1"
          max={MAX_SLIPPAGE_BPS}
          step="1"
        />
        <p className={`text-xs ${slippageValid ? 'text-muted-foreground' : 'text-destructive'}`}>
          {slippageValid ? `${(slippage / 100).toFixed(2)}%` : `Enter a whole number from 1 to ${MAX_SLIPPAGE_BPS}`}
        </p>
      </div>

      {/* Quote Results */}
      {quote && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-2 text-sm">
            {minReceived !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Minimum received</span>
                <span className="font-mono">{minReceived} {selectedOut?.code || ''}</span>
              </div>
            )}
            {maxSold !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Maximum sold</span>
                <span className="font-mono">{maxSold} {selectedIn?.code || ''}</span>
              </div>
            )}
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

/**
 * A pool's reserves in the order the user picked the tokens: the API lists
 * them in contract order. Null for an empty pool or one that is not this pair.
 */
const orientReserves = (pool: Pool | null, assetA: string, assetB: string) => {
  if (!pool) return null;
  const first = readAmount(pool.reserveA);
  const second = readAmount(pool.reserveB);
  const reserves =
    pool.tokenA === assetA && pool.tokenB === assetB
      ? { a: first, b: second }
      : pool.tokenA === assetB && pool.tokenB === assetA
        ? { a: second, b: first }
        : null;
  return reserves && reserves.a > 0n && reserves.b > 0n ? reserves : null;
};

const AddLiquidityForm = ({ assets, network, accountPublicKey, onBuild, isBuilding, isTransactionBuilt, onError, onInputChange }: FormProps) => {
  const [assetA, setAssetA] = useState('');
  const [assetB, setAssetB] = useState('');
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [poolInfo, setPoolInfo] = useState<Pool | null>(null);
  const [isLoadingPool, setIsLoadingPool] = useState(false);
  const [isBuildingTx, setIsBuildingTx] = useState(false);

  // Fetch pool when both assets are selected. A pool left over from another
  // pair is harmless: orientReserves only reads the pool of the selected pair.
  useEffect(() => {
    if (!assetA || !assetB || assetA === assetB) return;

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
        setPoolInfo(null);
        onError(apiErrorMessage(err, 'Failed to load pool info'));
      } finally {
        setIsLoadingPool(false);
      }
    };
    fetchPool();
  }, [assetA, assetB, network, onError]);

  const selectedA = assets.find((a) => a.contract === assetA);
  const selectedB = assets.find((a) => a.contract === assetB);
  const decimalsA = selectedA?.decimals ?? 7;
  const decimalsB = selectedB?.decimals ?? 7;
  const reserves = orientReserves(poolInfo, assetA, assetB);

  const rawA = parseUnits(amountA, decimalsA);
  // With reserves, amount B follows the pool price exactly as the router computes it
  const rawB = reserves ? (rawA ? (rawA * reserves.b) / reserves.a : null) : parseUnits(amountB, decimalsB);
  const amountBDisplay = reserves ? (rawB !== null ? formatUnits(rawB, decimalsB) : '') : amountB;

  const selectAsset = (setAsset: (v: string) => void) => (v: string) => {
    setAsset(v);
    setAmountA('');
    setAmountB('');
    onInputChange();
  };

  const handleBuild = async () => {
    onError('');
    if (!assetA || !assetB || !rawA || !rawB) {
      onError('Fill in all fields');
      return;
    }

    setIsBuildingTx(true);
    try {
      const response = await soroswapSDK.addLiquidity(
        {
          assetA,
          assetB,
          amountA: rawA,
          amountB: rawB,
          to: accountPublicKey,
          slippageBps: LIQUIDITY_SLIPPAGE_BPS.toString(),
        },
        getSoroswapNetwork(network)
      );
      // The first deposit into an empty pool sets its price: there is none to protect
      verifyProtocolTransaction(response.xdr, network, accountPublicKey, {
        kind: 'add-liquidity',
        tokenA: assetA,
        tokenB: assetB,
        amountA: rawA,
        amountB: rawB,
        minA: reserves ? slippageFloor(rawA) : 0n,
        minB: reserves ? slippageFloor(rawB) : 0n,
      });
      onBuild(response.xdr);
    } catch (err) {
      onError(apiErrorMessage(err, 'Failed to build add liquidity transaction'));
    } finally {
      setIsBuildingTx(false);
    }
  };

  const loading = isBuildingTx || isBuilding;

  return (
    <div className="space-y-4">
      {/* Asset A */}
      <div className="space-y-2">
        <Label>Asset A</Label>
        <Select value={assetA} onValueChange={selectAsset(setAssetA)}>
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
        <Select value={assetB} onValueChange={selectAsset(setAssetB)}>
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
      {reserves && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reserve A</span>
              <span className="font-mono">{formatShort(reserves.a, decimalsA, 2)} {selectedA?.code || ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reserve B</span>
              <span className="font-mono">{formatShort(reserves.b, decimalsB, 2)} {selectedB?.code || ''}</span>
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
          onChange={(e) => { setAmountA(e.target.value); onInputChange(); }}
          min="0"
          step="any"
        />
        {amountA && rawA === null && (
          <p className="text-xs text-destructive">Enter an amount with at most {decimalsA} decimal places.</p>
        )}
      </div>

      {/* Amount B (auto-calculated from the pool price) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label>Amount B {selectedB?.code ? `(${selectedB.code})` : ''}</Label>
          {reserves && <Badge variant="secondary" className="text-xs">Auto</Badge>}
        </div>
        <Input
          type="number"
          placeholder="0.00"
          value={amountBDisplay}
          onChange={(e) => { setAmountB(e.target.value); onInputChange(); }}
          min="0"
          step="any"
          disabled={!!reserves}
        />
        {!reserves && amountB && rawB === null && (
          <p className="text-xs text-destructive">Enter an amount with at most {decimalsB} decimal places.</p>
        )}
      </div>

      {/* Build */}
      <Button
        className="w-full"
        onClick={handleBuild}
        disabled={loading || !rawA || !rawB || !assetA || !assetB || assetA === assetB || isTransactionBuilt}
      >
        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Build Add Liquidity Transaction
      </Button>
    </div>
  );
};

// --- Remove Liquidity Sub-Form ---

const RemoveLiquidityForm = ({ assets, network, accountPublicKey, onBuild, isBuilding, isTransactionBuilt, onError, onInputChange }: FormProps) => {
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
        onError(apiErrorMessage(err, 'Failed to load positions'));
      } finally {
        setIsLoadingPositions(false);
      }
    };

    if (accountPublicKey) {
      fetchPositions();
    }
  }, [accountPublicKey, network, onError]);

  const decimalsOf = (contract: string) => assets.find((a) => a.contract === contract)?.decimals ?? 7;

  const selectedPosition = selectedIndex !== null ? positions[selectedIndex] : null;
  const held = selectedPosition ? readAmount(selectedPosition.userPosition) : 0n;
  const liquidity = parseUnits(lpAmount, SHARE_DECIMALS);
  const validLiquidity = liquidity !== null && liquidity > 0n && liquidity <= held;

  const updateLpAmount = (value: string) => {
    setLpAmount(value);
    onInputChange();
  };

  const handleBuild = async () => {
    if (!selectedPosition || !validLiquidity) return;
    onError('');
    setIsBuildingTx(true);
    try {
      const pool = selectedPosition.poolInformation;
      // What the burnt shares are worth: the position's tokens, pro rata
      const expectedA = (apiAmount(selectedPosition.tokenAAmountEquivalent) * liquidity) / held;
      const expectedB = (apiAmount(selectedPosition.tokenBAmountEquivalent) * liquidity) / held;
      const response = await soroswapSDK.removeLiquidity(
        {
          assetA: pool.tokenA.address,
          assetB: pool.tokenB.address,
          liquidity,
          amountA: expectedA,
          amountB: expectedB,
          to: accountPublicKey,
          slippageBps: LIQUIDITY_SLIPPAGE_BPS.toString(),
        },
        getSoroswapNetwork(network)
      );
      verifyProtocolTransaction(response.xdr, network, accountPublicKey, {
        kind: 'remove-liquidity',
        pool: pool.address,
        tokenA: pool.tokenA.address,
        tokenB: pool.tokenB.address,
        liquidity,
        minA: slippageFloor(expectedA),
        minB: slippageFloor(expectedB),
      });
      onBuild(response.xdr);
    } catch (err) {
      onError(apiErrorMessage(err, 'Failed to build remove liquidity transaction'));
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
              onClick={() => { setSelectedIndex(i); updateLpAmount(''); }}
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
                    {formatShort(readAmount(pos.userPosition), SHARE_DECIMALS)} LP
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {formatShort(readAmount(pos.tokenAAmountEquivalent), decimalsOf(pos.poolInformation.tokenA.address))} {pos.poolInformation.tokenA.symbol}
                  {' / '}
                  {formatShort(readAmount(pos.tokenBAmountEquivalent), decimalsOf(pos.poolInformation.tokenB.address))} {pos.poolInformation.tokenB.symbol}
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
              onClick={() => updateLpAmount(formatUnits(held, SHARE_DECIMALS))}
            >
              Max: {formatShort(held, SHARE_DECIMALS)}
            </Button>
          </div>
          <Input
            type="number"
            placeholder="0.00"
            value={lpAmount}
            onChange={(e) => updateLpAmount(e.target.value)}
            min="0"
            step="0.0000001"
          />
          {lpAmount && !validLiquidity && (
            <p className="text-xs text-destructive">
              Enter up to your position, with at most {SHARE_DECIMALS} decimal places.
            </p>
          )}
        </div>
      )}

      {/* Build */}
      {selectedPosition && (
        <Button
          className="w-full"
          onClick={handleBuild}
          disabled={loading || !validLiquidity || isTransactionBuilt}
        >
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Build Remove Liquidity Transaction
        </Button>
      )}
    </div>
  );
};
