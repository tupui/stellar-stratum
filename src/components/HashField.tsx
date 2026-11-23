import { useState, type ReactNode } from 'react';
import { CheckCircle, Copy, Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { copyText } from '@/lib/utils';

interface HashFieldProps {
  label: ReactNode;
  /** Names the value in the copy toast when `label` is not plain text. */
  copyLabel?: string;
  value: string;
  /** An extra button beside the label, such as a link to an explorer. */
  action?: ReactNode;
}

/** A hash or ID under a QR code, to compare on both devices, with a copy button. */
export const HashField = ({ label, copyLabel, value, action }: HashFieldProps) => {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const name = copyLabel ?? (typeof label === 'string' ? label : 'Value');

  const copy = async () => {
    try {
      await copyText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Copied to clipboard', description: `${name} has been copied`, duration: 2500 });
    } catch {
      toast({ title: 'Could not copy', description: 'Please copy manually.', duration: 3000 });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-2">
        <Fingerprint className="w-3 h-3" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {action}
      </div>
      <div className="rounded-xl border border-border/60 bg-background/40 backdrop-blur-sm p-2">
        <div className="flex items-center justify-between">
          <p className="font-address text-xs break-all text-foreground/80 flex-1">{value}</p>
          <Button variant="ghost" size="sm" aria-label={`Copy ${name}`} onClick={copy} className="h-6 w-6 p-0 ml-2 shrink-0">
            {copied ? <CheckCircle className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          </Button>
        </div>
      </div>
    </div>
  );
};
