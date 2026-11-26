import { lazy, Suspense, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/brand/Mark';
import { HashField } from '@/components/HashField';
import { SubmissionTerminal } from './SubmissionTerminal';
import { useSubmitLog, type SubmitLogEntry } from '@/lib/submitLog';
import { getHorizonUrls } from '@/lib/horizonSettings';
import { readResultCodes, SubmitError } from '@/lib/stellar';
import { describeOperation } from '@/lib/xdr/describe';
import { getInnerTransaction, getTransactionHashFromXdr, tryParseTransaction } from '@/lib/xdr/parse';
import { cn, openExternal } from '@/lib/utils';

// The scene carries the whole logo and mountain: loaded with the sheet, not with the app.
const Summit = lazy(() => import('@/components/brand/Summit').then((m) => ({ default: m.Summit })));

/** What the sheet shows: the climb, then how it ended. */
export type SendState =
  | { phase: 'sending'; xdr: string }
  | { phase: 'success'; xdr: string; hash: string; ledger?: number; feeCharged: bigint | null }
  | { phase: 'failed' | 'pending'; xdr: string; error: SubmitError };

interface SendSheetProps {
  state: SendState;
  network: 'mainnet' | 'testnet';
  /** Back to Wallet. */
  onDone: () => void;
  /** Back to Review: close the sheet, the review stays. */
  onBack: () => void;
  /** Try Again: send the same transaction once more. */
  onRetry: () => void;
}

type StepStatus = 'done' | 'current' | 'todo' | 'failed';
interface Step {
  label: string;
  status: StepStatus;
  /** ms since the send button was pressed */
  t?: number;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The submission's five steps, read from the submit log: no progress is made up. */
const readSteps = (entries: SubmitLogEntry[], network: 'mainnet' | 'testnet', state: SendState): Step[] => {
  const last = (step: string) => [...entries].reverse().find((e) => e.step?.step === step);
  const fee = last('fee');
  const sent = last('sent');
  const landed = last('ledger');
  const account = last('account');
  const host = sent?.step?.host ?? hostOf(getHorizonUrls(network)[0] ?? '');
  const ledger = landed?.step?.ledger ?? (state.phase === 'success' ? state.ledger : undefined);
  const end = entries[entries.length - 1]?.t;

  const steps: Step[] = [
    { label: 'Fee checked against the network', status: fee ? 'done' : 'todo', t: fee?.t },
    { label: `Sent to ${host}`, status: sent ? 'done' : 'todo', t: sent?.t },
    { label: 'Waiting for a ledger', status: landed ? 'done' : 'todo', t: landed?.t },
    { label: ledger ? `In ledger ${ledger.toLocaleString('en-US')}` : 'In a ledger', status: landed ? 'done' : 'todo', t: landed?.t },
    { label: 'Account updated', status: account ? 'done' : 'todo', t: account?.t },
  ];
  const next = steps.findIndex((s) => s.status !== 'done');
  if (next < 0) return steps;

  if (state.phase === 'sending') {
    steps[next] = { ...steps[next], status: 'current' };
    return steps;
  }
  if (state.phase !== 'failed') return steps;

  // Where the climb stopped: the steps after it are not shown.
  const { error } = state;
  let at = next;
  let label = steps[next].label;
  if (error.kind === 'rejected') label = `Rejected by ${error.host ?? host}`;
  if (error.kind === 'memo') {
    at = 1;
    label = 'Not sent: the destination requires a memo';
  }
  if (error.kind === 'failed') {
    at = 3;
    steps[2] = { ...steps[2], status: 'done', t: end };
    label = error.ledger ? `Failed in ledger ${error.ledger.toLocaleString('en-US')}` : 'Failed in a ledger';
  }
  return [...steps.slice(0, at), { label, status: 'failed', t: end }];
};

const seconds = (ms?: number) => (ms === undefined ? '' : `${(ms / 1000).toFixed(1)} s`);

const StepList = ({ steps }: { steps: Step[] }) => (
  <ol aria-label="Submission" className="border-t border-line">
    {steps.map((step, i) => (
      <li
        key={i}
        className={cn(
          'flex min-h-11 items-center gap-3 border-b border-line py-2',
          step.status === 'todo' && 'text-muted-foreground',
        )}
      >
        <span className="inline-grid size-[18px] shrink-0 place-items-center" aria-hidden>
          {step.status === 'done' && <Check className="h-[18px] w-[18px]" />}
          {step.status === 'current' && <Spinner size={18} />}
          {step.status === 'todo' && <span className="block size-3.5 border border-dashed border-muted-foreground" />}
          {step.status === 'failed' && <X className="h-[18px] w-[18px] text-destructive" />}
        </span>
        <span className="min-w-0 flex-1 break-words">
          {step.label}
          <span className="sr-only">
            {{ done: ', done', current: ', in progress', todo: ', to come', failed: ', failed' }[step.status]}
          </span>
        </span>
        {(step.status === 'done' || step.status === 'failed') && (
          <span className="shrink-0 font-mono text-[13px] text-muted-foreground">{seconds(step.t)}</span>
        )}
        {step.status === 'current' && <span className="shrink-0 font-mono text-[13px] text-muted-foreground">…</span>}
      </li>
    ))}
  </ol>
);

/** The submission log, folded. */
const Details = ({ active, network }: { active: boolean; network: 'mainnet' | 'testnet' }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 border-t border-line text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring"
      >
        Details
        {open ? <ChevronUp className="ml-auto h-[18px] w-[18px]" /> : <ChevronDown className="ml-auto h-[18px] w-[18px]" />}
      </button>
      {open && <SubmissionTerminal active={active} network={network} />}
    </div>
  );
};

/** A notice with a bold first line and the plain reason under it. */
const Notice = ({ level, title, children }: { level: 'red' | 'amber'; title: string; children: ReactNode }) => (
  <div role={level === 'red' ? 'alert' : 'status'} className={cn('notice', level)}>
    <AlertTriangle className="mt-0.5 h-[18px] w-[18px]" aria-hidden />
    <div className="min-w-0">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  </div>
);

const sentence = (text: string) => {
  const t = text.trim();
  return t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}` : '';
};

/** Why it failed, and whether a fee was charged. */
const failure = (error: SubmitError): { title: string; reason: string } => {
  const NO_FEE = 'Nothing was sent and no fee was charged.';
  switch (error.kind) {
    case 'rejected': {
      const { codes, hints } = readResultCodes(error.codes ?? {});
      const why = hints.length ? hints.map(sentence).join(' ') : codes.length ? `Result codes: ${codes.join(', ')}.` : '';
      return { title: 'The network rejected the transaction', reason: `${why} ${NO_FEE}`.trim() };
    }
    case 'failed':
      return {
        title: error.ledger ? `It failed in ledger ${error.ledger.toLocaleString('en-US')}` : 'It failed in a ledger',
        reason: 'The transaction was included but failed, so nothing was transferred, and the fee was charged.',
      };
    case 'memo':
      return { title: 'The destination requires a memo', reason: `${error.message} ${NO_FEE}` };
    default:
      return { title: 'The transaction was not submitted', reason: error.message };
  }
};

/** The operations in plain words, as the review shows them. */
const Summary = ({ xdr, network }: { xdr: string; network: 'mainnet' | 'testnet' }) => {
  const parsed = tryParseTransaction(xdr, network);
  if (!parsed) return null;
  const operations = getInnerTransaction(parsed.tx).operations;
  const lines = operations.map((op) => describeOperation(op, network).summary);
  const big = lines.length === 1;
  return (
    <div className={cn('flex flex-col gap-1', big ? 'text-[22px] font-semibold leading-tight' : 'text-[15px]')}>
      {lines.map((line, i) => (
        <p key={i} className="break-words">
          {line.split(/([GCM][A-Z2-7]{7}…[A-Z2-7]{8})/).map((part, j) =>
            j % 2 ? (
              <span key={j} className="whitespace-nowrap font-address text-[.82em] font-normal">
                {part}
              </span>
            ) : (
              part
            ),
          )}
        </p>
      ))}
    </div>
  );
};

const KV = 'm-0 border-t border-line px-4 py-2.5 sm:px-6';
const Rows = ({ rows }: { rows: [string, string, boolean?][] }) => (
  <dl className="-mx-4 grid grid-cols-[minmax(0,1fr)_auto] sm:-mx-6">
    {rows.map(([label, value, mono]) => (
      <div key={label} className="contents">
        <dt className={cn(KV, 'text-muted-foreground')}>{label}</dt>
        <dd className={cn(KV, 'text-right', mono && 'font-address')}>{value}</dd>
      </div>
    ))}
  </dl>
);

const xlm = (stroops: bigint) => {
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''} XLM`;
};

