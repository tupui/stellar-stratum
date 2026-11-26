import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
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

/**
 * A hash or ID to compare on both devices: the label, then the value in mono with its copy button
 * inside the box. One HashField everywhere a hash shows.
 */
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="field-label">{label}</span>
        {action}
      </div>
      <div className="flex items-start gap-3 border border-line-2 bg-ink-3 py-2 pl-3 pr-2">
        <p className="min-w-0 flex-1 break-all pt-[3px] font-address text-[13px] leading-[1.55] text-foreground [text-wrap:balance]">{value}</p>
        <button
          type="button"
          aria-label={`Copy ${name}`}
          onClick={copy}
          className="inline-grid size-11 shrink-0 place-items-center border border-line-2 text-foreground hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
};
