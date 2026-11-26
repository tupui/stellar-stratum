import { useState, useEffect, useCallback } from 'react';
import { Decimal } from 'decimal.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Plus, ArrowDown, ChevronDown, Merge, Pencil, X, ExternalLink } from 'lucide-react';
import { Dock } from '@/components/brand/Shell';
import { Spinner } from '@/components/brand/Mark';
import { cn } from '@/lib/utils';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { isContractAddress, isMuxedAddress, isValidPaymentDestination } from '@/lib/validation';
import { baseAccountId } from '@/lib/signatures';
import { priceKey, spendableBalance } from '@/lib/balance-utils';
import type { AccountData } from '@/lib/stellar';
import { useToast } from '@/hooks/use-toast';
import { useDestinationAccount } from '@/hooks/useDestinationAccount';
import { DestinationAccountInfo } from './DestinationAccountInfo';
import { SwapInterface } from '../SwapInterface';
import { AssetIcon } from '../AssetIcon';
import { useNetwork } from '@/contexts/NetworkContext';
import { AddressAutocomplete } from '../AddressAutocomplete';
import { QRScanner, type ScanRefusal } from '../QRScanner';
import { isRefusal, parseSEP7PayUri } from '@/lib/sep7';

export interface PaymentDraft {
  destination: string;
  amount: string;
  asset: string;
  assetIssuer: string;
  receiveAsset?: string;
  receiveAssetIssuer?: string;
  receiveAmount?: string;
  slippageTolerance?: number;
  exactOut?: boolean;
}

/** One operation of the transaction being assembled. */
export interface PaymentOperation extends PaymentDraft {
  id: string;
  /** Close the source account and send everything left to the destination. */
  isAccountClosure?: boolean;
  /** The destination asked for a memo (SEP-29). */
  memoRequired?: boolean;
}

/** A Stellar transaction carries a single memo, shared by all of its operations. */
export interface TransactionMemo {
  type: 'text' | 'id';
  value: string;
}

interface Asset {
  code: string;
  issuer: string;
  name: string;
  balance: string;
  price: number;
}

interface PaymentFormProps {
  paymentData: PaymentDraft;
  onPaymentDataChange: (data: PaymentDraft) => void;
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
  onFetchAssetPrice?: (assetCode: string, assetIssuer?: string) => Promise<number>;
  onBuild: (operations: PaymentOperation[], memo: TransactionMemo) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
  accountData: AccountData;
  accountPublicKey: string;
  onClearTransaction?: () => void;
}

const EMPTY_DRAFT: PaymentDraft = { destination: '', amount: '', asset: 'XLM', assetIssuer: '', slippageTolerance: 0.5 };

const sameAsset = (codeA: string, issuerA: string | undefined, codeB: string, issuerB: string | undefined) =>
  codeA === codeB && (issuerA || '') === (issuerB || '');

const networkLabel = (network: string) => (network === 'testnet' ? 'Testnet' : 'Mainnet');

const isPathPayment = (p: PaymentDraft) =>
  Boolean(p.receiveAsset) && !sameAsset(p.receiveAsset!, p.receiveAssetIssuer, p.asset, p.assetIssuer);

const toDecimal = (value: string | undefined) => {
  try {
    return new Decimal(value || '0');
  } catch {
    return new Decimal(NaN);
  }
};

/**
 * A plain decimal with at most 7 places. Decimal.js also reads "0x3E8", "1_000" or "1e3",
 * which the display would not show as the amount actually sent, so those are refused.
 */
const PLAIN_AMOUNT = /^(\d+(\.\d{1,7})?|\.\d{1,7})$/;

/** Stellar amounts are 64-bit integers of stroops: at most 7 decimals, strictly positive. */
const isPositiveAmount = (value: string | undefined) => {
  if (!value || !PLAIN_AMOUNT.test(value.trim())) return false;
  const amount = toDecimal(value.trim());
  return amount.isFinite() && amount.gt(0);
};

