import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Copy, FileText, Hash, User, Coins, Clock, Signature, Check, AlertTriangle } from 'lucide-react';
import { generateTransactionFingerprint } from '@/lib/xdr/fingerprint';
import { useToast } from '@/hooks/use-toast';
import { tryParseTransaction, getInnerTransaction } from '@/lib/xdr/parse';
import { Operation } from '@stellar/stellar-sdk';

// Type helpers for operation details
type PaymentOp = Operation & { destination?: string; amount?: string; asset?: { code?: string } };
type PathPaymentOp = Operation & { 
  destination?: string; 
  sendAmount?: string; 
  sendAsset?: { code?: string }; 
  destMin?: string; 
  destAsset?: { code?: string } 
};
type ChangeTrustOp = Operation & { asset?: { code?: string }; limit?: string };
type SetOptionsOp = Operation & { signer?: { key?: string } };

interface XdrDetailsProps {
  xdr: string;
  defaultExpanded?: boolean;
}

export const XdrDetails = ({ xdr, defaultExpanded = false }: XdrDetailsProps) => {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const parsed = tryParseTransaction(xdr);
  
  if (!parsed) {
    return null; // Don't render if XDR is invalid
  }

  const { tx, network, isFeeBump } = parsed;
  const transaction = getInnerTransaction(tx);
  const hash = tx.hash().toString('hex');
  const fingerprint = generateTransactionFingerprint(xdr);
  const sourceAccount = transaction.source;
  const fee = tx.fee;
  const operations = transaction.operations;
  const memo = transaction.memo;
  const sequence = transaction.sequence;
  const timeBounds = transaction.timeBounds;
  const signatures = tx.signatures;

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
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Advanced Transaction Details
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                View transaction hash, operations, and decoded information
              </p>
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
            {/* Transaction Hash */}
            <div className="p-3 bg-secondary/50 rounded-lg">
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
              <p className="font-mono font-address text-xs break-all text-muted-foreground">
                {hash}
              </p>
            </div>

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
              <p className="font-mono font-address text-xs break-all text-muted-foreground">
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
                    This transaction is sponsored with additional fees
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Source Account:</span>
                  </div>
                  <p className="font-mono font-address text-xs bg-muted p-2 rounded break-all">{sourceAccount}</p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Network:</span>
                  </div>
                  <p className="text-sm">{network === 'public' ? 'Mainnet' : 'Testnet'}</p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Fee:</span>
                  </div>
                  <p className="text-sm">{fee} stroops</p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Signature className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Signatures:</span>
                  </div>
                  <p className="text-sm">{signatures.length} signature(s)</p>
                </div>
              </div>

              {/* Operations */}
              <div className="space-y-2">
                <h4 className="font-medium">Operations ({operations.length})</h4>
                <div className="space-y-2">
                  {operations.map((op, index) => (
                    <div key={index} className="p-3 bg-secondary/30 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <Badge variant="outline" className="mb-2">
                            {op.type}
                          </Badge>
                          {op.type === 'payment' && (
                            <div className="text-sm space-y-1">
                              <p className="break-words">
                                <span className="text-muted-foreground">To:</span> 
                                <span className="font-mono font-address text-xs ml-1 break-all">{(op as Operation & { destination?: string }).destination}</span>
                              </p>
                              <p>
                                <span className="text-muted-foreground">Amount:</span> {(op as Operation & { amount?: string; asset?: { code?: string } }).amount} {(op as Operation & { amount?: string; asset?: { code?: string } }).asset?.code || 'XLM'}
                              </p>
                            </div>
                          )}
                          {op.type === 'pathPaymentStrictSend' && (
                            <div className="text-sm space-y-1">
                              <p className="break-words">
                                <span className="text-muted-foreground">To:</span> 
                                <span className="font-mono text-xs ml-1 break-all">{(op as PathPaymentOp).destination}</span>
                              </p>
                              <p>
                                <span className="text-muted-foreground">Send:</span> {(op as PathPaymentOp).sendAmount} {(op as PathPaymentOp).sendAsset?.code || 'XLM'}
                              </p>
                              <p>
                                <span className="text-muted-foreground">Receive (min):</span> {(op as PathPaymentOp).destMin} {(op as PathPaymentOp).destAsset?.code || 'XLM'}
                              </p>
                            </div>
                          )}
                          {op.type === 'accountMerge' && (
                            <div className="text-sm space-y-1">
                              <p className="break-words">
                                <span className="text-muted-foreground">Into:</span> 
                                <span className="font-mono text-xs ml-1 break-all">{(op as Operation & { destination?: string }).destination}</span>
                              </p>
                              <div className="mt-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-xs">
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="h-3 w-3 text-destructive" />
                                  <span className="text-destructive font-medium">Account will be closed and all funds transferred</span>
                                </div>
                              </div>
                            </div>
                          )}
                          {op.type === 'changeTrust' && (
                            <div className="text-sm space-y-1">
                              <p>
                                <span className="text-muted-foreground">Asset:</span> {(op as ChangeTrustOp).asset?.code || 'Unknown'}
                              </p>
                              <p>
                                <span className="text-muted-foreground">Limit:</span> {(op as ChangeTrustOp).limit || 'MAX'}
                              </p>
                              {(op as ChangeTrustOp).limit === '0' && (
                                <div className="mt-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-xs">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-3 w-3 text-destructive" />
                                    <span className="text-destructive font-medium">Trustline will be removed</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {op.type === 'setOptions' && (
                            <div className="text-sm space-y-1">
                              <p className="text-muted-foreground">Account settings will be modified</p>
                              {(op as SetOptionsOp).signer && (
                                <p className="break-words">
                                  <span className="text-muted-foreground">Signer:</span> 
                                  <span className="font-mono text-xs ml-1 break-all">{(op as SetOptionsOp).signer?.key}</span>
                                </p>
                              )}
                            </div>
                          )}
                          {!['payment', 'pathPaymentStrictSend', 'accountMerge', 'changeTrust', 'setOptions'].includes(op.type) && (
                            <div className="text-sm">
                              <p className="text-muted-foreground">Operation details:</p>
                              <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-x-auto">
                                {JSON.stringify(op, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Memo */}
              {memo && memo.type !== 'none' && (
                <div className="space-y-2">
                  <h4 className="font-medium">Memo</h4>
                  <div className="p-3 bg-secondary/30 rounded-lg">
                    <Badge variant="outline" className="mb-2">
                      {memo.type}
                    </Badge>
                    <p className="text-sm break-all">{memo.value?.toString()}</p>
                  </div>
                </div>
              )}

              {/* Additional Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Sequence:</span>
                  </div>
                  <p className="text-sm">{sequence}</p>
                </div>
                
                {timeBounds && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">Time Bounds:</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {timeBounds.minTime && <p>Min: {new Date(Number(timeBounds.minTime) * 1000).toLocaleString()}</p>}
                      {timeBounds.maxTime && <p>Max: {new Date(Number(timeBounds.maxTime) * 1000).toLocaleString()}</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};