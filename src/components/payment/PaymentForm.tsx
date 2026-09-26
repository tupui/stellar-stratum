import { useState, useEffect, useCallback } from 'react';
import { Decimal } from 'decimal.js';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Plus, ArrowRight, ArrowDown, Merge, Edit2, X, ExternalLink } from 'lucide-react';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { isValidPublicKey } from '@/lib/validation';
import { spendableBalance } from '@/lib/balance-utils';
import type { AccountData } from '@/lib/stellar';
import { useToast } from '@/hooks/use-toast';
import { useDestinationAccount } from '@/hooks/useDestinationAccount';
import { DestinationAccountInfo } from './DestinationAccountInfo';
import { SwapInterface } from '../SwapInterface';
import { AssetIcon } from '../AssetIcon';
import { useNetwork } from '@/contexts/NetworkContext';
import { AddressAutocomplete } from '../AddressAutocomplete';
import { QRScanner } from '../QRScanner';

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

const isPathPayment = (p: PaymentDraft) =>
  Boolean(p.receiveAsset) && !sameAsset(p.receiveAsset!, p.receiveAssetIssuer, p.asset, p.assetIssuer);

const toDecimal = (value: string | undefined) => {
  try {
    return new Decimal(value || '0');
  } catch {
    return new Decimal(NaN);
  }
};

