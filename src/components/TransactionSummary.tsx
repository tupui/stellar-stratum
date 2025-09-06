import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowRight, DollarSign, Users, Settings, Merge, CreditCard, Fingerprint } from 'lucide-react';
import { Transaction } from '@stellar/stellar-sdk';
import { getNetworkPassphrase } from '@/lib/stellar';
import { useNetwork } from '@/contexts/NetworkContext';

interface TransactionSummaryProps {
  xdr: string;
}

export const TransactionSummary = ({ xdr }: TransactionSummaryProps) => {
  const { network } = useNetwork();

  const getTransactionSummary = () => {
    try {
      const networkPassphrase = getNetworkPassphrase(network);
      const transaction = new Transaction(xdr, networkPassphrase);
      
      const operations = transaction.operations.map((op, index) => ({
        index,
        type: op.type,
        details: op as any,
      }));

      return {
        source: transaction.source,
        fee: transaction.fee,
        operations,
        memo: transaction.memo,
        operationCount: operations.length,
        hash: transaction.hash().toString('hex').substring(0, 8) + '...',
      };
    } catch (error) {
      return null;
    }
  };

  const summary = getTransactionSummary();
  
  if (!summary) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            <span>Invalid transaction XDR</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getOperationIcon = (type: string) => {
    switch (type) {
      case 'payment': return <DollarSign className="w-4 h-4" />;
      case 'pathPaymentStrictSend': return <ArrowRight className="w-4 h-4" />;
      case 'accountMerge': return <Merge className="w-4 h-4" />;
      case 'changeTrust': return <CreditCard className="w-4 h-4" />;
      case 'setOptions': return <Settings className="w-4 h-4" />;
      default: return <Users className="w-4 h-4" />;
    }
  };

  const getOperationSummary = (op: any) => {
    switch (op.type) {
      case 'payment':
        return {
          action: `Send ${op.details.amount} ${op.details.asset?.code || 'XLM'}`,
          target: `to ${op.details.destination.substring(0, 8)}...`,
          severity: 'default' as const
        };
      case 'pathPaymentStrictSend':
        return {
          action: `Convert ${op.details.sendAmount} ${op.details.sendAsset?.code || 'XLM'}`,
          target: `to ${op.details.destAsset?.code || 'XLM'} for ${op.details.destination.substring(0, 8)}...`,
          severity: 'default' as const
        };
      case 'accountMerge':
        return {
          action: 'Merge account',
          target: `into ${op.details.destination.substring(0, 8)}...`,
          severity: 'destructive' as const
        };
      case 'changeTrust':
        const asset = op.details.asset;
        const assetCode = asset?.code || asset?.credit_alphanum4?.asset_code || asset?.credit_alphanum12?.asset_code || 'Unknown';
        const limit = op.details.limit;
        return {
          action: limit === '0' ? `Remove trustline` : `Add/Update trustline`,
          target: `for ${assetCode}`,
          severity: limit === '0' ? 'destructive' as const : 'default' as const
        };
      case 'setOptions':
        return {
          action: 'Update account settings',
          target: op.details.signer ? `Add/Update signer` : 'Change thresholds',
          severity: 'default' as const
        };
      default:
        return {
          action: op.type.charAt(0).toUpperCase() + op.type.slice(1).replace(/([A-Z])/g, ' $1'),
          target: '',
          severity: 'default' as const
        };
    }
  };

  return (
    <Card className="shadow-card border-primary/20">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Fingerprint className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Transaction Summary</CardTitle>
            <CardDescription>
              Review what you're about to sign
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Key Info */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-secondary/30 rounded-lg">
          <div>
            <p className="text-sm text-muted-foreground">From Account</p>
            <p className="font-mono text-sm font-medium">{summary.source.substring(0, 12)}...</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Network Fee</p>
            <p className="text-sm font-medium">{parseInt(summary.fee) / 10000000} XLM</p>
          </div>
        </div>

        {/* Operations Summary */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">Operations to Execute</h4>
            <Badge variant="outline">{summary.operationCount} operation(s)</Badge>
          </div>
          
          <div className="space-y-3">
            {summary.operations.map((op, index) => {
              const opSummary = getOperationSummary(op);
              return (
                <div 
                  key={index} 
                  className={`p-3 rounded-lg border-l-4 ${
                    opSummary.severity === 'destructive' 
                      ? 'bg-destructive/5 border-l-destructive' 
                      : 'bg-secondary/30 border-l-primary/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded ${
                      opSummary.severity === 'destructive'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-primary/10 text-primary'
                    }`}>
                      {getOperationIcon(op.type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={opSummary.severity === 'destructive' ? 'destructive' : 'outline'}>
                          {op.type}
                        </Badge>
                        {opSummary.severity === 'destructive' && (
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                        )}
                      </div>
                      <p className="font-medium text-sm">{opSummary.action}</p>
                      {opSummary.target && (
                        <p className="text-sm text-muted-foreground">{opSummary.target}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Memo */}
        {summary.memo && summary.memo.type !== 'none' && (
          <div className="p-3 bg-secondary/30 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">{summary.memo.type}</Badge>
              <span className="text-sm font-medium">Memo</span>
            </div>
            <p className="text-sm text-muted-foreground break-all">
              {summary.memo.value?.toString()}
            </p>
          </div>
        )}

        {/* Warning for destructive operations */}
        {summary.operations.some(op => ['accountMerge', 'changeTrust'].includes(op.type) && 
          (op.type === 'accountMerge' || (op.details as any).limit === '0')) && (
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-destructive mb-1">Warning: Irreversible Actions</p>
                <p className="text-sm text-destructive/80">
                  This transaction contains operations that cannot be undone. Review carefully before signing.
                </p>
              </div>
            </div>
          </div>
        )}
        
        <div className="pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            Transaction Hash: {summary.hash} • {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};