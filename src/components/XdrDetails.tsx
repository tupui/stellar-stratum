import { Fragment, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, ExternalLink } from 'lucide-react';
import { Notice as NoticeBox } from '@/components/brand/Shell';
import { HashField } from '@/components/HashField';
import { analyzeOperations, dominantProtocol } from '@/lib/protocols/detect';
import { ProtocolSummary } from '@/components/transaction/ProtocolSummary';
import { AccountChangeSummary } from '@/components/transaction/AccountChangeSummary';
import { interpretTransaction } from '@/lib/xdr/interpret';
import { bySeverity, describeOperation, describeTransaction, shortAddress, type Field, type Notice } from '@/lib/xdr/describe';
import type { AccountData } from '@/lib/stellar';
import { ProtocolBadge, UnknownContractBadge } from '@/components/transaction/ProtocolBadge';
import { useToast } from '@/hooks/use-toast';
import { tryParseTransaction, getInnerTransaction, getTransactionHash } from '@/lib/xdr/parse';
import { baseAccountId } from '@/lib/signatures';
import { cn, copyText, openExternal } from '@/lib/utils';
import { Operation, StrKey } from '@stellar/stellar-sdk';
import { operationLabel } from '@/lib/labels';

type SetOptionsOp = Operation & {
  signer?: {
    weight?: number;
    ed25519PublicKey?: string;
    preAuthTx?: Uint8Array;
    sha256Hash?: Uint8Array;
    ed25519SignedPayload?: string;
  };
  masterWeight?: number | null;
  lowThreshold?: number | null;
  medThreshold?: number | null;
  highThreshold?: number | null;
};

/**
 * Red for what the network will refuse or what can lock the account; amber for a warning.
 * Some refusals are plain warnings in describe.ts, so their wording decides.
 */
const noticeLevel = (notice: Notice): 'error' | 'warning' | 'info' =>
  notice.severity === 'critical' || /network will reject/i.test(notice.text)
    ? 'error'
    : notice.severity === 'warning'
      ? 'warning'
      : 'info';

const NoticeList = ({ notices }: { notices: Notice[] }) =>
  notices.length === 0 ? null : (
    <div className="flex flex-col gap-2">
      {[...notices].sort(bySeverity).map((notice, i) => (
        <NoticeBox key={i} level={noticeLevel(notice)}>
          {notice.text}
        </NoticeBox>
      ))}
    </div>
  );

/** An operation's warnings, one line each, under its row in the list. */
const CompactNotices = ({ notices }: { notices: Notice[] }) =>
  notices.length === 0 ? null : (
    <ul className="flex w-full flex-col gap-1">
      {[...notices].sort(bySeverity).map((notice, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px]">
          <AlertTriangle
            className={cn('mt-0.5 h-4 w-4 shrink-0', noticeLevel(notice) === 'error' ? 'text-destructive' : 'text-warning')}
            aria-hidden
          />
          <span>{notice.text}</span>
        </li>
      ))}
    </ul>
  );

const FieldList = ({ fields }: { fields: Field[] }) =>
  fields.length === 0 ? null : (
    <div className="space-y-1 text-sm">
      {fields.map((field, i) => (
        <p key={i} className="break-words">
          <span className="text-muted-foreground">{field.label}:</span>
          <span className={field.mono ? 'ml-1 break-all font-address text-[13px]' : 'ml-1'}>{field.value}</span>
        </p>
      ))}
    </div>
  );

/** Key-value rows: the label muted at left, the value at right, a hairline between rows. */
const KV_CELL = 'm-0 border-t border-line px-4 py-2.5';
const Kv = ({ rows }: { rows: { label: string; value: ReactNode; mono?: boolean }[] }) => (
  <dl className="grid grid-cols-[minmax(0,1fr)_auto]">
    {rows.map((row) => (
      <Fragment key={row.label}>
        <dt className={cn(KV_CELL, 'text-muted-foreground')}>{row.label}</dt>
        <dd className={cn(KV_CELL, 'min-w-0 text-right', row.mono && 'break-all font-address')}>{row.value}</dd>
      </Fragment>
    ))}
  </dl>
);

const SHORT_ADDRESS = /([GCM][A-Z2-7]{7}…[A-Z2-7]{8})/;

