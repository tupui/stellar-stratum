import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useSubmitLog, type SubmitLogEntry, type SubmitLogLevel } from '@/lib/submitLog';

interface SubmissionTerminalProps {
  /** True while a submission is in flight: shows the live cursor and progress line. */
  active: boolean;
  network: 'mainnet' | 'testnet';
  onClose?: () => void;
}

const levelClass: Record<SubmitLogLevel, string> = {
  info: 'text-green-400',
  wait: 'text-green-300/80',
  ok: 'text-green-200 font-semibold',
  error: 'text-red-400 font-semibold',
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
  <div className="whitespace-pre-wrap break-words">
    <span className="text-green-700">[{pad(entry.t)}]</span>{' '}
    <span className={levelClass[entry.level]}>
      {levelPrefix[entry.level]} {entry.message}
    </span>
    {entry.data !== undefined && (
      <div className="pl-14 text-green-500/70 text-[11px] leading-snug">{formatData(entry.data)}</div>
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
    <div
      className="relative w-full rounded-lg border border-green-900/80 bg-black font-mono text-xs text-green-400 shadow-[0_0_24px_rgba(34,197,94,0.15)] overflow-hidden"
      role="log"
      aria-live="polite"
    >
      {/* Scanlines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,255,70,0.35) 2px 3px)' }}
      />

      {/* Title bar */}
      <div className="flex items-center justify-between gap-2 border-b border-green-900/80 bg-green-950/40 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-red-500/80" />
            <span className="h-2 w-2 rounded-full bg-yellow-400/80" />
            <span className="h-2 w-2 rounded-full bg-green-500/80" />
          </span>
          <span className="truncate text-green-300/90">
            stellar-stratum — submit --network {network}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {active && (
            <span className="text-green-300 animate-pulse">TRANSMITTING</span>
          )}
          {succeeded && <span className="text-green-200">DONE</span>}
          {failed && <span className="text-red-400">FAILED</span>}
          {!active && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-green-600 hover:text-green-300 transition-colors"
              aria-label="Close submission log"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="max-h-72 overflow-y-auto px-3 py-2 space-y-0.5 [text-shadow:0_0_6px_rgba(34,197,94,0.45)]">
        {entries.map((entry) => (
          <Line key={entry.id} entry={entry} />
        ))}
        <div className="flex items-center gap-1 pt-1">
          <span className="text-green-700">$</span>
          {active ? (
            <>
              <span className="text-green-300/80">awaiting horizon response</span>
              <span className="inline-block h-3.5 w-2 bg-green-400 animate-pulse" aria-hidden />
            </>
          ) : (
            <span className="inline-block h-3.5 w-2 bg-green-700/60" aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
};
