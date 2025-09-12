import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Settings, Users, Shield, Edit, Trash2 } from 'lucide-react';
import { tryParseTransaction, getInnerTransaction } from '@/lib/xdr/parse';
import { Operation } from '@stellar/stellar-sdk';

interface MultisigConfigBundleProps {
  xdr: string;
  onEdit?: () => void;
}

type SetOptionsOp = Operation & { 
  signer?: { key?: string; weight?: number }; 
  lowThreshold?: number;
  medThreshold?: number;
  highThreshold?: number;
};

export const MultisigConfigBundle = ({ xdr, onEdit }: MultisigConfigBundleProps) => {
  const parsed = tryParseTransaction(xdr);
  if (!parsed) return null;

  const { tx } = parsed;
  const transaction = getInnerTransaction(tx);
  const operations = transaction.operations;

  // Filter setOptions operations
  const setOptionsOps = operations.filter(op => op.type === 'setOptions') as SetOptionsOp[];
  
  if (setOptionsOps.length === 0) return null;

  const getOperationSummary = (op: SetOptionsOp, index: number) => {
    const changes = [];
    
    if (op.signer) {
      if (op.signer.weight === 0) {
        changes.push(`Remove signer ${op.signer.key?.slice(0, 8)}...${op.signer.key?.slice(-8)}`);
      } else {
        changes.push(`Add/Update signer ${op.signer.key?.slice(0, 8)}...${op.signer.key?.slice(-8)} (weight: ${op.signer.weight})`);
      }
    }
    
    if (op.lowThreshold !== undefined) {
      changes.push(`Low threshold: ${op.lowThreshold}`);
    }
    if (op.medThreshold !== undefined) {
      changes.push(`Medium threshold: ${op.medThreshold}`);
    }
    if (op.highThreshold !== undefined) {
      changes.push(`High threshold: ${op.highThreshold}`);
    }
    
    return {
      title: `Configuration Change #${index + 1}`,
      changes,
      icon: <Settings className="w-4 h-4" />,
      severity: 'warning' as const
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">Configuration Changes</h4>
        <Badge variant="outline">{setOptionsOps.length} change(s)</Badge>
      </div>
      
      <div className="space-y-3">
        {setOptionsOps.map((op, index) => {
          const summary = getOperationSummary(op, index);
          return (
            <Card key={index} className={`p-4 md:p-6 rounded-2xl border border-border/60 bg-card/60 hover:bg-card transition-colors shadow-sm`}>
              <div className="space-y-4">
                {/* Header with operation number and actions */}
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-foreground">
                    <span className="sm:hidden">Config #{index + 1}</span>
                    <span className="hidden sm:inline">Configuration Change #{index + 1}</span>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => {
                        onEdit?.();
                      }}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => {
                        // TODO: Implement remove functionality
                        console.log('Remove multisig config change');
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                
                {/* Configuration changes summary */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded bg-warning/10 text-warning">
                      {summary.icon}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      setOptions
                    </Badge>
                  </div>
                  
                  <div className="space-y-1">
                    {summary.changes.map((change, changeIndex) => (
                      <p key={changeIndex} className="text-sm text-muted-foreground">
                        • {change}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