/**
 * Sending a transaction to the network, and what follows: the summit, a failure, or a transaction
 * not in a ledger yet. The trail on the mountain lights as the submission's steps complete.
 */
export const SendSheet = ({ state, network, onDone, onBack, onRetry }: SendSheetProps) => {
  const entries = useSubmitLog();
  const networkName = network === 'mainnet' ? 'Mainnet' : 'Testnet';
  const sending = state.phase === 'sending';
  const steps = readSteps(entries, network, state);
  const done = state.phase === 'success' ? 5 : steps.filter((s) => s.status === 'done').length;
  const hash = state.phase === 'success' ? state.hash : getTransactionHashFromXdr(state.xdr, network);
  const close = state.phase === 'success' ? onDone : onBack;
  const explorer = `https://stellar.expert/explorer/${network === 'testnet' ? 'testnet' : 'public'}/tx/${hash}`;

  const title = {
    sending: 'Sending Transaction',
    success: 'Transaction Submitted Successfully',
    failed: 'Transaction Failed',
    pending: 'Not in a Ledger Yet',
  }[state.phase];
  const line = {
    sending: `To ${networkName}. This usually takes about 5 seconds.`,
    success: 'Your transaction has been successfully submitted to the Stellar network',
    failed: null,
    pending: null,
  }[state.phase];

  const keep = (event: Event) => sending && event.preventDefault();

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && close()}>
      <DialogContent
        className={cn('gap-4 sm:max-w-[520px]', sending && '[&>button.absolute]:hidden')}
        onEscapeKeyDown={keep}
        onPointerDownOutside={keep}
        onInteractOutside={keep}
        // The failure and pending sheets have no line under the title; their notice says it all.
        {...(line ? {} : { 'aria-describedby': undefined })}
      >
        <DialogHeader>
          <DialogTitle className="[text-wrap:balance]">{title}</DialogTitle>
          {line && <DialogDescription>{line}</DialogDescription>}
        </DialogHeader>

        <div className="flex justify-center leading-none">
          <Suspense fallback={<div className="aspect-[358/196] w-full max-w-[358px]" />}>
            <Summit
              lit={done / 5}
              summit={state.phase === 'success'}
              flower={state.phase === 'failed' || state.phase === 'pending' ? 0.3 : 1}
              className="block h-auto w-full max-w-[358px]"
            />
          </Suspense>
        </div>

        {state.phase === 'sending' && (
          <>
            <StepList steps={steps} />
            <Details active network={network} />
          </>
        )}

        {state.phase === 'success' && (
          <>
            <Summary xdr={state.xdr} network={network} />
            <Rows
              rows={[
                ['Network', networkName],
                ...(state.ledger ? ([['Ledger', state.ledger.toLocaleString('en-US'), true]] as [string, string, boolean][]) : []),
                ...(state.feeCharged !== null ? ([['Fee charged', xlm(state.feeCharged), true]] as [string, string, boolean][]) : []),
              ]}
            />
            <HashField label="Transaction hash" value={hash} />
            <Details active={false} network={network} />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button variant="outline" className="sm:flex-1" onClick={onDone}>
                Back to Wallet
              </Button>
              <Button className="sm:flex-1" onClick={() => openExternal(explorer)}>
                <ExternalLink />
                View on Stellar Expert
              </Button>
            </div>
          </>
        )}

        {state.phase === 'failed' && (
          <>
            {(() => {
              const { title: head, reason } = failure(state.error);
              return (
                <Notice level="red" title={head}>
                  {reason}
                </Notice>
              );
            })()}
            <StepList steps={steps} />
            <Details active={false} network={network} />
            <div className="flex gap-3">
              <Button variant="outline" className="min-w-0 flex-1" onClick={onDone}>
                Back to Wallet
              </Button>
              <Button className="min-w-0 flex-1" onClick={onBack}>
                Back to Review
              </Button>
            </div>
          </>
        )}

        {state.phase === 'pending' && (
          <>
            <Notice
              level="amber"
              title={`Sent, but not in a ledger after ${Math.round((state.error.waitedMs ?? 0) / 1000)} s`}
            >
              It may still land. If it never does, the fee is likely too low for current surge pricing.
            </Notice>
            <HashField label="Transaction hash" value={hash} />
            <Details active={false} network={network} />
            <div className="flex gap-3">
              <Button variant="outline" className="min-w-0 flex-1" onClick={onBack}>
                Back to Review
              </Button>
              <Button className="min-w-0 flex-1" onClick={onRetry}>
                Try Again
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

