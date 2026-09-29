import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Copy, FileText, Hash, User, Coins, Clock, Signature, Check, AlertTriangle, ExternalLink, Shield, Settings, Users, Info } from 'lucide-react';
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
import { openExternal } from '@/lib/utils';
import { Operation, StrKey } from '@stellar/stellar-sdk';

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

const NOTICE_STYLE: Record<Notice['severity'], string> = {
  critical: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/5 text-warning',
  info: 'border-border bg-secondary/30 text-muted-foreground',
};

const NoticeList = ({ notices, compact = false }: { notices: Notice[]; compact?: boolean }) =>
  notices.length === 0 ? null : (
    <div className={compact ? 'space-y-1 w-full' : 'space-y-2'}>
      {[...notices].sort(bySeverity).map((notice, i) => (
        <div key={i} className={`flex items-start gap-2 rounded border ${compact ? 'px-2 py-1' : 'p-2'} text-xs ${NOTICE_STYLE[notice.severity]}`}>
          {notice.severity === 'info' ? <Info className="h-3 w-3 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />}
          <span className="text-foreground">{notice.text}</span>
        </div>
      ))}
    </div>
  );

const FieldList = ({ fields }: { fields: Field[] }) =>
  fields.length === 0 ? null : (
    <div className="text-sm space-y-1">
      {fields.map((field, i) => (
        <p key={i} className="break-words">
          <span className="text-muted-foreground">{field.label}:</span>
          <span className={field.mono ? 'font-address text-xs ml-1 break-all' : 'ml-1'}>{field.value}</span>
        </p>
      ))}
    </div>
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

export const XdrDetails = ({ xdr, defaultExpanded = true, networkType, offlineMode = false, accountData }: XdrDetailsProps) => {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const [opsExpanded, setOpsExpanded] = useState(false);


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

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copied to clipboard',
        description: 'Content has been copied to your clipboard',
      });
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="shadow-card">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Transaction Verification
              </CardTitle>
              {protocolMatch && (
                <ProtocolBadge
                  protocol={protocolMatch.protocol}
                  role={protocolMatch.role}
                  confidence={protocolMatch.confidence}
                  size="sm"
                />
              )}
              {hasUnknownCall && <UnknownContractBadge size="sm" />}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(!isOpen)}
              className="shrink-0 ml-2"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </Button>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4">

            {foreignOps.length > 0 && (
              <div className="p-3 rounded-lg border border-warning/40 bg-warning/5 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                <p className="text-sm text-foreground">
                  {foreignOps.length} operation{foreignOps.length > 1 ? 's act' : ' acts'} on another account than the
                  transaction source (see "Acts on" below). Signing may authorise moving that account's funds.
                </p>
              </div>
            )}

            {/* Fee, validity and sequence problems: these can matter more than the operations */}
            <NoticeList notices={details.notices} />

            {/* What this transaction does to the account's signers and thresholds */}
            {interpretation && (
              <AccountChangeSummary
                interpretation={interpretation}
                network={networkId}
                offlineMode={offlineMode}
              />
            )}

            {/* What this contract call actually does */}
            {contractCalls.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">Smart Contract Activity</h4>
                <ProtocolSummary
                  calls={contractCalls}
                  network={networkId}
                  offlineMode={offlineMode}
                />
              </div>
            )}

            {/* Raw XDR */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Raw XDR</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(xdr)}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="font-address text-xs break-all text-muted-foreground">
                {xdr}
              </p>
            </div>

            <div className="space-y-4">
              {isFeeBump && (
                <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <Badge className="mb-2 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                    Fee-Bump Transaction
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    The fee is paid by <span className="font-address text-xs break-all">{feeSource}</span>
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Source Account:</span>
                  </div>
                  <p className="font-address text-xs bg-muted p-2 rounded break-all">{sourceAccount}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Network:</span>
                  </div>
                  <p className="text-sm">{networkType === 'mainnet' ? 'Mainnet' : 'Testnet'}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Maximum fee:</span>
                  </div>
                  <p className="text-sm">
                    {details.fee.total} XLM
                    {details.fee.resource !== undefined && (
                      <span className="block text-xs text-muted-foreground">
                        {details.fee.inclusion} XLM inclusion + {details.fee.resource} XLM contract resources
                      </span>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Signature className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Signatures attached:</span>
                  </div>
                  <p className="text-sm">
                    {signatures.length}
                    <span className="text-xs text-muted-foreground"> (only valid ones count toward the thresholds)</span>
                  </p>
                </div>
              </div>

              {/* Operations */}
              <Collapsible open={opsExpanded} onOpenChange={setOpsExpanded}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Operations ({operations.length})</h4>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <ChevronDown className={`h-4 w-4 transition-transform ${opsExpanded ? 'rotate-180' : ''}`} />
                      <span className="ml-1 text-xs">{opsExpanded ? 'Hide details' : 'Details'}</span>
                    </Button>
                  </CollapsibleTrigger>
                </div>
                {/* Collapsed: one line per operation with its counterparty and amounts, plus any
                    warning. Expanded: the detailed cards below replace this list. */}
                <div className={`space-y-1 ${opsExpanded ? 'hidden' : ''}`}>
                  {operations.map((op, index) => {
                    const call = contractCalls.find((c) => c.opIndex === index);
                    const view = views[index];
                    return (
                      <div key={index} className="px-3 py-1.5 bg-secondary/30 rounded text-sm space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">{op.type}</Badge>
                          <span className="text-xs break-words min-w-0">{view.summary}</span>
                          {foreignSource(op) && (
                            <Badge variant="outline" className="text-xs border-warning/60 text-warning">
                              acts on {shortAddress(foreignSource(op)!)}
                            </Badge>
                          )}
                          {call?.match && (
                            <>
                              <ProtocolBadge
                                protocol={call.match.protocol}
                                role={call.match.role}
                                confidence={call.match.confidence}
                                size="sm"
                              />
                              <span className="text-muted-foreground text-xs truncate">
                                {call.match.signature?.action ?? call.functionName}
                              </span>
                            </>
                          )}
                          {call && !call.match && <UnknownContractBadge size="sm" />}
                        </div>
                        <NoticeList notices={view.notices.filter((n) => n.severity !== 'info')} compact />
                      </div>
                    );
                  })}
                </div>
                <CollapsibleContent>
                <div className="space-y-2 mt-2">
                  {operations.map((op, index) => (
                    <div key={index} className="p-3 bg-secondary/30 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 space-y-2 min-w-0">
                          <Badge variant="outline">
                            {op.type}
                          </Badge>
                          <p className="text-sm font-medium break-words">{views[index].summary}</p>
                          {foreignSource(op) && (
                            <p className="text-sm break-words">
                              <span className="text-warning font-medium">Acts on:</span>
                              <span className="font-address text-xs ml-1 break-all">{foreignSource(op)}</span>
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
                              ? 'Pre-authorised transaction'
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
                              <div className="text-sm space-y-2">
                                <div className="flex items-center gap-2">
                                  <Settings className="w-4 h-4 text-muted-foreground" />
                                  <span className="font-medium">Account Configuration Change</span>
                                </div>

                                {signer && (
                                  <div className="p-3 bg-secondary/50 rounded-lg">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Users className="w-4 h-4 text-muted-foreground" />
                                      <span className="font-medium">
                                        {signer.weight === 0 ? 'Signer Removal' : 'Signer Modification'}
                                      </span>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="break-words">
                                        <span className="text-muted-foreground">{signerLabel}:</span>
                                        <span className="font-address text-xs ml-1 break-all">{signerKey ?? 'Not specified'}</span>
                                      </p>
                                      <p>
                                        <span className="text-muted-foreground">Weight:</span>
                                        <span className="ml-1 font-medium">{signer.weight ?? 0}</span>
                                        {signer.weight === 0 && (
                                          <span className="ml-2 text-xs text-destructive">removes this signer</span>
                                        )}
                                      </p>
                                    </div>
                                  </div>
                                )}

                                {setOptions.masterWeight !== undefined && setOptions.masterWeight !== null && (
                                  <div className="p-3 bg-secondary/50 rounded-lg">
                                    <div className="flex items-center gap-2 mb-2">
                                      <User className="w-4 h-4 text-muted-foreground" />
                                      <span className="font-medium">Master Key Weight</span>
                                    </div>
                                    <p>
                                      <span className="text-muted-foreground">Weight:</span>
                                      <span className="ml-1 font-medium">{setOptions.masterWeight}</span>
                                      {setOptions.masterWeight === 0 && (
                                        <span className="ml-2 text-xs text-muted-foreground">the account can no longer sign for itself</span>
                                      )}
                                    </p>
                                  </div>
                                )}

                                {thresholds.length > 0 && (
                                  <div className="p-3 bg-secondary/50 rounded-lg">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Shield className="w-4 h-4 text-muted-foreground" />
                                      <span className="font-medium">Threshold Changes</span>
                                    </div>
                                    <div className="space-y-1">
                                      {thresholds.map(([field, label, hint]) => (
                                        <p key={field}>
                                          <span className="text-muted-foreground">{label}:</span>
                                          <span className="ml-1 font-medium">{setOptions[field]}</span>
                                          <span className="ml-2 text-xs text-muted-foreground">({hint})</span>
                                        </p>
                                      ))}
                                      <p className="text-xs text-muted-foreground">
                                        These are combined signer weights, not signer counts
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          <NoticeList notices={views[index].notices} />
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                              View raw operation data
                            </summary>
                            <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-x-auto">
                              {JSON.stringify(op, null, 2)}
                            </pre>
                          </details>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                </CollapsibleContent>
              </div>
              </Collapsible>

              {/* Memo */}
              {details.memo && (
                <div className="space-y-2">
                  <h4 className="font-medium">Memo</h4>
                  <div className="p-3 bg-secondary/30 rounded-lg">
                    <Badge variant="outline" className="mb-2">
                      {details.memo.type}
                    </Badge>
                    {details.memo.text && <p className="text-sm break-all">{details.memo.text}</p>}
                    {details.memo.hex && (
                      <p className="text-xs text-muted-foreground break-all">
                        Bytes: <span className="font-address">{details.memo.hex}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* When it can land */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium text-sm">Validity</span>
                </div>
                <FieldList fields={details.validity} />
              </div>

              {/* Transaction Verification */}
            <div className="border-t pt-6 mt-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-success/20 flex items-center justify-center ring-1 ring-primary/30">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold text-primary">Verify Transaction</h4>
                </div>
              </div>

              {/* Transaction Hash */}
              <div className="p-3 bg-secondary/50 rounded-lg mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Transaction Hash</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(hash)}
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="font-address text-xs break-all text-muted-foreground">
                  {hash}
                </p>
              </div>

              <p className="text-sm text-foreground mb-4">
                {offlineMode
                  ? 'Compare the transaction hash above with your signing device. They must match exactly before signing.'
                  : 'Compare the transaction hash above with your signing device and Stellar Lab.'
                }
              </p>
              {offlineMode && (
                <p className="text-xs text-muted-foreground mb-4">
                  This device is offline - only local verification is available.
                </p>
              )}

              {!offlineMode && (
                <Button
                  variant="glow"
                  onClick={() => {
                    const baseUrl = 'https://lab.stellar.org/xdr/view';

                    // XDR encoding rule: Every / becomes //
                    const encodedXdr = xdr.replace(/\//g, '//');

                    const params = networkType === 'mainnet'
                      ? `$=network$id=mainnet&label=Mainnet&horizonUrl=https:////horizon.stellar.org&rpcUrl=https:////rpc.lightsail.network//&passphrase=Public%20Global%20Stellar%20Network%20/;%20September%202015;&xdr$blob=${encodedXdr};;`
                      : `$=network$id=testnet&label=Testnet&horizonUrl=https:////horizon-testnet.stellar.org&rpcUrl=https:////soroban-testnet.stellar.org//&passphrase=Test%20SDF%20Network%20/;%20September%202015;&xdr$blob=${encodedXdr};;`;

                    openExternal(`${baseUrl}?${params}`);
                  }}
                  className="w-full h-11"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Verify on Stellar Lab
                </Button>
              )}
            </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