/** An operation's summary sentence, its shortened addresses in mono. */
const Summary = ({ text }: { text: string }) => (
  <>
    {text.split(SHORT_ADDRESS).map((part, i) =>
      i % 2 ? (
        <span key={i} className="whitespace-nowrap font-address text-[.82em]">
          {part}
        </span>
      ) : (
        part
      ),
    )}
  </>
);

/** A subhead inside a block, over a hairline. */
const SubHead = ({ children }: { children: ReactNode }) => (
  <h3 className="sub border-t border-line px-4 pb-2 pt-3">{children}</h3>
);

/** A frameless icon button with a 44 px hit area, for a row action. */
const RowAction = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    className="-my-3 -mr-3 inline-grid size-11 shrink-0 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
  >
    {children}
  </button>
);

interface XdrDetailsProps {
  xdr: string;
  defaultExpanded?: boolean;
  /** The network the transaction is signed for: it decides the hash. */
  networkType: 'mainnet' | 'testnet';
  offlineMode?: boolean;
  /** Current account state, used to show setOptions changes as before → after. */
  accountData?: AccountData | null;
}

/**
 * The Transaction Verification block. On the phone it is bare, its blocks divided by hairlines
 * that run to its edges (the page adds no gutter around it); from sm up it is a panel.
 */
