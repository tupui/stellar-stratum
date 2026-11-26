import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/brand/Mark';
import { useSubmitLog, type SubmitLogEntry, type SubmitLogLevel } from '@/lib/submitLog';

interface SubmissionTerminalProps {
  /** True while a submission is in flight: shows the live cursor and progress line. */
  active: boolean;
  network: 'mainnet' | 'testnet';
  onClose?: () => void;
}

const levelClass: Record<SubmitLogLevel, string> = {
  info: 'text-foreground',
  wait: 'text-foreground',
  ok: 'text-foreground',
  error: 'text-destructive',
};

const levelPrefix: Record<SubmitLogLevel, string> = {
  info: '>',
  wait: '…',
  ok: '✓',
  error: '✗',
};

/** Compact, single-line-ish rendering of structured data with long strings shortened. */
const formatData = (data: unknown): string => {
  if (data instanceof Error) return `${data.name}: ${data.message}`;
  try {
    return JSON.stringify(
      data,
      (_key, value) => {
        if (typeof value === 'string' && value.length > 120) return `${value.slice(0, 56)}…${value.slice(-56)}`;
        if (typeof value === 'bigint') return value.toString();
        return value;
      },
      2,
    );
  } catch {
    return String(data);
  }
};

const pad = (ms: number) => `+${String(ms).padStart(6, ' ')}ms`;

const Line = ({ entry }: { entry: SubmitLogEntry }) => (
  <div className="mb-2 last:mb-0">
    <span className="whitespace-pre text-muted-foreground">[{pad(entry.t)}]</span>{' '}
    <span className={levelClass[entry.level]}>
      {levelPrefix[entry.level]} {entry.message}
    </span>
    {entry.data !== undefined && (
      <pre className="mt-1 whitespace-pre-wrap break-all font-[inherit] text-muted-foreground">{formatData(entry.data)}</pre>
    )}
  </div>
);

export const SubmissionTerminal = ({ active, network, onClose }: SubmissionTerminalProps) => {
  const entries = useSubmitLog();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, active]);

  if (entries.length === 0 && !active) return null;

  const last = entries[entries.length - 1];
  const failed = last?.level === 'error';
  const succeeded = !active && last?.level === 'ok';

  return (
    <section className="w-full border border-line bg-ink" role="log" aria-live="polite" aria-label="Submission log">
      <div className="flex items-center gap-2 border-b border-line py-2 pl-3 pr-2">
        <span className="flex gap-1" aria-hidden>
          <i className="block h-2 w-2 border border-line-2" />
          <i className="block h-2 w-2 border border-line-2" />
          <i className="block h-2 w-2 border border-line-2" />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          stellar-stratum — submit --network {network}
        </span>
        {active && (
          <Badge className="gap-2">
            <Spinner size={12} />
            TRANSMITTING
          </Badge>
        )}
        {succeeded && <Badge>DONE</Badge>}
        {failed && <Badge variant="destructive">FAILED</Badge>}
        {!active && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-grid size-11 shrink-0 place-items-center border border-line-2 text-foreground hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Close submission log"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div ref={bodyRef} className="max-h-72 overflow-y-auto break-words p-3 font-mono text-xs leading-normal">
        {entries.map((entry) => (
          <Line key={entry.id} entry={entry} />
        ))}
        <div className="flex items-center gap-1 pt-1">
          <span className="text-muted-foreground">$</span>
          {active && <span className="text-muted-foreground">awaiting horizon response</span>}
          <span className="inline-block h-3 w-2 bg-foreground" aria-hidden />
        </div>
      </div>
    </section>
  );
};
