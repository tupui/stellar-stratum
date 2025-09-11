import { Bell } from 'lucide-react';
import { usePendingMultisig } from '@/hooks/usePendingMultisig';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { formatDistanceToNow } from 'date-fns';
import { PendingMultisigTx, removePendingTx } from '@/lib/multisig-store';

export const HeaderPendingBadge = () => {
  const { pending, count } = usePendingMultisig();

  if (count === 0) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="relative">
          <Bell className="w-5 h-5" />
          <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
            {count}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] max-w-lg">
        <DialogHeader>
          <DialogTitle>Pending Multisig Transactions</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {pending.map(tx => (
            <PendingRow key={tx.id} tx={tx} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const PendingRow = ({ tx }: { tx: PendingMultisigTx }) => {
  const remaining = tx.requiredSignatures - tx.signatures.length;
  return (
    <div className="p-3 border rounded-lg flex items-center justify-between">
      <div>
        <p className="text-sm font-mono break-all">{tx.id.slice(0, 8)}…</p>
        <p className="text-xs text-muted-foreground">
          {tx.signatures.length}/{tx.requiredSignatures} signatures • {formatDistanceToNow(tx.createdAt, { addSuffix: true })}
        </p>
      </div>
      <div className="flex gap-2">
        {remaining > 0 && <Button size="sm" variant="secondary" onClick={() => {
          sessionStorage.setItem('deeplink-xdr', tx.xdr);
          // trigger event so TransactionBuilder picks it up
          window.dispatchEvent(new Event('deeplink:xdr-loaded'));
        }}>Sign</Button>}
        <Button size="sm" variant="ghost" onClick={() => removePendingTx(tx.id)}>Remove</Button>
      </div>
    </div>
  );
};
