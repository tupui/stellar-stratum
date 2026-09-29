import { useState, useEffect, useCallback, useRef } from 'react';
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
import {
  checkQuote,
  checkRate,
  RATE_TOLERANCE_BPS,
  slippageFloor,
  type CheckedQuote,
  type RateCheck,
  type SwapRequest,
} from '@/lib/protocols/guards';
import { loadAccountSequence, oraclePrice, readSoroswapPool, readTokenDecimals, type PoolState } from '@/lib/protocols/onchain';
import { ASSUMED_DECIMALS, checkListedToken, formatUnits, parseUnits, SHARE_DECIMALS, shortenAddress } from '@/lib/protocols/tokens';
import { verifyProtocolTransaction, withExpiry } from '@/lib/protocols/verify';
import type { AccountData } from '@/lib/stellar';
import {
  SupportedAssetLists,
  SupportedProtocols,
  TradeType,
  type AssetInfo,
  type QuoteResponse,
  type UserPositionResponse,
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

/**
 * A token list entry once its identity was checked against its address. For a
 * Stellar Asset Contract (`sac`) the code, issuer and 7 decimals follow from
 * the address; for any other contract the list's name is only a label, and its
 * decimals are read from the contract before an amount is built.
 */
type Token = AssetInfo & { contract: string; sac: boolean };

const XLM_TOKEN: Token = {
  code: 'XLM',
  name: 'Stellar Lumens',
  contract: XLM_CONTRACT,
  decimals: 7,
  sac: true,
};

/** Keep the list entries whose identity checks out, named from what was checked. */
const checkTokenList = (list: AssetInfo[], network: 'mainnet' | 'testnet'): Token[] => {
  const seen = new Set<string>();
  return list.flatMap((asset): Token[] => {
    const checked = checkListedToken(asset, network);
    if (!checked || seen.has(checked.contract)) return [];
    seen.add(checked.contract);
    return [
      checked.sac
        ? { ...asset, contract: checked.contract, sac: true, code: checked.code, issuer: checked.issuer, decimals: checked.decimals }
        // No logo, issuer or decimals from the list for a contract nothing vouches for.
        : { code: asset.code, name: asset.name, contract: checked.contract, sac: false },
    ];
  });
};

/** How a token is named on the form: a contract the app cannot vouch for also shows its address. */
const tokenLabel = (t: Token) => {
  if (t.sac) return t.code || t.contract;
  const address = shortenAddress(t.contract, 4, 4);
  const name = t.code || t.name;
  return name ? `${name} · ${address}` : address;
};

/** Highest swap slippage the form accepts, in basis points (10%). */
const MAX_SLIPPAGE_BPS = 1000;

/** A quote older than this is refreshed before its transaction is built. */
const QUOTE_TTL_MS = 30_000;

/** Slippage the liquidity forms send to the API, in basis points. */
const LIQUIDITY_SLIPPAGE_BPS = 100n;

/**
 * Decimals for amounts that get signed: 7 for a checked Stellar Asset Contract,
 * otherwise what the token contract reports on the app's RPC, never the list.
 * Undefined while reading (or with no token), null when it could not be read.
 */
const useDecimals = (token: Token | undefined, network: 'mainnet' | 'testnet'): number | null | undefined => {
  const [read, setRead] = useState<Record<string, number | null>>({});
  const contract = token && !token.sac ? token.contract : '';
  useEffect(() => {
    if (!contract) return;
    let active = true;
    readTokenDecimals(contract, network).then(
      (decimals) => { if (active) setRead((prev) => ({ ...prev, [contract]: decimals })); },
      () => { if (active) setRead((prev) => ({ ...prev, [contract]: null })); },
    );
    return () => { active = false; };
  }, [contract, network]);
  if (!token) return undefined;
  return token.sac ? ASSUMED_DECIMALS : read[contract];
};

/** Says why amounts in a token cannot be entered yet, if they cannot. */
const DecimalsNote = ({ token, decimals }: { token: Token | undefined; decimals: number | null | undefined }) => {
  if (!token || typeof decimals === 'number') return null;
  return decimals === null ? (
    <p className="text-xs text-destructive">
      Could not read the decimals of {tokenLabel(token)} from the network, so amounts in it cannot be built.
    </p>
  ) : (
    <p className="text-xs text-muted-foreground">Reading the decimals of {tokenLabel(token)} from the network…</p>
  );
};

/** USD price of a token from the Reflector oracles; 0 when there is none, as for any contract that is not a Stellar Asset Contract. */
const priceOf = (token: Token, network: 'mainnet' | 'testnet') =>
  token.sac ? oraclePrice(token.code ?? '', token.issuer, network) : Promise.resolve(0);

/** The same, for the form: undefined while loading. */
const useOraclePrice = (token: Token | undefined, network: 'mainnet' | 'testnet'): number | undefined => {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const contract = token?.sac ? token.contract : '';
  const code = token?.code ?? '';
  const issuer = token?.issuer;
  useEffect(() => {
    if (!contract) return;
    let active = true;
    oraclePrice(code, issuer, network).then((price) => {
      if (active) setPrices((prev) => ({ ...prev, [contract]: price }));
    });
    return () => { active = false; };
  }, [contract, code, issuer, network]);
  if (!token) return undefined;
  return token.sac ? prices[contract] : 0;
};

/** A quote checked against the request, or why it does not fit it. */
const readQuote = (quote: QuoteResponse, request: SwapRequest): { quoted: CheckedQuote | null; problem: string } => {
  try {
    return { quoted: checkQuote(quote, request), problem: '' };
  } catch (err) {
    return { quoted: null, problem: apiErrorMessage(err, 'The quote cannot be read.') };
  }
};

const percent = (bps: number) => `${(Math.abs(bps) / 100).toFixed(2)}%`;

/** Why a quote's rate is refused, in the words shown on the form and in the build error. */
const rateRefusal = (shortfallBps: number) =>
  `This quote is ${percent(shortfallBps)} below the Reflector oracle price (the limit is ${percent(RATE_TOLERANCE_BPS)}). It will not be built: try a smaller amount or other routes.`;

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
  const [assets, setAssets] = useState<Token[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [error, setError] = useState('');

  // Fetch asset list on mount
  useEffect(() => {
    const fetchAssets = async () => {
      setIsLoadingAssets(true);
      try {
        const list = await soroswapSDK.getAssetList(SupportedAssetLists.SOROSWAP);
        if ('assets' in list) {
          const tokens = checkTokenList(list.assets, network);
          const hasXlm = tokens.some((a) => a.contract === XLM_CONTRACT);
          setAssets(hasXlm ? tokens : [XLM_TOKEN, ...tokens]);
        }
      } catch (err) {
        setError(apiErrorMessage(err, 'Failed to load asset list'));
      } finally {
        setIsLoadingAssets(false);
      }
    };
    fetchAssets();
  }, [network]);

  // Horizon only holds XLM and classic assets: a token's balance is the one of the
  // asset its checked Stellar Asset Contract stands for, and nothing else.
  const balanceLine = (a: Token) =>
    a.contract === XLM_CONTRACT
      ? accountData?.balances.find((b) => b.asset_type === 'native')
      : a.sac && a.issuer
        ? accountData?.balances.find((b) => b.asset_code === a.code && b.asset_issuer === a.issuer)
        : undefined;

  const getAssetBalance = (a: Token): number => {
    const entry = balanceLine(a);
    return entry ? parseFloat(entry.balance) : 0;
  };

  // What can be sold: the balance less open offers and, for XLM, the reserve and a fee margin
  const getSpendable = (a: Token): Decimal => {
    if (!accountData || !balanceLine(a)) return new Decimal(0);
    return a.contract === XLM_CONTRACT
      ? spendableBalance(accountData, 'XLM')
      : spendableBalance(accountData, a.code ?? '', a.issuer);
  };

  // A classic asset can only be received over a trustline; XLM and contract-only tokens need none
  const lacksTrustline = (a: Token) =>
    !!accountData && a.sac && !!a.issuer && a.contract !== XLM_CONTRACT && !balanceLine(a);

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
  assets: Token[];
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
  fromAssets: Token[];
  getAssetBalance: (asset: Token) => number;
  getSpendable: (asset: Token) => Decimal;
  lacksTrustline: (asset: Token) => boolean;
}

/**
 * Bumped on every edit and on unmount (another operation or tab), so a build
 * that finishes afterwards is dropped instead of loading an outdated transaction.
 */
const useEdits = () => {
  const editsRef = useRef(0);
  useEffect(() => () => { editsRef.current += 1; }, []);
  return editsRef;
};

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
  const editsRef = useEdits();

  // Anything that changes the trade drops the quote and any transaction built from it
  const resetQuote = () => {
    setQuote(null);
    editsRef.current += 1;
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
  const inDecimals = useDecimals(selectedIn, network);
  const outDecimals = useDecimals(selectedOut, network);
  const decimalsReady = typeof inDecimals === 'number' && typeof outDecimals === 'number';
  const priceIn = useOraclePrice(selectedIn, network);
  const priceOut = useOraclePrice(selectedOut, network);
  const inBalance = selectedIn ? getAssetBalance(selectedIn) : 0;
  const outBalance = selectedOut ? getAssetBalance(selectedOut) : 0;
  const inSpendable = selectedIn ? getSpendable(selectedIn) : new Decimal(0);
  const needsTrustline = !!selectedOut && lacksTrustline(selectedOut);

  const exactIn = independentField === 'sell';
  const typedDecimals = exactIn ? inDecimals : outDecimals;
  const typedAmount = typeof typedDecimals === 'number' ? parseUnits(typedValue, typedDecimals) : null;
  const slippage = /^\d+$/.test(slippageBps) ? Number(slippageBps) : NaN;
  const slippageValid = slippage >= 1 && slippage <= MAX_SLIPPAGE_BPS;
  // The most of the sold token this account can spend, in contract units
  const spendableRaw = typeof inDecimals === 'number'
    ? parseUnits(inSpendable.toDecimalPlaces(inDecimals, Decimal.ROUND_DOWN).toFixed(), inDecimals) ?? 0n
    : 0n;
  const spendableText = `${typeof inDecimals === 'number' ? formatUnits(spendableRaw, inDecimals) : '0'} ${selectedIn ? tokenLabel(selectedIn) : ''}`;

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
    if (!assetIn || !assetOut || assetIn === assetOut || !typedAmount || !slippageValid || needsTrustline || !decimalsReady) {
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
  }, [assetIn, assetOut, typedAmount, slippageValid, needsTrustline, decimalsReady, fetchQuote, onError]);

  const swapRequest = (amount: bigint): SwapRequest => ({
    tokenIn: assetIn,
    tokenOut: assetOut,
    exact: exactIn ? 'in' : 'out',
    amount,
    slippageBps: slippage,
  });

  // The quote as the app reads it: checked against the request, with the slippage
  // bound computed from the user's slippage rather than taken from the API.
  const { quoted, problem: quoteProblem } = quote && typedAmount
    ? readQuote(quote, swapRequest(typedAmount))
    : { quoted: null, problem: '' };

  // The quoted rate against independent oracle prices; null while those load
  const rateOf = (q: CheckedQuote, pIn: number, pOut: number): RateCheck | null =>
    decimalsReady
      ? checkRate({ raw: q.amountIn, decimals: inDecimals, price: pIn }, { raw: q.amountOut, decimals: outDecimals, price: pOut })
      : null;
  const rate = quoted && priceIn !== undefined && priceOut !== undefined ? rateOf(quoted, priceIn, priceOut) : null;

  // The most this swap may take from the account: the typed amount, or the bound when buying
  const mostSold = quoted ? (exactIn ? quoted.amountIn : quoted.bound) : null;
  const overSpendable = mostSold !== null && mostSold > spendableRaw;

  const handleBuild = async () => {
    if (!quote || !typedAmount || !selectedIn || !selectedOut || !decimalsReady) return;
    const request = swapRequest(typedAmount);
    const at = editsRef.current;
    onError('');
    setIsBuildingTx(true);
    try {
      let current = quote;
      let bounds = checkQuote(current, request);
      if (Date.now() - quotedAt > QUOTE_TTL_MS) {
        // Refresh an old quote; build only if its bound is no worse than the one on screen
        const shown = bounds;
        current = await fetchQuote(request.amount);
        if (editsRef.current !== at) return;
        setQuote(current);
        setQuotedAt(Date.now());
        bounds = checkQuote(current, request);
        const noWorse = exactIn ? bounds.bound >= shown.bound : bounds.bound <= shown.bound;
        if (!noWorse) {
          onError('The price moved since this quote. Check the new amounts, then build again.');
          return;
        }
      }

      const most = exactIn ? bounds.amountIn : bounds.bound;
      if (most > spendableRaw) {
        throw new Error(
          `This swap can sell up to ${formatUnits(most, inDecimals)} ${tokenLabel(selectedIn)}, more than the ${spendableText} this account can spend.`,
        );
      }

      // An independent look at the rate, since the quoted amounts come from the API too
      const [pIn, pOut] = await Promise.all([priceOf(selectedIn, network), priceOf(selectedOut, network)]);
      if (editsRef.current !== at) return;
      const quotedRate = rateOf(bounds, pIn, pOut);
      if (quotedRate?.status === 'off') throw new Error(rateRefusal(quotedRate.shortfallBps));

      const [buildResponse, sequence] = await Promise.all([
        soroswapSDK.build({ quote: current, from: accountPublicKey }, getSoroswapNetwork(network)),
        loadAccountSequence(accountPublicKey, network),
      ]);
      if (editsRef.current !== at) return;
      const xdr = withExpiry(buildResponse.xdr, network);
      verifyProtocolTransaction(
        xdr,
        network,
        accountPublicKey,
        exactIn
          ? { kind: 'swap', exact: 'in', tokenIn: assetIn, tokenOut: assetOut, amountIn: request.amount, minOut: bounds.bound }
          : { kind: 'swap', exact: 'out', tokenIn: assetIn, tokenOut: assetOut, amountOut: request.amount, maxIn: bounds.bound },
        { sequence },
      );
      onBuild(xdr);
    } catch (err) {
      if (editsRef.current === at) onError(apiErrorMessage(err, 'Failed to build swap transaction'));
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
  const derivedSell = quote && decimalsReady && independentField === 'buy' && quote.tradeType === TradeType.EXACT_OUT
    ? fmtUnits(quote.amountIn, inDecimals)
    : undefined;
  const derivedBuy = quote && decimalsReady && independentField === 'sell' && quote.tradeType === TradeType.EXACT_IN
    ? fmtUnits(quote.amountOut, outDecimals)
    : undefined;

  const sellDisplay = independentField === 'sell' ? typedValue : (derivedSell ?? '');
  const buyDisplay = independentField === 'buy' ? typedValue : (derivedBuy ?? '');

  // The slippage bound that gets enforced: the app's, from the user's slippage
  const minReceived = quoted && decimalsReady && exactIn ? formatUnits(quoted.bound, outDecimals) : undefined;
  const maxSold = quoted && decimalsReady && !exactIn ? formatUnits(quoted.bound, inDecimals) : undefined;
  // Tokens the oracle has no price for: the quoted rate then rests on the API alone
  const unpriced = rate?.status === 'unpriced'
    ? [priceIn ? undefined : selectedIn, priceOut ? undefined : selectedOut].filter((t): t is Token => !!t)
    : [];

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
              disabled={inSpendable.lte(0) || typeof inDecimals !== 'number'}
              onClick={() => handleTypeSell(inSpendable.toDecimalPlaces(inDecimals ?? 0, Decimal.ROUND_DOWN).toFixed())}
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
                    <span className="truncate">{tokenLabel(selectedIn)}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {fromAssets.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No tokens with an active balance</div>
              )}
              {fromAssets.map((a) => (
                <SelectItem key={a.contract} value={a.contract}>
                  <div className="flex items-center gap-2 min-w-[220px]">
                    <TokenIcon asset={a} />
                    <span className="font-medium">{tokenLabel(a)}</span>
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
                    <span className="truncate">{tokenLabel(selectedOut)}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {assets.map((a) => (
                <SelectItem key={a.contract} value={a.contract}>
                  <div className="flex items-center gap-2 min-w-[220px]">
                    <TokenIcon asset={a} />
                    <span>{tokenLabel(a)}</span>
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

      <DecimalsNote token={selectedIn} decimals={inDecimals} />
      <DecimalsNote token={selectedOut} decimals={outDecimals} />
      {typedValue && typeof typedDecimals === 'number' && typedAmount === null && (
        <p className="text-xs text-destructive">Enter an amount with at most {typedDecimals} decimal places.</p>
      )}
      {overSpendable && (
        <p className="text-xs text-destructive">
          {exactIn ? 'This is' : 'This swap may sell'} more than the {spendableText} this account can spend.
        </p>
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
                <span className="font-mono">{minReceived} {selectedOut ? tokenLabel(selectedOut) : ''}</span>
              </div>
            )}
            {maxSold !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Maximum sold</span>
                <span className="font-mono">{maxSold} {selectedIn ? tokenLabel(selectedIn) : ''}</span>
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
            {quoted && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rate vs Reflector oracle</span>
                <span className="font-mono">
                  {rate === null ? '…' : rate.status === 'unpriced' ? 'no price' : `${percent(rate.shortfallBps)} ${rate.shortfallBps > 0 ? 'below' : 'above'}`}
                </span>
              </div>
            )}
            {quoteProblem && <p className="text-xs text-destructive">{quoteProblem}</p>}
            {rate?.status === 'off' && <p className="text-xs text-destructive">{rateRefusal(rate.shortfallBps)}</p>}
            {unpriced.length > 0 && (
              <p className="text-xs text-warning">
                The Reflector oracle has no price for {unpriced.map(tokenLabel).join(' or ')}, so nothing independent
                checks this rate: it comes from the Soroswap API alone. Compare the amounts with another source before you build.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Build Transaction */}
      {quote && (
        <Button
          className="w-full"
          onClick={handleBuild}
          disabled={loading || isTransactionBuilt || !quoted || overSpendable || rate?.status === 'off'}
        >
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Build Swap Transaction
        </Button>
      )}
    </div>
  );
};

// --- Add Liquidity Sub-Form ---

const AddLiquidityForm = ({ assets, network, accountPublicKey, onBuild, isBuilding, isTransactionBuilt, onError, onInputChange }: FormProps) => {
  const [assetA, setAssetA] = useState('');
  const [assetB, setAssetB] = useState('');
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  // The pair as read on chain through the pinned factory (never the API), for the pair it was read for
  const [pool, setPool] = useState<{ pair: string; state: PoolState | null; error?: string } | null>(null);
  const [isBuildingTx, setIsBuildingTx] = useState(false);
  const editsRef = useEdits();

  const pairKey = assetA && assetB && assetA !== assetB ? `${assetA}/${assetB}` : '';

  useEffect(() => {
    if (!assetA || !assetB || assetA === assetB) return;
    const pair = `${assetA}/${assetB}`;
    let active = true;
    readSoroswapPool(assetA, assetB, network).then(
      (state) => { if (active) setPool({ pair, state }); },
      (err) => {
        if (active) setPool({ pair, state: null, error: apiErrorMessage(err, 'Could not read this pool from the network.') });
      },
    );
    return () => { active = false; };
  }, [assetA, assetB, network]);

  const selectedA = assets.find((a) => a.contract === assetA);
  const selectedB = assets.find((a) => a.contract === assetB);
  const decimalsA = useDecimals(selectedA, network);
  const decimalsB = useDecimals(selectedB, network);
  const current = pool && pool.pair === pairKey ? pool : null;
  const isLoadingPool = !!pairKey && !current;
  const reserves = current?.state?.exists ? { a: current.state.reserveA, b: current.state.reserveB } : null;
  // Confirmed on chain: no pair yet, or an empty one. The deposit then sets the price.
  const newPool = current?.state?.exists === false;

  const rawA = typeof decimalsA === 'number' ? parseUnits(amountA, decimalsA) : null;
  // With reserves, amount B follows the pool price exactly as the router computes it
  const rawB = typeof decimalsB !== 'number' || !current?.state
    ? null
    : reserves ? (rawA ? (rawA * reserves.b) / reserves.a : null) : parseUnits(amountB, decimalsB);
  const amountBDisplay = reserves ? (rawB !== null && typeof decimalsB === 'number' ? formatUnits(rawB, decimalsB) : '') : amountB;

  const changed = () => {
    editsRef.current += 1;
    onInputChange();
  };

  const selectAsset = (setAsset: (v: string) => void, v: string) => {
    setAsset(v);
    setAmountA('');
    setAmountB('');
    changed();
  };

  const handleBuild = async () => {
    onError('');
    if (!assetA || !assetB || !rawA || !rawB || !current?.state) {
      onError('Fill in all fields');
      return;
    }

    const at = editsRef.current;
    setIsBuildingTx(true);
    try {
      // The pair may have been created or drained since it was read: check again before trusting a minimum of 0
      const fresh = await readSoroswapPool(assetA, assetB, network);
      if (editsRef.current !== at) return;
      if (fresh.exists !== !newPool) {
        setPool({ pair: pairKey, state: fresh });
        throw new Error('This pool changed since it was loaded. Check the amounts, then build again.');
      }

      const [response, sequence] = await Promise.all([
        soroswapSDK.addLiquidity(
          {
            assetA,
            assetB,
            amountA: rawA,
            amountB: rawB,
            to: accountPublicKey,
            slippageBps: LIQUIDITY_SLIPPAGE_BPS.toString(),
          },
          getSoroswapNetwork(network)
        ),
        loadAccountSequence(accountPublicKey, network),
      ]);
      if (editsRef.current !== at) return;
      // Minimums from the on-chain price; the first deposit into a new or empty pool sets the price, there is none to protect
      const xdr = withExpiry(response.xdr, network);
      verifyProtocolTransaction(xdr, network, accountPublicKey, {
        kind: 'add-liquidity',
        tokenA: assetA,
        tokenB: assetB,
        amountA: rawA,
        amountB: rawB,
        minA: newPool ? 0n : slippageFloor(rawA, LIQUIDITY_SLIPPAGE_BPS),
        minB: newPool ? 0n : slippageFloor(rawB, LIQUIDITY_SLIPPAGE_BPS),
        newPool,
      }, { sequence });
      onBuild(xdr);
    } catch (err) {
      if (editsRef.current === at) onError(apiErrorMessage(err, 'Failed to build add liquidity transaction'));
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
        <Select value={assetA} onValueChange={(v) => selectAsset(setAssetA, v)}>
          <SelectTrigger>
            <SelectValue placeholder="Select token" />
          </SelectTrigger>
          <SelectContent>
            {assets.map((a) => (
              <SelectItem key={a.contract} value={a.contract}>
                {tokenLabel(a)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DecimalsNote token={selectedA} decimals={decimalsA} />
      </div>

      {/* Asset B */}
      <div className="space-y-2">
        <Label>Asset B</Label>
        <Select value={assetB} onValueChange={(v) => selectAsset(setAssetB, v)}>
          <SelectTrigger>
            <SelectValue placeholder="Select token" />
          </SelectTrigger>
          <SelectContent>
            {assets.map((a) => (
              <SelectItem key={a.contract} value={a.contract}>
                {tokenLabel(a)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DecimalsNote token={selectedB} decimals={decimalsB} />
      </div>

      {/* Pool Info, as read on chain */}
      {isLoadingPool && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading pool...
        </div>
      )}
      {current?.error && <p className="text-xs text-destructive">{current.error} The deposit cannot be checked without it.</p>}
      {newPool && (
        <p className="text-xs text-muted-foreground">
          This pair has no Soroswap pool with reserves yet: this deposit sets its price.
        </p>
      )}
      {reserves && typeof decimalsA === 'number' && typeof decimalsB === 'number' && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reserve A</span>
              <span className="font-mono">{formatShort(reserves.a, decimalsA, 2)} {selectedA ? tokenLabel(selectedA) : ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reserve B</span>
              <span className="font-mono">{formatShort(reserves.b, decimalsB, 2)} {selectedB ? tokenLabel(selectedB) : ''}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Amount A */}
      <div className="space-y-2">
        <Label>Amount A {selectedA ? `(${tokenLabel(selectedA)})` : ''}</Label>
        <Input
          type="number"
          placeholder="0.00"
          value={amountA}
          onChange={(e) => { setAmountA(e.target.value); changed(); }}
          min="0"
          step="any"
        />
        {amountA && typeof decimalsA === 'number' && rawA === null && (
          <p className="text-xs text-destructive">Enter an amount with at most {decimalsA} decimal places.</p>
        )}
      </div>

      {/* Amount B (auto-calculated from the pool price) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label>Amount B {selectedB ? `(${tokenLabel(selectedB)})` : ''}</Label>
          {reserves && <Badge variant="secondary" className="text-xs">Auto</Badge>}
        </div>
        <Input
          type="number"
          placeholder="0.00"
          value={amountBDisplay}
          onChange={(e) => { setAmountB(e.target.value); changed(); }}
          min="0"
          step="any"
          disabled={!!reserves}
        />
        {!reserves && amountB && typeof decimalsB === 'number' && current?.state && rawB === null && (
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
  const editsRef = useEdits();

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
    editsRef.current += 1;
    onInputChange();
  };

  const handleBuild = async () => {
    if (!selectedPosition || !validLiquidity) return;
    const at = editsRef.current;
    onError('');
    setIsBuildingTx(true);
    try {
      const pool = selectedPosition.poolInformation;
      // What the burnt shares are worth: the position's tokens, pro rata
      const expectedA = (apiAmount(selectedPosition.tokenAAmountEquivalent) * liquidity) / held;
      const expectedB = (apiAmount(selectedPosition.tokenBAmountEquivalent) * liquidity) / held;
      if (expectedA <= 0n || expectedB <= 0n) {
        throw new Error('The Soroswap API reports nothing to receive for this position, so no minimum can be set. Not building it.');
      }
      const [response, sequence] = await Promise.all([
        soroswapSDK.removeLiquidity(
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
        ),
        loadAccountSequence(accountPublicKey, network),
      ]);
      if (editsRef.current !== at) return;
      const xdr = withExpiry(response.xdr, network);
      verifyProtocolTransaction(xdr, network, accountPublicKey, {
        kind: 'remove-liquidity',
        pool: pool.address,
        tokenA: pool.tokenA.address,
        tokenB: pool.tokenB.address,
        liquidity,
        minA: slippageFloor(expectedA, LIQUIDITY_SLIPPAGE_BPS),
        minB: slippageFloor(expectedB, LIQUIDITY_SLIPPAGE_BPS),
      }, { sequence });
      onBuild(xdr);
    } catch (err) {
      if (editsRef.current === at) onError(apiErrorMessage(err, 'Failed to build remove liquidity transaction'));
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
