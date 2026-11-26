import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { DestinationLookup } from '@/hooks/useDestinationAccount';
import { isMuxedAddress } from '@/lib/validation';

interface DestinationAccountInfoProps {
  destination: string;
  lookup: DestinationLookup;
  network: 'mainnet' | 'testnet';
}

/** What the payment form knows about the destination: new account, lookup error, memo required. */
export const DestinationAccountInfo = ({ destination, lookup, network }: DestinationAccountInfoProps) => {
  if (lookup.status === 'loading') {
    return (
      <div className="notice" aria-busy="true">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    );
  }

  if (lookup.status === 'error') {
    return (
      <div className="notice red" role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4" aria-hidden="true" />
        <p className="flex-1">{lookup.message}</p>
      </div>
    );
  }

  if (lookup.status === 'exists' && lookup.memoRequired) {
    return (
      <div className="notice amber">
        <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden="true" />
        <p>
          This account requires a memo (it is probably an exchange). Enter the memo they gave you in the
          transaction memo field, or the funds may not be credited.
        </p>
      </div>
    );
  }

  if (lookup.status !== 'missing') return null;

  return (
    <div className="notice">
      <Info className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold">New account</p>
          <Badge variant="secondary">{network}</Badge>
        </div>
        <p className="mt-1 truncate font-address text-[13px] text-muted-foreground">{destination}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {isMuxedAddress(destination)
            ? 'The account behind this muxed address does not exist yet. Create it by sending to its G… address first.'
            : 'This account does not exist yet. It will be created with your payment, which must be at least 1 XLM.'}
        </p>
      </div>
    </div>
  );
};
