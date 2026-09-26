import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { DestinationLookup } from '@/hooks/useDestinationAccount';

interface DestinationAccountInfoProps {
  destination: string;
  lookup: DestinationLookup;
  network: 'mainnet' | 'testnet';
}

/** What the payment form knows about the destination: new account, lookup error, memo required. */
export const DestinationAccountInfo = ({ destination, lookup, network }: DestinationAccountInfoProps) => {
  if (lookup.status === 'loading') {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (lookup.status === 'error') {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-destructive" />
            </div>
            <p className="flex-1 text-sm font-medium text-destructive">{lookup.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (lookup.status === 'exists' && lookup.memoRequired) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">
              This account requires a memo (it is probably an exchange). Enter the memo they gave you in the
              transaction memo field, or the funds may not be credited.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (lookup.status !== 'missing') return null;

  return (
    <Card className="border transition-all duration-200">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-muted">
            <Info className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm font-medium">New Account</p>
              <Badge variant="secondary" className="text-xs">
                {network}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground truncate">{destination}</p>
              <p className="text-xs text-muted-foreground">
                This account does not exist yet. It will be created with your payment, which must be at least 1 XLM.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
