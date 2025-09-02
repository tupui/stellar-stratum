import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, Hash, FileText, Copy, Check, AlertTriangle } from 'lucide-react';
import { Transaction } from '@stellar/stellar-sdk';
import { useToast } from '@/hooks/use-toast';
import { getNetworkPassphrase } from '@/lib/stellar';
import { useNetwork } from '@/contexts/NetworkContext';

interface XdrDetailsProps {
  xdr: string;
}

export const XdrDetails = ({ xdr }: XdrDetailsProps) => {
  const { network } = useNetwork();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const { toast } = useToast();

  const getTransactionDetails = () => {
    try {
      const networkPassphrase = getNetworkPassphrase(network);
      const transaction = new Transaction(xdr, networkPassphrase);
      
      return {
        hash: transaction.hash().toString('hex'),
        source: transaction.source,
        fee: transaction.fee,
        operations: transaction.operations.map((op, index) => ({
          index,
          type: op.type,
          // @ts-ignore - Stellar SDK typing issue
          details: op
        })),
        memo: transaction.memo,
        sequence: transaction.sequence,
        timeBounds: transaction.timeBounds,
        signatures: transaction.signatures.length
      };
    } catch (error) {
      return null;
    }
  };

  const details = getTransactionDetails();

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
    toast({
      title: "Copied to clipboard",
      description: `${label} has been copied`,
      duration: 3000,
    });
  };

  if (!details) {
    return null;
  }

  return (
    <Card className="shadow-card">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base sm:text-lg whitespace-nowrap flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Advanced Transaction Details
              </CardTitle>
              <CardDescription>
                View transaction hash, operations, and decoded information
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(!isOpen)}
              className="shrink-0 ml-2"
            >
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Transaction Hash */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4" />
                  <span className="text-sm font-medium">Transaction Hash</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(details.hash, 'Transaction hash')}
                >
                  {copied === 'Transaction hash' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="font-address text-xs break-all text-muted-foreground">
                {details.hash}
              </p>
            </div>

            {/* Raw XDR */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  <span className="text-sm font-medium">Raw XDR</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(xdr, 'XDR')}
                >
                  {copied === 'XDR' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="font-address text-xs break-all text-muted-foreground">
                {xdr}
              </p>
            </div>

            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-medium">Source Account</h4>
                <p className="font-address text-sm text-muted-foreground break-all">
                  {details.source}
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">Network</h4>
                <Badge variant={network === 'mainnet' ? 'default' : 'secondary'}>
                  {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
                </Badge>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">Fee</h4>
                <p className="text-sm">{parseInt(details.fee) / 10000000} XLM</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">Signatures</h4>
                <Badge variant="outline">{details.signatures} signature(s)</Badge>
              </div>
            </div>

            {/* Operations */}
            <div className="space-y-2">
              <h4 className="font-medium">Operations ({details.operations.length})</h4>
              <div className="space-y-2">
                {details.operations.map((op) => (
                  <div key={op.index} className="p-3 bg-secondary/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <Badge variant="outline" className="mb-2">
                          {op.type}
                        </Badge>
                        {op.type === 'payment' && (
                          <div className="text-sm space-y-1">
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            <p className="break-words"><span className="text-muted-foreground">To:</span> <span className="font-address text-xs break-all">{(op.details as any).destination}</span></p>
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            <p><span className="text-muted-foreground">Amount:</span> {(op.details as any).amount} {(op.details as any).asset?.code || 'XLM'}</p>
                          </div>
                        )}
                        {op.type === 'pathPaymentStrictSend' && (
                          <div className="text-sm space-y-1">
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            <p className="break-words"><span className="text-muted-foreground">To:</span> <span className="font-address text-xs break-all">{(op.details as any).destination}</span></p>
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            <p><span className="text-muted-foreground">Send:</span> {(op.details as any).sendAmount} {(op.details as any).sendAsset?.code || 'XLM'}</p>
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            <p><span className="text-muted-foreground">Receive (min):</span> {(op.details as any).destMin} {(op.details as any).destAsset?.code || 'XLM'}</p>
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            {(op.details as any).path && (op.details as any).path.length > 0 && (
                              <div>
                                <p className="text-muted-foreground">Path:</p>
                                <div className="ml-2 text-xs">
                                  {/* @ts-ignore - Stellar SDK typing issue with operations */}
                                  {(op.details as any).path.map((asset: any, i: number) => (
                                    <span key={i} className="inline-block mr-2 mb-1 px-2 py-1 bg-background rounded">
                                      {asset.code || 'XLM'}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="mt-2 p-2 bg-background/50 rounded text-xs text-muted-foreground">
                              <p>Cross-asset payment: Converts {(op.details as any).sendAsset?.code || 'XLM'} to {(op.details as any).destAsset?.code || 'XLM'}</p>
                            </div>
                          </div>
                        )}
                        {op.type === 'accountMerge' && (
                          <div className="text-sm space-y-1">
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            <p className="break-words"><span className="text-muted-foreground">From:</span> <span className="font-address text-xs break-all">{(op.details as any).source || details.source}</span></p>
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            <p className="break-words"><span className="text-muted-foreground">To:</span> <span className="font-address text-xs break-all">{(op.details as any).destination}</span></p>
                            <div className="mt-2 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                                <div>
                                  <p className="text-destructive font-semibold text-sm">Account Closure: This transaction will close your source account and send all remaining funds to the destination. This action cannot be undone.</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {op.type === 'setOptions' && (
                          <div className="text-sm space-y-1">
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            <p className="break-words"><span className="text-muted-foreground">Account:</span> <span className="font-address text-xs break-all">{(op.details as any).source || details.source}</span></p>
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            {(op.details as any).signer && (
                              <p className="break-words"><span className="text-muted-foreground">Signer:</span> <span className="font-address text-xs break-all">{(op.details as any).signer.key}</span> (Weight: {(op.details as any).signer.weight})</p>
                            )}
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            {((op.details as any).lowThreshold !== undefined || (op.details as any).medThreshold !== undefined || (op.details as any).highThreshold !== undefined) && (
                              <div>
                                <p className="text-muted-foreground">Thresholds:</p>
                                {/* @ts-ignore - Stellar SDK typing issue with operations */}
                                {(op.details as any).lowThreshold !== undefined && <p className="ml-2">Low: {(op.details as any).lowThreshold}</p>}
                                {/* @ts-ignore - Stellar SDK typing issue with operations */}
                                {(op.details as any).medThreshold !== undefined && <p className="ml-2">Medium: {(op.details as any).medThreshold}</p>}
                                {/* @ts-ignore - Stellar SDK typing issue with operations */}
                                {(op.details as any).highThreshold !== undefined && <p className="ml-2">High: {(op.details as any).highThreshold}</p>}
                              </div>
                            )}
                            {/* @ts-ignore - Stellar SDK typing issue with operations */}
                            {(op.details as any).masterWeight !== undefined && (
                              <p><span className="text-muted-foreground">Master Weight:</span> {(op.details as any).masterWeight}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Memo */}
            {details.memo && details.memo.type !== 'none' && (
              <div className="space-y-2">
                <h4 className="font-medium">Memo</h4>
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <Badge variant="outline" className="mb-2">
                    {details.memo.type}
                  </Badge>
                  <p className="text-sm">{details.memo.value?.toString()}</p>
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};