/** Stellar amounts are 64-bit integers of stroops: at most 7 decimals, strictly positive. */
const isPositiveAmount = (value: string | undefined) => {
  const amount = toDecimal(value);
  return amount.isFinite() && amount.gt(0) && amount.decimalPlaces() <= 7;
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
  const recipientAssets = destination.status === 'exists' ? destination.assets : [{ code: 'XLM', balance: '0' }];

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
    async (amount: string, asset: string) => {
      const price = assetPrices[asset] || 0;
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
        const value = await formatFiat(payment.amount, payment.asset);
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
    formatFiat(paymentData.amount, paymentData.asset).then((value) => {
      if (!cancelled) setFiatValue(value);
    });
    return () => {
      cancelled = true;
    };
  }, [paymentData.amount, paymentData.asset, quoteCurrency, formatFiat]);

  const getAssetExplorerUrl = (assetCode: string, assetIssuer?: string): string => {
    const networkPath = network === 'testnet' ? 'testnet' : 'public';
    if (!assetIssuer || assetCode === 'XLM') {
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
    if (!isValidPublicKey(dest)) return 'The destination is not a valid Stellar address.';
    if (destination.status === 'loading' || destination.status === 'idle') return 'Checking the destination account…';
    if (destination.status === 'error') return destination.message;

    if (willCloseAccount) {
      if (dest === accountPublicKey) return 'An account cannot be merged into itself.';
      if (destination.status !== 'exists') return 'An account can only be merged into an existing account.';
      return canCloseAccount() ? null : 'This account cannot be merged yet (it still holds assets, offers or data).';
    }

    const path = isPathPayment(paymentData);
    if (paymentData.asset !== 'XLM' && !paymentData.assetIssuer) return 'Select the asset to send.';
    if (!path && dest === accountPublicKey) return 'Sending an asset to yourself does nothing.';

    if (destination.status === 'missing') {
      if (path || paymentData.asset !== 'XLM') {
        return 'This account does not exist yet. Send it at least 1 XLM first to create it.';
      }
      if (isPositiveAmount(paymentData.amount) && toDecimal(paymentData.amount).lt(1)) {
        return 'Creating a new account requires at least 1 XLM.';
      }
    } else {
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
  const currentMemoError = memoError(memo);
  const hasMerge = compactPayments.some((p) => p.isAccountClosure);

  const handleBuild = () => {
    if (currentMemoError || needsMemo) return;
    // A merge deletes the account, so it has to be the last operation.
    const ordered = [...compactPayments.filter((p) => !p.isAccountClosure), ...compactPayments.filter((p) => p.isAccountClosure)];
    onBuild(ordered, memo);
  };

  /** SEP-7 payment request (web+stellar:pay) or a plain address. */
  const handleQRScan = (data: string) => {
    const text = data.trim();
    if (isValidPublicKey(text)) {
      onPaymentDataChange({ ...paymentData, destination: text });
      return;
    }
    try {
      const url = new URL(text);
      const target = url.searchParams.get('destination');
      if ((url.protocol === 'web+stellar:' || url.protocol === 'stellar:') && url.pathname === 'pay' && target && isValidPublicKey(target)) {
        const code = url.searchParams.get('asset_code');
        const issuer = url.searchParams.get('asset_issuer') ?? '';
        const held = code ? availableAssets.find((a) => sameAsset(a.code, a.issuer, code, issuer)) : undefined;
        if (code && !held) {
          toast({ title: 'Asset not held', description: `This request asks for ${code}, which this account does not hold.`, variant: 'destructive' });
        }
        onPaymentDataChange({
          ...paymentData,
          destination: target,
          amount: url.searchParams.get('amount') ?? paymentData.amount,
          asset: held ? held.code : 'XLM',
          assetIssuer: held ? held.issuer : '',
        });
        const requestedMemo = url.searchParams.get('memo');
        if (requestedMemo) {
          const memoType = url.searchParams.get('memo_type');
          if (memoType && memoType !== 'MEMO_TEXT' && memoType !== 'MEMO_ID') {
            toast({ title: 'Memo not applied', description: `${memoType} memos are not supported; enter it manually.`, variant: 'destructive' });
          } else {
            setMemo({ type: memoType === 'MEMO_ID' ? 'id' : 'text', value: requestedMemo });
          }
        }
        return;
      }
    } catch {
      // Not a URL
    }
    toast({ title: 'Unrecognised QR code', description: 'Expected a Stellar address or a payment request.', variant: 'destructive' });
  };

  const formError = paymentData.destination || paymentData.amount ? validationError() : null;
  const destinationInvalid = Boolean(paymentData.destination) && !isValidPublicKey(paymentData.destination.trim());

  const renderAsset = (code: string, issuer?: string) => (
    <a
      href={getAssetExplorerUrl(code, issuer)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground font-medium hover:text-primary transition-colors inline-flex items-center gap-1"
      title={issuer ? `${code} issued by ${issuer}` : code}
    >
      {code}
      {issuer && <span className="font-address text-[10px]">{issuer.slice(0, 4)}…{issuer.slice(-4)}</span>}
      <ExternalLink className="w-3 h-3" />
    </a>
  );

  const renderAmounts = (payment: PaymentOperation) => {
    const path = Boolean(payment.receiveAsset);
    const send = payment.exactOut ? 'set at build' : payment.amount;
    const receive = !path ? null : payment.exactOut ? `exactly ${payment.receiveAmount}` : 'at best price';
    return { send, receive };
  };

  return (
    <div className="space-y-6">
      {/* Operations bundled so far */}
      {compactPayments.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">List of Operations</h3>
            <Badge variant="secondary" className="text-xs">
              {compactPayments.length} operation{compactPayments.length > 1 ? 's' : ''}
            </Badge>
          </div>

          {compactPayments.map((payment, index) => {
            const closesAccount = payment.isAccountClosure || false;
            const { send, receive } = renderAmounts(payment);
            const toCode = payment.receiveAsset || payment.asset;
            const toIssuer = payment.receiveAsset ? payment.receiveAssetIssuer : payment.assetIssuer;
            return (
              <Card
                key={payment.id}
                className={`p-4 md:p-6 rounded-2xl border border-border/60 ${closesAccount ? 'bg-destructive/5 border-destructive/30' : 'bg-card/60'} hover:bg-card transition-colors shadow-sm`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">
                      <span className="sm:hidden">Op #{index + 1}</span>
                      <span className="hidden sm:inline">Operation #{index + 1}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {compactPaymentFiatValues[payment.id] && (
                        <span className="text-sm font-semibold text-primary font-amount">≈ {compactPaymentFiatValues[payment.id]}</span>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => editCompactPayment(payment)}
                          className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
                          title="Edit operation"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCompactPayment(payment.id)}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                          title="Remove operation"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {closesAccount && (
                    <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                        <p className="text-destructive font-semibold text-sm">
                          Account Closure: this closes your source account, removes its trustlines and sends all remaining XLM
                          to the destination. This cannot be undone.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="bg-background/50 rounded-lg p-2 w-fit mx-auto">
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <AssetIcon assetCode={payment.asset} assetIssuer={payment.assetIssuer} size={32} />
                        {renderAsset(payment.asset, payment.assetIssuer)}
                        <span className="font-semibold font-amount">{closesAccount ? 'all remaining' : send}</span>
                      </div>
                      <ArrowRight className="hidden sm:block w-4 h-4 text-muted-foreground mx-1" />
                      <ArrowDown className="sm:hidden w-4 h-4 text-muted-foreground" />
                      <div className="flex items-center gap-2">
                        <AssetIcon assetCode={toCode} assetIssuer={toIssuer} size={32} />
                        {renderAsset(toCode, toIssuer)}
                        {receive && <span className="font-semibold font-amount">{receive}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs">
                    <span className="text-muted-foreground font-medium">Destination:</span>
                    <div className="font-address text-foreground mt-1 break-all">{payment.destination}</div>
                    {payment.memoRequired && <p className="mt-1 text-warning">This destination requires a memo.</p>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Current operation */}
      {(!isTransactionBuilt || editingPaymentId) && (
        <div className="space-y-4">
          {!hasActiveForm && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">
                  Operation #{editingPaymentId ? compactPayments.findIndex((p) => p.id === editingPaymentId) + 1 : compactPayments.length + 1}
                </h3>
              </div>

              <div className="space-y-2">
                <Label htmlFor="destination" className="text-sm font-medium">
                  {willCloseAccount ? 'Send All Funds To' : 'Destination Address'}
                </Label>
                <AddressAutocomplete
                  value={paymentData.destination}
                  onChange={(value) => onPaymentDataChange({ ...paymentData, destination: value })}
                  accountPublicKey={accountPublicKey}
                  network={network}
                  onQRScan={() => setShowQRScanner(true)}
                  className={`text-xs font-address bg-background focus:border-primary ${destinationInvalid ? 'border-destructive' : 'border-border/60'}`}
                />
                {destinationInvalid && <p className="text-xs text-destructive">Please enter a valid Stellar address</p>}
              </div>

              <div className="space-y-6">
                <Label className="text-sm font-medium">Amount & Assets</Label>
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

                {paymentData.asset === 'XLM' &&
                  !isPathPayment(paymentData) &&
                  !willCloseAccount &&
                  canCloseAccount() &&
                  isValidPublicKey(paymentData.destination.trim()) &&
                  paymentData.destination.trim() !== accountPublicKey &&
                  destination.status === 'exists' && (
                    <div className="text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleMergeAccount}
                        className="h-8 px-4 text-sm border-primary/30 hover:border-primary hover:bg-primary/10"
                      >
                        <Merge className="h-4 w-4 mr-2" />
                        Merge Account
                      </Button>
                    </div>
                  )}
                {willCloseAccount && (
                  <div className="text-center">
                    <Button variant="ghost" size="sm" onClick={handleCancelMerge} className="h-8 px-4 text-sm">
                      Cancel merge
                    </Button>
                  </div>
                )}
              </div>

              {paymentData.destination && (
                <DestinationAccountInfo destination={paymentData.destination.trim()} lookup={destination} network={network} />
              )}

              {formError && destination.status !== 'loading' && destination.status !== 'error' && (
                <p className="text-xs text-muted-foreground">{formError}</p>
              )}
            </>
          )}

          {/* One memo for the whole transaction */}
          {(compactPayments.length > 0 || !hasActiveForm) && (
            <div className="space-y-2">
              <Label htmlFor="memo" className="text-sm font-medium">Transaction memo (optional)</Label>
              <div className="flex gap-2">
                <select
                  aria-label="Memo type"
                  className="h-10 rounded-md border border-border/60 bg-background px-2 text-xs"
                  value={memo.type}
                  onChange={(e) => setMemo({ ...memo, type: e.target.value as TransactionMemo['type'] })}
                >
                  <option value="text">Text</option>
                  <option value="id">ID</option>
                </select>
                <Input
                  id="memo"
                  placeholder={memo.type === 'id' ? 'Numeric memo, e.g. 123456' : 'Up to 28 bytes'}
                  inputMode={memo.type === 'id' ? 'numeric' : 'text'}
                  className="font-address text-xs bg-background border-border/60 focus:border-primary"
                  value={memo.value}
                  onChange={(e) => {
                    setMemo({ ...memo, value: e.target.value });
                    onClearTransaction?.();
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">A transaction has a single memo, shared by all its operations.</p>
              {currentMemoError && <p className="text-xs text-destructive">{currentMemoError}</p>}
              {needsMemo && <p className="text-xs text-destructive">A destination in this transaction requires a memo.</p>}
            </div>
          )}

          <div className="flex gap-3 px-1">
            {hasActiveForm && (
              <>
                {!hasMerge && (
                  <Button
                    onClick={addPayment}
                    variant="outline"
                    size="lg"
                    className="flex-1 min-w-0 border-dashed border-primary hover:border-primary hover:bg-primary/5 text-primary hover:text-primary transition-colors hover:animate-[glow-pulse_1s_ease-in-out] active:animate-[glow-expand_0.3s_ease-out]"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    <span className="truncate">Add Operation</span>
                  </Button>
                )}
                <Button
                  onClick={handleBuild}
                  disabled={isBuilding || compactPayments.length === 0 || Boolean(currentMemoError) || needsMemo}
                  className="flex-1 min-w-0 bg-gradient-success text-success-foreground hover:text-success-foreground hover:opacity-90 disabled:opacity-50 hover:animate-[glow-pulse-purple_1s_ease-in-out] active:animate-[glow-expand-purple_0.3s_ease-out]"
                  size="lg"
                >
                  {isBuilding ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      <span className="truncate">Building...</span>
                    </div>
                  ) : (
                    <span className="truncate">Build Transaction</span>
                  )}
                </Button>
              </>
            )}

            {!hasActiveForm &&
              (editingPaymentId ? (
                <>
                  <Button
                    onClick={handleSaveEdit}
                    disabled={!isFormValid()}
                    size="mobile"
                    className="flex-1 min-w-0 !bg-stellar-yellow !text-black hover:!bg-stellar-yellow/90 disabled:opacity-50"
                  >
                    <span className="truncate">Save Changes</span>
                  </Button>
                  <Button onClick={cancelCurrentPayment} variant="destructive" className="flex-1 min-w-0" size="mobile">
                    <span className="truncate">Cancel Edit</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={handleBundlePayment}
                    variant="outline"
                    disabled={!isFormValid()}
                    size="mobile"
                    className="flex-1 min-w-0 border-dashed border-primary hover:border-primary hover:bg-primary/5 text-primary hover:text-primary transition-colors disabled:opacity-50 disabled:border-border/60 disabled:text-muted-foreground hover:animate-[glow-pulse_1s_ease-in-out] active:animate-[glow-expand_0.3s_ease-out]"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    <span className="truncate">Bundle</span>
                  </Button>
                  <Button onClick={cancelCurrentPayment} variant="destructive" className="flex-1 min-w-0" size="mobile">
                    <span className="truncate">Cancel</span>
                  </Button>
                </>
              ))}
          </div>
        </div>
      )}

      <QRScanner isOpen={showQRScanner} onClose={() => setShowQRScanner(false)} onScan={handleQRScan} />
    </div>
  );
};