const MAX_UINT64 = (1n << 64n) - 1n;

export const memoError = (memo: TransactionMemo): string | null => {
  if (!memo.value) return null;
  if (memo.type === 'text' && new TextEncoder().encode(memo.value).length > 28) {
    return 'Text memos are limited to 28 bytes.';
  }
  if (memo.type === 'id' && (!/^\d{1,20}$/.test(memo.value) || BigInt(memo.value) > MAX_UINT64)) {
    return 'A memo ID must be a whole number (up to 18446744073709551615).';
  }
  return null;
};

export const PaymentForm = ({
  paymentData,
  onPaymentDataChange,
  availableAssets,
  assetPrices,
  onFetchAssetPrice,
  onBuild,
  isBuilding,
  isTransactionBuilt,
  accountData,
  accountPublicKey,
  onClearTransaction,
}: PaymentFormProps) => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const { network } = useNetwork();
  const { toast } = useToast();

  const [compactPayments, setCompactPayments] = useState<PaymentOperation[]>([]);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [memo, setMemo] = useState<TransactionMemo>({ type: 'text', value: '' });
  const [fiatValue, setFiatValue] = useState<string>('');
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [willCloseAccount, setWillCloseAccount] = useState(false);
  // True once at least one operation is bundled and no operation is being entered.
  const [hasActiveForm, setHasActiveForm] = useState(false);

  const destination = useDestinationAccount(paymentData.destination, network);
  // A contract holds no trustline: it receives the asset sent, and nothing else can be picked.
  const recipientAssets =
    destination.status === 'exists' ? destination.assets : destination.status === 'contract' ? [] : [{ code: 'XLM', balance: '0' }];

  /** What was already planned for this asset by the other operations of the bundle. */
  const plannedOutflow = useCallback(
    (code: string, issuer?: string) =>
      compactPayments
        .filter((p) => p.id !== editingPaymentId && !p.isAccountClosure && sameAsset(p.asset, p.assetIssuer, code, issuer))
        .reduce((sum, p) => sum.plus(p.exactOut ? 0 : toDecimal(p.amount)), new Decimal(0)),
    [compactPayments, editingPaymentId],
  );

  const getAvailableBalance = useCallback(
    (code: string, issuer?: string) =>
      Decimal.max(0, spendableBalance(accountData, code, code === 'XLM' ? undefined : issuer).minus(plannedOutflow(code, issuer))),
    [accountData, plannedOutflow],
  );

  /**
   * An account can only be merged when nothing but XLM and emptied trustlines is left: no
   * offers, data entries, pool shares or sponsorships, and every trustline drained exactly.
   */
  const canCloseAccount = () => {
    if (compactPayments.some((p) => p.isAccountClosure && p.id !== editingPaymentId)) return false;
    if (accountData.num_sponsoring > 0) return false;
    const trustlines = accountData.balances.filter((b) => b.asset_type !== 'native');
    if (trustlines.some((b) => b.asset_type === 'liquidity_pool_shares')) return false;
    const extraSigners = accountData.signers.filter((s) => s.key !== accountPublicKey).length;
    if (accountData.subentry_count !== extraSigners + trustlines.length) return false; // offers or data entries
    return trustlines.every((b) => toDecimal(b.balance).minus(plannedOutflow(b.asset_code!, b.asset_issuer)).eq(0));
  };

  const leftoverXlm = () => {
    const native = accountData.balances.find((b) => b.asset_type === 'native');
    return Decimal.max(0, toDecimal(native?.balance).minus(plannedOutflow('XLM')));
  };

  const formatFiat = useCallback(
    async (amount: string, asset: string, issuer?: string) => {
      const price = assetPrices[priceKey(asset, issuer)] || 0;
      if (price <= 0 || !amount) return '';
      const usdValue = parseFloat(amount) * price;
      const currency = getCurrentCurrency();
      if (currency.code === 'USD') return `${currency.symbol}${usdValue.toFixed(2)} USD`;
      try {
        const converted = await convertFromUSD(usdValue, currency.code);
        return `${currency.symbol}${converted.toFixed(2)} ${currency.code}`;
      } catch {
        return `$${usdValue.toFixed(2)} USD`;
      }
    },
    [assetPrices, getCurrentCurrency],
  );

  const [compactPaymentFiatValues, setCompactPaymentFiatValues] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const values: Record<string, string> = {};
      for (const payment of compactPayments) {
        if (payment.exactOut) continue;
        const value = await formatFiat(payment.amount, payment.asset, payment.assetIssuer);
        if (value) values[payment.id] = value;
      }
      if (!cancelled) setCompactPaymentFiatValues(values);
    })();
    return () => {
      cancelled = true;
    };
  }, [compactPayments, quoteCurrency, formatFiat]);

  useEffect(() => {
    let cancelled = false;
    formatFiat(paymentData.amount, paymentData.asset, paymentData.assetIssuer).then((value) => {
      if (!cancelled) setFiatValue(value);
    });
    return () => {
      cancelled = true;
    };
  }, [paymentData.amount, paymentData.asset, paymentData.assetIssuer, quoteCurrency, formatFiat]);

  const getAssetExplorerUrl = (assetCode: string, assetIssuer?: string): string => {
    const networkPath = network === 'testnet' ? 'testnet' : 'public';
    // Only the issuer-less asset is native XLM: a token can be called "XLM" too.
    if (!assetIssuer) {
      return `https://stellar.expert/explorer/${networkPath}/asset/XLM`;
    }
    return `https://stellar.expert/explorer/${networkPath}/asset/${assetCode}-${assetIssuer}`;
  };

  const handleAmountChange = (newAmount: string) => {
    if (willCloseAccount) return; // A merge always sends everything that is left
    const amount = toDecimal(newAmount);
    onPaymentDataChange({ ...paymentData, amount: amount.isFinite() ? amount.toDecimalPlaces(7, Decimal.ROUND_DOWN).toFixed() : '' });
  };

  const handleMergeAccount = () => {
    if (!canCloseAccount()) return;
    onPaymentDataChange({
      ...paymentData,
      asset: 'XLM',
      assetIssuer: '',
      receiveAsset: undefined,
      receiveAssetIssuer: undefined,
      receiveAmount: undefined,
      exactOut: false,
      amount: leftoverXlm().toFixed(7),
    });
    setWillCloseAccount(true);
  };

  const handleCancelMerge = () => {
    setWillCloseAccount(false);
    onPaymentDataChange({ ...paymentData, amount: '' });
  };

  /** Why the current operation cannot be added yet, or null when it can. */
  const validationError = (): string | null => {
    const dest = paymentData.destination.trim();
    if (!dest) return 'Enter a destination address.';
    if (!isValidPaymentDestination(dest)) return 'The destination is not a valid Stellar address.';
    // A muxed (M…) destination is the account behind it.
    const toSelf = baseAccountId(dest) === accountPublicKey;
    if (destination.status === 'loading' || destination.status === 'idle') return 'Checking the destination account…';
    if (destination.status === 'error') return destination.message;

    if (isContractAddress(dest)) {
      if (willCloseAccount) return 'An account cannot be merged into a contract.';
      if (compactPayments.some((p) => p.id !== editingPaymentId)) {
        return 'A payment to a contract (C…) must be the only operation of its transaction. Send it separately.';
      }
      if (isPathPayment(paymentData)) return 'A contract can only be sent the asset itself.';
    } else if (compactPayments.some((p) => p.id !== editingPaymentId && isContractAddress(p.destination))) {
      return 'A payment to a contract (C…) must be the only operation of its transaction. Send this one separately.';
    }

    if (willCloseAccount) {
      if (toSelf) return 'An account cannot be merged into itself.';
      if (destination.status !== 'exists') return 'An account can only be merged into an existing account.';
      return canCloseAccount() ? null : 'This account cannot be merged yet (it still holds assets, offers or data).';
    }

    const path = isPathPayment(paymentData);
    if (paymentData.asset !== 'XLM' && !paymentData.assetIssuer) return 'Select the asset to send.';
    if (!path && toSelf) return 'Sending an asset to yourself does nothing.';

    // A contract has nothing to look up: the simulation checks the transfer when building.
    if (destination.status === 'missing') {
      if (isMuxedAddress(dest)) {
        return 'The account behind this muxed address does not exist yet. Create it by sending to its G… address first.';
      }
      if (path || paymentData.asset !== 'XLM') {
        return 'This account does not exist yet. Send it at least 1 XLM first to create it.';
      }
      if (isPositiveAmount(paymentData.amount) && toDecimal(paymentData.amount).lt(1)) {
        return 'Creating a new account requires at least 1 XLM.';
      }
    } else if (destination.status === 'exists') {
      const receiveCode = path ? paymentData.receiveAsset! : paymentData.asset;
      const receiveIssuer = path ? paymentData.receiveAssetIssuer : paymentData.assetIssuer;
      if (receiveCode !== 'XLM' && !recipientAssets.some((a) => sameAsset(a.code, a.issuer, receiveCode, receiveIssuer))) {
        return `The destination has no trustline for ${receiveCode}, so it cannot receive it.`;
      }
    }

    if (paymentData.exactOut && path) {
      return isPositiveAmount(paymentData.receiveAmount) ? null : 'Enter the amount the destination should receive.';
    }
    if (!isPositiveAmount(paymentData.amount)) return 'Enter an amount (up to 7 decimals).';
    const available = getAvailableBalance(paymentData.asset, paymentData.assetIssuer);
    if (toDecimal(paymentData.amount).gt(available)) {
      return `Only ${available.toFixed()} ${paymentData.asset} can be sent (after the minimum reserve and the other operations).`;
    }
    return null;
  };
  const isFormValid = () => validationError() === null;

  const resetDraft = () => {
    onPaymentDataChange({ ...EMPTY_DRAFT, asset: paymentData.asset, assetIssuer: paymentData.assetIssuer });
    setWillCloseAccount(false);
  };

  const draftToOperation = (id: string): PaymentOperation => ({
    id,
    destination: paymentData.destination.trim(),
    amount: willCloseAccount ? leftoverXlm().toFixed(7) : paymentData.amount,
    asset: paymentData.asset,
    assetIssuer: paymentData.assetIssuer,
    receiveAsset: isPathPayment(paymentData) ? paymentData.receiveAsset : undefined,
    receiveAssetIssuer: isPathPayment(paymentData) ? paymentData.receiveAssetIssuer : undefined,
    receiveAmount: isPathPayment(paymentData) ? paymentData.receiveAmount : undefined,
    slippageTolerance: paymentData.slippageTolerance,
    exactOut: isPathPayment(paymentData) ? paymentData.exactOut : false,
    isAccountClosure: willCloseAccount,
    memoRequired: destination.status === 'exists' && destination.memoRequired,
  });

  const handleBundlePayment = () => {
    if (!isFormValid()) return;
    setCompactPayments((prev) => [...prev, draftToOperation(crypto.randomUUID())]);
    onClearTransaction?.(); // Any built transaction no longer matches the bundle
    resetDraft();
    setHasActiveForm(true);
  };

  const addPayment = () => {
    resetDraft();
    setHasActiveForm(false);
  };

  const editCompactPayment = (payment: PaymentOperation) => {
    onPaymentDataChange({
      destination: payment.destination,
      amount: payment.amount,
      asset: payment.asset,
      assetIssuer: payment.assetIssuer,
      receiveAsset: payment.receiveAsset,
      receiveAssetIssuer: payment.receiveAssetIssuer,
      receiveAmount: payment.receiveAmount,
      slippageTolerance: payment.slippageTolerance,
      exactOut: payment.exactOut,
    });
    setEditingPaymentId(payment.id);
    setHasActiveForm(false);
    setWillCloseAccount(!!payment.isAccountClosure);
    onClearTransaction?.();
  };

  const removeCompactPayment = (id: string) => {
    const remaining = compactPayments.filter((p) => p.id !== id);
    setCompactPayments(remaining);
    if (remaining.length === 0) setHasActiveForm(false);
    onClearTransaction?.();
  };

  const handleSaveEdit = () => {
    if (!editingPaymentId || !isFormValid()) return;
    const updated = draftToOperation(editingPaymentId);
    setCompactPayments((prev) => prev.map((p) => (p.id === editingPaymentId ? updated : p)));
    setEditingPaymentId(null);
    setHasActiveForm(true);
    resetDraft();
    onClearTransaction?.();
  };

  const cancelCurrentPayment = () => {
    setEditingPaymentId(null);
    resetDraft();
    setHasActiveForm(compactPayments.length > 0);
  };

  const needsMemo = compactPayments.some((p) => p.memoRequired) && !memo.value;
  // A transaction has one memo: two destinations that each need their own (two exchange
  // deposits) cannot share it.
  const memoConflict = new Set(compactPayments.filter((p) => p.memoRequired).map((p) => p.destination)).size > 1;
  // Contract calls take no transaction memo.
  const currentMemoError =
    memoError(memo) ??
    (memo.value && compactPayments.some((p) => isContractAddress(p.destination))
      ? 'A payment to a contract cannot carry a memo. Remove the memo.'
      : null);
  const hasMerge = compactPayments.some((p) => p.isAccountClosure);

  const handleBuild = () => {
    if (currentMemoError || needsMemo || memoConflict) return;
    // A merge deletes the account, so it has to be the last operation.
    const ordered = [...compactPayments.filter((p) => !p.isAccountClosure), ...compactPayments.filter((p) => p.isAccountClosure)];
    onBuild(ordered, memo);
  };

  /** SEP-7 payment request (web+stellar:pay) or a plain address. */
  const handleQRScan = (data: string): ScanRefusal | void => {
    const text = data.trim();
    if (isValidPaymentDestination(text)) {
      onPaymentDataChange({ ...paymentData, destination: text });
      return;
    }
    const request = parseSEP7PayUri(text);
    if (!request) return { title: 'Unrecognized QR code', description: 'Expected a Stellar address or a payment request.' };
    if (isRefusal(request)) return { title: 'Payment request refused', description: request.refused };
    if (request.network !== network) {
      // Never fill in a payment for the other network, and never switch networks from a QR code.
      return {
        title: 'Wrong network',
        description: `This payment request is for ${networkLabel(request.network)}, and this account is on ${networkLabel(network)}.`,
      };
    }

    const { destination, asset, amount } = request;
    const held = asset ? availableAssets.find((a) => sameAsset(a.code, a.issuer, asset.code, asset.issuer)) : undefined;
    const amountOk = amount !== undefined && isPositiveAmount(amount);
    if (asset && !held) {
      // Never carry the requested amount over to another asset (such as XLM).
      toast({ title: 'Asset not held', description: `This request asks for ${asset.code}, which this account does not hold.`, variant: 'destructive' });
      onPaymentDataChange({ ...paymentData, destination, amount: '' });
    } else {
      if (amount !== undefined && !amountOk) {
        toast({ title: 'Amount not applied', description: 'The amount in this request is not a plain number.', variant: 'destructive' });
      }
      onPaymentDataChange({
        ...paymentData,
        destination,
        amount: amountOk ? amount : '',
        asset: held ? held.code : 'XLM',
        assetIssuer: held ? held.issuer : '',
      });
    }

    if (request.memo) {
      if (memo.value && memo.value !== request.memo.value) {
        // The memo usually says whose deposit this is: never replace one silently.
        toast({
          title: 'Memo not applied',
          description: `This request asks for memo "${request.memo.value}", but this transaction already uses "${memo.value}". Send it as a separate transaction.`,
          variant: 'destructive',
        });
      } else {
        setMemo(request.memo);
      }
    }
  };

  const formError = paymentData.destination || paymentData.amount ? validationError() : null;
  const destinationInvalid = Boolean(paymentData.destination) && !isValidPaymentDestination(paymentData.destination.trim());

  const renderAsset = (code: string, issuer?: string) => (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate font-semibold text-foreground">{code}</span>
      {issuer && <span className="font-address text-xs text-muted-foreground">{issuer.slice(0, 4)}…{issuer.slice(-4)}</span>}
      <a
        href={getAssetExplorerUrl(code, issuer)}
        target="_blank"
        rel="noopener noreferrer"
        className="-m-3 inline-grid size-11 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
        title={issuer ? `${code} issued by ${issuer}` : code}
        aria-label={`${code} in explorer`}
      >
        <ExternalLink className="h-4 w-4" />
      </a>
    </span>
  );

  const renderAmounts = (payment: PaymentOperation) => {
    const path = Boolean(payment.receiveAsset);
    const send = payment.exactOut ? 'set at build' : payment.amount;
    const receive = !path ? null : payment.exactOut ? `exactly ${payment.receiveAmount}` : 'at best price';
    return { send, receive };
  };

  const operationNumber = editingPaymentId
    ? compactPayments.findIndex((p) => p.id === editingPaymentId) + 1
    : compactPayments.length + 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Operations bundled so far */}
      {compactPayments.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">List of operations</span>
            <Badge variant="secondary">
              {compactPayments.length} operation{compactPayments.length > 1 ? 's' : ''}
            </Badge>
          </div>

          {compactPayments.map((payment, index) => {
            const closesAccount = payment.isAccountClosure || false;
            const { send, receive } = renderAmounts(payment);
            const toCode = payment.receiveAsset || payment.asset;
            const toIssuer = payment.receiveAsset ? payment.receiveAssetIssuer : payment.assetIssuer;
            const sent = closesAccount ? 'all remaining' : send;
            return (
              <article
                key={payment.id}
                aria-label={`Operation ${index + 1}`}
                className={cn('well flex flex-col gap-3 p-4', closesAccount && 'border border-destructive')}
              >
                <div className="flex items-center gap-2">
                  <h3 className="sub flex-1">
                    <span className="sm:hidden">Op #{index + 1}</span>
                    <span className="hidden sm:inline">Operation #{index + 1}</span>
                  </h3>
                  {compactPaymentFiatValues[payment.id] && (
                    <span className="mr-1 text-[13px] text-muted-foreground">≈ {compactPaymentFiatValues[payment.id]}</span>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => editCompactPayment(payment)}
                    title="Edit operation"
                    aria-label="Edit operation"
                  >
                    <Pencil className="!size-5" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => removeCompactPayment(payment.id)}
                    title="Remove operation"
                    aria-label="Remove operation"
                  >
                    <X className="!size-5" />
                  </Button>
                </div>

                {closesAccount && (
                  <div className="notice red">
                    <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden="true" />
                    <p className="font-semibold">
                      Account closure: this closes your source account, removes its trustlines and sends all remaining XLM
                      to the destination. This cannot be undone.
                    </p>
                  </div>
                )}

                {/* What leaves, then what arrives: logo, code, amount; the arrow sits in the logo column */}
                <div className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                  <AssetIcon assetCode={payment.asset} assetIssuer={payment.assetIssuer} size={24} />
                  {renderAsset(payment.asset, payment.assetIssuer)}
                  <span className="text-right font-amount text-[15px]">{sent}</span>
                  <ArrowDown className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span />
                  <span />
                  <AssetIcon assetCode={toCode} assetIssuer={toIssuer} size={24} />
                  {renderAsset(toCode, toIssuer)}
                  <span className="text-right font-amount text-[15px]">{receive ?? sent}</span>
                </div>

                <div>
                  <div className="text-[13px] text-muted-foreground">Destination</div>
                  <div className="mt-1 break-all font-address text-[13px] text-foreground">{payment.destination}</div>
                  {payment.memoRequired && <p className="mt-1 text-[13px] text-warning">This destination requires a memo.</p>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Current operation */}
      {(!isTransactionBuilt || editingPaymentId) && (
        <>
          {!hasActiveForm && (
            <>
              <h3 className="sub">Operation #{operationNumber}</h3>

              <div className="flex flex-col gap-2">
                <label htmlFor="destination" className="text-[13px] text-muted-foreground">
                  {willCloseAccount ? 'Send all funds to' : 'Destination address'}
                </label>
                <AddressAutocomplete
                  id="destination"
                  value={paymentData.destination}
                  onChange={(value) => onPaymentDataChange({ ...paymentData, destination: value })}
                  accountPublicKey={accountPublicKey}
                  network={network}
                  onQRScan={() => setShowQRScanner(true)}
                  invalid={destinationInvalid}
                />
                {destinationInvalid && <p className="text-[13px] text-destructive">Please enter a valid Stellar address</p>}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-muted-foreground">Amount &amp; assets</span>
                <SwapInterface
                  fromAsset={paymentData.asset}
                  fromAssetIssuer={paymentData.assetIssuer}
                  toAsset={paymentData.receiveAsset}
                  toAssetIssuer={paymentData.receiveAssetIssuer}
                  amount={paymentData.amount}
                  availableAssets={destination.status === 'missing' ? availableAssets.filter((a) => a.code === 'XLM') : availableAssets}
                  recipientAssets={recipientAssets}
                  availableBalance={
                    willCloseAccount
                      ? leftoverXlm().toNumber()
                      : getAvailableBalance(paymentData.asset, paymentData.assetIssuer).toNumber()
                  }
                  fiatValue={fiatValue}
                  receiveAmount={paymentData.receiveAmount}
                  slippageTolerance={paymentData.slippageTolerance}
                  willCloseAccount={willCloseAccount}
                  onAmountChange={handleAmountChange}
                  onFromAssetChange={(asset, issuer) => {
                    onPaymentDataChange({
                      ...paymentData,
                      asset,
                      assetIssuer: issuer || '',
                      amount: '',
                      receiveAsset: undefined,
                      receiveAssetIssuer: undefined,
                      receiveAmount: undefined,
                      exactOut: false,
                    });
                  }}
                  onToAssetChange={(asset, issuer) => {
                    onPaymentDataChange({ ...paymentData, receiveAsset: asset, receiveAssetIssuer: issuer, receiveAmount: undefined });
                  }}
                  onSlippageToleranceChange={(t) => onPaymentDataChange({ ...paymentData, slippageTolerance: t })}
                  onReceiveAmountChange={(amount) => {
                    if (isPathPayment(paymentData)) onPaymentDataChange({ ...paymentData, receiveAmount: amount });
                  }}
                  exactOut={paymentData.exactOut}
                  onExactOutChange={(exactOut) => {
                    onPaymentDataChange({ ...paymentData, exactOut, receiveAmount: exactOut ? paymentData.receiveAmount || '' : undefined });
                  }}
                  assetPrices={assetPrices}
                  onFetchAssetPrice={onFetchAssetPrice}
                />
              </div>

              {paymentData.asset === 'XLM' &&
                !isPathPayment(paymentData) &&
                !willCloseAccount &&
                canCloseAccount() &&
                isValidPaymentDestination(paymentData.destination.trim()) &&
                baseAccountId(paymentData.destination.trim()) !== accountPublicKey &&
                destination.status === 'exists' && (
                  <Button variant="outline" size="sm" onClick={handleMergeAccount} className="self-center">
                    <Merge />
                    Merge Account
                  </Button>
                )}
              {willCloseAccount && (
                <Button variant="ghost" size="sm" onClick={handleCancelMerge} className="self-center">
                  Cancel Merge
                </Button>
              )}

              {paymentData.destination && (
                <DestinationAccountInfo destination={paymentData.destination.trim()} lookup={destination} network={network} />
              )}

              {formError && destination.status !== 'loading' && destination.status !== 'error' && (
                <p className="text-[13px] text-muted-foreground">{formError}</p>
              )}
            </>
          )}

          {/* One memo for the whole transaction */}
          {(compactPayments.length > 0 || !hasActiveForm) && (
            <div className="flex flex-col gap-2">
              <label htmlFor="memo" className="text-[13px] text-muted-foreground">Transaction memo (optional)</label>
              <div className="flex gap-2">
                <div className="relative shrink-0">
                  <select
                    aria-label="Memo type"
                    className="h-12 appearance-none rounded-none border border-input bg-ink-3 pl-3 pr-10 text-[15px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    value={memo.type}
                    onChange={(e) => setMemo({ ...memo, type: e.target.value as TransactionMemo['type'] })}
                  >
                    <option value="text">Text</option>
                    <option value="id">ID</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
                </div>
                <Input
                  id="memo"
                  placeholder={memo.type === 'id' ? 'Numeric memo, e.g. 123456' : 'Up to 28 bytes'}
                  inputMode={memo.type === 'id' ? 'numeric' : 'text'}
                  value={memo.value}
                  onChange={(e) => {
                    setMemo({ ...memo, value: e.target.value });
                    onClearTransaction?.();
                  }}
                />
              </div>
              <p className="text-[13px] text-muted-foreground">A transaction has a single memo, shared by all its operations.</p>
              {currentMemoError && <p className="text-[13px] text-destructive">{currentMemoError}</p>}
              {needsMemo && <p className="text-[13px] text-destructive">A destination in this transaction requires a memo.</p>}
              {memoConflict && (
                <p className="text-[13px] text-destructive">
                  Several destinations here require their own memo, but a transaction has only one. Send them as separate
                  transactions.
                </p>
              )}
            </div>
          )}

          {/* The main action: in the dock on the phone, right-aligned on desktop; the primary last */}
          <Dock className="sm:[&>*]:min-w-48">
            {hasActiveForm && (
              <>
                {!hasMerge && (
                  <Button onClick={addPayment} variant="outline" className="min-w-0 px-3">
                    <Plus />
                    <span className="truncate">Add Operation</span>
                  </Button>
                )}
                <Button
                  onClick={handleBuild}
                  disabled={isBuilding || compactPayments.length === 0 || Boolean(currentMemoError) || needsMemo || memoConflict}
                  className="min-w-0 px-3"
                >
                  {isBuilding ? (
                    <>
                      <Spinner />
                      <span className="truncate">Building...</span>
                    </>
                  ) : (
                    <span className="truncate">Build Transaction</span>
                  )}
                </Button>
              </>
            )}

            {!hasActiveForm &&
              (editingPaymentId ? (
                <>
                  <Button onClick={cancelCurrentPayment} variant="outline" className="min-w-0">
                    <span className="truncate">Cancel Edit</span>
                  </Button>
                  <Button onClick={handleSaveEdit} disabled={!isFormValid()} className="min-w-0">
                    <span className="truncate">Save Changes</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={cancelCurrentPayment} variant="outline" className="min-w-0">
                    <span className="truncate">Cancel</span>
                  </Button>
                  <Button onClick={handleBundlePayment} disabled={!isFormValid()} className="min-w-0">
                    <Plus />
                    <span className="truncate">Bundle</span>
                  </Button>
                </>
              ))}
          </Dock>
        </>
      )}

      <QRScanner isOpen={showQRScanner} onClose={() => setShowQRScanner(false)} onScan={handleQRScan} />
    </div>
  );
};
