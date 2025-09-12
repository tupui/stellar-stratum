import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Copy, FileText, Hash, User, Coins, Clock, Signature, Check, AlertTriangle, ExternalLink, Shield, Settings, Users } from 'lucide-react';
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
type SetOptionsOp = Operation & { 
  signer?: { key?: string; weight?: number }; 
  lowThreshold?: number;
  medThreshold?: number;
  highThreshold?: number;
};

interface XdrDetailsProps {
  xdr: string;
  defaultExpanded?: boolean;
  networkType?: 'mainnet' | 'testnet';
  offlineMode?: boolean;
}

export const XdrDetails = ({ xdr, defaultExpanded = true, networkType, offlineMode = false }: XdrDetailsProps) => {
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
                <Shield className="w-4 h-4" />
                Transaction Verification
              </CardTitle>
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
                            <div className="text-sm space-y-2">
                              <div className="flex items-center gap-2">
                                <Settings className="w-4 h-4 text-muted-foreground" />
                                <span className="font-medium">Account Configuration Change</span>
                              </div>
                              
                              {(() => {
                                // Try to extract signer information from the operation
                                const setOptionsOp = op as any;
                                const signer = setOptionsOp.signers?.[0] || setOptionsOp.signer;
                                
                                if (signer) {
                                  return (
                                    <div className="p-3 bg-secondary/50 rounded-lg">
                                      <div className="flex items-center gap-2 mb-2">
                                        <Users className="w-4 h-4 text-muted-foreground" />
                                        <span className="font-medium">Signer Modification</span>
                                      </div>
                                      <div className="space-y-1">
                                        <p className="break-words">
                                          <span className="text-muted-foreground">Public Key:</span> 
                                          <span className="font-mono text-xs ml-1 break-all">
                                            {signer.key || signer.ed25519PublicKey || 'Not specified'}
                                          </span>
                                        </p>
                                        <p>
                                          <span className="text-muted-foreground">Weight:</span> 
                                          <span className="ml-1 font-medium">{signer.weight || 0}</span>
                                        </p>
                                      </div>
                                    </div>
                                  );
                                }
                                
                                // Fallback: show raw operation data if signer info is not available
                                return (
                                  <div className="p-3 bg-secondary/50 rounded-lg">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Users className="w-4 h-4 text-muted-foreground" />
                                      <span className="font-medium">Signer Modification</span>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-xs text-muted-foreground">
                                        Signer configuration details are being processed...
                                      </p>
                                      <details className="text-xs">
                                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                          View raw operation data
                                        </summary>
                                        <pre className="mt-2 p-2 bg-background/50 rounded text-xs overflow-auto">
                                          {JSON.stringify(setOptionsOp, null, 2)}
                                        </pre>
                                      </details>
                                    </div>
                                  </div>
                                );
                              })()}
                              
                              {((op as SetOptionsOp).lowThreshold || (op as SetOptionsOp).medThreshold || (op as SetOptionsOp).highThreshold) && (
                                <div className="p-3 bg-secondary/50 rounded-lg">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Shield className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-medium">Threshold Changes</span>
                                  </div>
                                  <div className="space-y-1">
                                    {(op as SetOptionsOp).lowThreshold !== undefined && (
                                      <p>
                                        <span className="text-muted-foreground">Low Threshold:</span> 
                                        <span className="ml-1 font-medium">{(op as SetOptionsOp).lowThreshold}</span>
                                        <span className="ml-2 text-xs text-muted-foreground">(basic operations)</span>
                                      </p>
                                    )}
                                    {(op as SetOptionsOp).medThreshold !== undefined && (
                                      <p>
                                        <span className="text-muted-foreground">Medium Threshold:</span> 
                                        <span className="ml-1 font-medium">{(op as SetOptionsOp).medThreshold}</span>
                                        <span className="ml-2 text-xs text-muted-foreground">(payment operations)</span>
                                      </p>
                                    )}
                                    {(op as SetOptionsOp).highThreshold !== undefined && (
                                      <p>
                                        <span className="text-muted-foreground">High Threshold:</span> 
                                        <span className="ml-1 font-medium">{(op as SetOptionsOp).highThreshold}</span>
                                        <span className="ml-2 text-xs text-muted-foreground">(account changes)</span>
                                      </p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                      These thresholds determine how many signatures are required for different types of operations
                                    </p>
                                  </div>
                                </div>
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
                <p className="font-mono font-address text-xs break-all text-muted-foreground">
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
                    
                    let params = '';
                    
                    if (networkType === 'mainnet') {
                      params = `$=network$id=mainnet&label=Mainnet&horizonUrl=https:////horizon.stellar.org&rpcUrl=https:////mainnet.sorobanrpc.com//&passphrase=Public%20Global%20Stellar%20Network%20/;%20September%202015;&xdr$blob=${encodedXdr};;`;
                    } else {
                      params = `$=network$id=testnet&label=Testnet&horizonUrl=https:////horizon-testnet.stellar.org&rpcUrl=https:////soroban-testnet.stellar.org//&passphrase=Test%20SDF%20Network%20/;%20September%202015;&xdr$blob=${encodedXdr};;`;
                    }
                    
                    const url = `${baseUrl}?${params}`;
                    window.open(url, '_blank');
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