export const XdrDetails = ({ xdr, defaultExpanded = true, networkType, offlineMode = false, accountData }: XdrDetailsProps) => {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const [opsExpanded, setOpsExpanded] = useState(false);
  // a raw XDR longer than this many characters shows five lines until opened
  const [xdrOpen, setXdrOpen] = useState(false);
  const xdrLong = xdr.length > 300;
  const titleId = useId();
  const xdrId = useId();

  const parsed = tryParseTransaction(xdr, networkType);

  if (!parsed) {
    return null; // Don't render if XDR is invalid
  }

  const { tx, isFeeBump } = parsed;
  const transaction = getInnerTransaction(tx);
  const hash = getTransactionHash(tx);
  const sourceAccount = transaction.source;
  // A muxed (M…) source is the same account as its G… base.
  const sourceBase = baseAccountId(sourceAccount);
  const feeSource = isFeeBump && 'feeSource' in tx ? tx.feeSource : undefined;
  // Operations can act on an account other than the transaction source; that must be visible.
  const foreignSource = (op: Operation) => {
    const { source } = op as { source?: string };
    return source && baseAccountId(source) !== sourceBase ? source : undefined;
  };
  const foreignOps = transaction.operations.filter((op) => foreignSource(op));
  const operations = transaction.operations;
  const signatures = tx.signatures;

  // Soroban invocations, matched against the DeFi protocols we know how to read.
  const networkId = networkType;
  const contractCalls = analyzeOperations(operations, networkId, sourceBase);
  const protocol = dominantProtocol(contractCalls);
  const protocolMatch = protocol
    ? contractCalls.find((call) => call.match?.protocol === protocol)?.match
    : undefined;
  const hasUnknownCall = contractCalls.some((call) => !call.match);

  // Plain-language reading of account configuration changes. Only compare against the live
  // account when it is the one the transaction acts on — otherwise the "before" side would
  // describe a different account.
  const knowsSource = accountData?.publicKey === sourceBase;
  const snapshot =
    accountData && knowsSource
      ? {
          publicKey: accountData.publicKey,
          signers: accountData.signers.map(({ key, weight }) => ({ key, weight })),
          thresholds: {
            low: accountData.thresholds.low_threshold,
            med: accountData.thresholds.med_threshold,
            high: accountData.thresholds.high_threshold,
          },
        }
      : null;
  const interpretation = interpretTransaction(operations, { sourceAccount: sourceBase, account: snapshot });

  // Fee, validity, sequence number and memo, with anything unusual called out.
  const details = describeTransaction(tx, {
    account: accountData && knowsSource ? { publicKey: accountData.publicKey, sequence: accountData.sequence } : null,
  });
  const views = operations.map((op) => describeOperation(op, networkId));
  const single = operations.length === 1;

  const copyXdr = async () => {
    try {
      await copyText(xdr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copied to clipboard',
        description: 'Content has been copied to your clipboard',
      });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  const openLab = () => {
    const baseUrl = 'https://lab.stellar.org/xdr/view';

    // XDR encoding rule: Every / becomes //
    const encodedXdr = xdr.replace(/\//g, '//');

    const params = networkType === 'mainnet'
      ? `$=network$id=mainnet&label=Mainnet&horizonUrl=https:////horizon.stellar.org&rpcUrl=https:////rpc.lightsail.network//&passphrase=Public%20Global%20Stellar%20Network%20/;%20September%202015;&xdr$blob=${encodedXdr};;`
      : `$=network$id=testnet&label=Testnet&horizonUrl=https:////horizon-testnet.stellar.org&rpcUrl=https:////soroban-testnet.stellar.org//&passphrase=Test%20SDF%20Network%20/;%20September%202015;&xdr$blob=${encodedXdr};;`;

    openExternal(`${baseUrl}?${params}`);
  };

  /** Everything an operation carries, for the Details view. */
  const operationDetail = (op: (typeof operations)[number], index: number) => (
    <div key={index} className="well min-w-0 space-y-3">
      <Badge>{operationLabel(op.type)}</Badge>
      <p className="break-words font-semibold">
        <Summary text={views[index].summary} />
      </p>
      {foreignSource(op) && (
        <p className="break-words text-sm">
          <span className="font-semibold text-warning">Acts on:</span>
          <span className="ml-1 break-all font-address text-[13px]">{foreignSource(op)}</span>
          <span className="ml-1 text-xs text-muted-foreground">(not the transaction source)</span>
        </p>
      )}
      <FieldList fields={views[index].fields} />
      {op.type === 'setOptions' && (() => {
        const setOptions = op as SetOptionsOp;
        const signer = setOptions.signer;
        // Hash-based signers decode as raw bytes; show them as the strkeys Horizon uses.
        const signerKey =
          signer?.ed25519PublicKey ??
          signer?.ed25519SignedPayload ??
          (signer?.preAuthTx ? StrKey.encodePreAuthTx(Buffer.from(signer.preAuthTx)) : undefined) ??
          (signer?.sha256Hash ? StrKey.encodeSha256Hash(Buffer.from(signer.sha256Hash)) : undefined);
        const signerLabel = signer?.preAuthTx
          ? 'Pre-authorized transaction'
          : signer?.sha256Hash
            ? 'Hash(x) signer'
            : signer?.ed25519SignedPayload
              ? 'Signed payload signer'
              : 'Public Key';
        // A threshold of 0 is meaningful, so test for presence, not truthiness.
        const thresholds = ([
          ['lowThreshold', 'Low Threshold', 'basic operations'],
          ['medThreshold', 'Medium Threshold', 'payment operations'],
          ['highThreshold', 'High Threshold', 'account changes'],
        ] as const).filter(([field]) => setOptions[field] !== undefined && setOptions[field] !== null);

        return (
          <div className="space-y-3 text-sm">
            <p className="font-semibold">Account Configuration Change</p>

            {signer && (
              <div className="space-y-1 border-t border-line pt-3">
                <p className="font-semibold">{signer.weight === 0 ? 'Signer Removal' : 'Signer Modification'}</p>
                <p className="break-words">
                  <span className="text-muted-foreground">{signerLabel}:</span>
                  <span className="ml-1 break-all font-address text-[13px]">{signerKey ?? 'Not specified'}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Weight:</span>
                  <span className="ml-1 font-semibold">{signer.weight ?? 0}</span>
                  {signer.weight === 0 && <span className="ml-2 text-xs text-destructive">removes this signer</span>}
                </p>
              </div>
            )}

            {setOptions.masterWeight !== undefined && setOptions.masterWeight !== null && (
              <div className="space-y-1 border-t border-line pt-3">
                <p className="font-semibold">Master Key Weight</p>
                <p>
                  <span className="text-muted-foreground">Weight:</span>
                  <span className="ml-1 font-semibold">{setOptions.masterWeight}</span>
                  {setOptions.masterWeight === 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">the account can no longer sign for itself</span>
                  )}
                </p>
              </div>
            )}

            {thresholds.length > 0 && (
              <div className="space-y-1 border-t border-line pt-3">
                <p className="font-semibold">Threshold Changes</p>
                {thresholds.map(([field, label, hint]) => (
                  <p key={field}>
                    <span className="text-muted-foreground">{label}:</span>
                    <span className="ml-1 font-semibold">{setOptions[field]}</span>
                    <span className="ml-2 text-xs text-muted-foreground">({hint})</span>
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">These are combined signer weights, not signer counts</p>
              </div>
            )}
          </div>
        );
      })()}
      <NoticeList notices={views[index].notices} />
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-[13px] text-muted-foreground hover:text-foreground">
          View raw operation data
        </summary>
        <pre className="overflow-x-auto bg-ink-2 p-2 font-mono text-xs">{JSON.stringify(op, null, 2)}</pre>
      </details>
    </div>
  );

  return (
    <section aria-labelledby={titleId} className="min-w-0 sm:border sm:border-line sm:bg-ink-2">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="sec">
            Transaction Verification
          </h2>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-label={isOpen ? 'Collapse Transaction Verification' : 'Expand Transaction Verification'}
            aria-expanded={isOpen}
            className="ml-auto inline-grid size-11 shrink-0 place-items-center border border-line-2 text-foreground hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </div>

        {isOpen && (
          <>
            {(foreignOps.length > 0 || details.notices.length > 0) && (
              <div className="flex flex-col gap-2">
                {foreignOps.length > 0 && (
                  <NoticeBox level="warning">
                    {foreignOps.length} operation{foreignOps.length > 1 ? 's act' : ' acts'} on another account than the
                    transaction source (see "Acts on" below). Signing may authorize moving that account's funds.
                  </NoticeBox>
                )}
                {/* Fee, validity and sequence problems: these can matter more than the operations */}
                <NoticeList notices={details.notices} />
              </div>
            )}

            {/* Operations: the sentence for one, a row each for several; Details shows everything */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {single && <Badge>{operationLabel(operations[0].type)}</Badge>}
                <span className="text-[13px] text-muted-foreground">Operations ({operations.length})</span>
                {protocolMatch && (
                  <ProtocolBadge protocol={protocolMatch.protocol} role={protocolMatch.role} confidence={protocolMatch.confidence} />
                )}
                {hasUnknownCall && <UnknownContractBadge />}
                <button
                  type="button"
                  onClick={() => setOpsExpanded(!opsExpanded)}
                  aria-expanded={opsExpanded}
                  className="ml-auto inline-flex min-h-11 items-center gap-2 px-1 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {opsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {opsExpanded ? 'Hide details' : 'Details'}
                </button>
              </div>

              {single && (
                <div className="mt-1 space-y-2">
                  <p className="break-words text-[22px] font-semibold leading-[1.3]">
                    <Summary text={views[0].summary} />
                  </p>
                  {foreignSource(operations[0]) && <Badge variant="warning">acts on {shortAddress(foreignSource(operations[0])!)}</Badge>}
                  {!opsExpanded && <CompactNotices notices={views[0].notices.filter((n) => n.severity !== 'info')} />}
                </div>
              )}

              {/* Collapsed: one line per operation with its counterparty and amounts, plus any
                  warning. Expanded: the detailed blocks below replace this list. */}
              {!single && !opsExpanded && (
                <ul>
                  {operations.map((op, index) => {
                    const call = contractCalls.find((c) => c.opIndex === index);
                    return (
                      <li key={index} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0">
                        <Badge>{operationLabel(op.type)}</Badge>
                        <span className="min-w-0 break-words">
                          <Summary text={views[index].summary} />
                        </span>
                        {foreignSource(op) && <Badge variant="warning">acts on {shortAddress(foreignSource(op)!)}</Badge>}
                        {call?.match && (
                          <>
                            <ProtocolBadge protocol={call.match.protocol} role={call.match.role} confidence={call.match.confidence} />
                            <span className="truncate text-[13px] text-muted-foreground">
                              {call.match.signature?.action ?? call.functionName}
                            </span>
                          </>
                        )}
                        {call && !call.match && <UnknownContractBadge />}
                        <CompactNotices notices={views[index].notices.filter((n) => n.severity !== 'info')} />
                      </li>
                    );
                  })}
                </ul>
              )}

              {opsExpanded && (
                <div className="mt-3 space-y-3">
                  {operations.map((op, index) => operationDetail(op, index))}
                </div>
              )}
            </div>

            {/* What this transaction does to the account's signers and thresholds */}
            {interpretation && (
              <AccountChangeSummary interpretation={interpretation} network={networkId} offlineMode={offlineMode} />
            )}

            {/* What this contract call actually does */}
            {contractCalls.length > 0 && (
              <div className="space-y-3">
                <h3 className="sub">Smart Contract Activity</h3>
                <ProtocolSummary calls={contractCalls} network={networkId} offlineMode={offlineMode} />
              </div>
            )}
          </>
        )}
      </div>

      {isOpen && (
        <>
          <div className="flex flex-col gap-3 border-t border-line p-4">
            <h3 className="sub">Verify Transaction</h3>
            <HashField label="Transaction hash" value={hash} />
            <p className="text-[13px] text-muted-foreground">
              {offlineMode
                ? 'Compare the transaction hash above with your signing device. They must match exactly before signing.'
                : 'Compare the transaction hash above with your signing device and Stellar Lab.'}
            </p>
            {offlineMode ? (
              <p className="text-[13px] text-muted-foreground">This device is offline - only local verification is available.</p>
            ) : (
              <Button variant="outline" onClick={openLab} className="w-full sm:w-auto sm:self-start">
                <ExternalLink />
                Verify on Stellar Lab
              </Button>
            )}
          </div>

          {isFeeBump && (
            <div className="space-y-2 border-t border-line px-4 py-3">
              <Badge>Fee-Bump Transaction</Badge>
              <p className="text-muted-foreground">
                The fee is paid by <span className="break-all font-address text-[13px] text-foreground">{feeSource}</span>
              </p>
            </div>
          )}

          <div className="border-t border-line px-4 py-3">
            <p className="field-label">Source account</p>
            <p className="mt-1 break-all font-address text-[13px]">{sourceAccount}</p>
          </div>

          <Kv
            rows={[
              { label: 'Network', value: networkType === 'mainnet' ? 'Mainnet' : 'Testnet' },
              {
                label: 'Maximum fee',
                value: (
                  <>
                    {details.fee.total} XLM
                    {details.fee.resource !== undefined && (
                      <span className="block text-xs text-muted-foreground">
                        {details.fee.inclusion} XLM inclusion + {details.fee.resource} XLM contract resources
                      </span>
                    )}
                  </>
                ),
              },
            ]}
          />

          <dl className="grid grid-cols-[minmax(0,1fr)_auto]">
            <dt className={cn(KV_CELL, 'text-muted-foreground')}>Signatures attached</dt>
            <dd className={cn(KV_CELL, 'text-right')}>{signatures.length}</dd>
            <dd className="col-span-2 m-0 px-4 pb-2.5 text-[13px] text-muted-foreground">(only valid ones count toward the thresholds)</dd>
          </dl>

          {details.memo && (
            <>
              <SubHead>Memo</SubHead>
              <div className="space-y-2 px-4 pb-3">
                <Badge>{details.memo.type}</Badge>
                {details.memo.text && <p className="break-all">{details.memo.text}</p>}
                {details.memo.hex && (
                  <p className="break-all text-xs text-muted-foreground">
                    Bytes: <span className="font-address">{details.memo.hex}</span>
                  </p>
                )}
              </div>
            </>
          )}

          {/* When it can land */}
          {details.validity.length > 0 && (
            <>
              <SubHead>Validity</SubHead>
              <Kv
                rows={details.validity.map((field) => ({
                  label: field.label,
                  value: field.value,
                  mono: field.mono || field.label === 'Sequence',
                }))}
              />
            </>
          )}

          <div className="border-t border-line px-4 pb-4 pt-3">
            <div className="flex items-center gap-2">
              <h3 className="sub flex-1">
                <span>Raw XDR</span>
              </h3>
              <RowAction label="Copy raw XDR" onClick={copyXdr}>
                {copied ? <Check className="h-[18px] w-[18px]" /> : <Copy className="h-[18px] w-[18px]" />}
              </RowAction>
            </div>
            {/* The whole XDR stays in the page (copy and the tests read it); a long one is clamped to five
                lines that fade out, with a toggle to read all of it. */}
            <p
              id={xdrId}
              className={cn(
                'mt-2 break-all font-mono text-xs leading-[18px] text-muted-foreground',
                xdrLong && !xdrOpen && 'max-h-[90px] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]',
              )}
            >
              {xdr}
            </p>
            {xdrLong && (
              <button
                type="button"
                aria-expanded={xdrOpen}
                aria-controls={xdrId}
                onClick={() => setXdrOpen((open) => !open)}
                className="-mb-2 mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {xdrOpen ? 'Show Less' : `Show All (${xdr.length.toLocaleString('en-US')} characters)`}
                <ChevronDown className={cn('h-4 w-4', xdrOpen && 'rotate-180')} />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
