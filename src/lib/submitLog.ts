import { useSyncExternalStore } from 'react';

/**
 * Small shared log of what happens during a network submission. Written by
 * submitTransaction() and the submit handlers, read by the SubmissionTerminal
 * panel (and mirrored to the browser console in dev builds).
 */
export type SubmitLogLevel = 'info' | 'wait' | 'ok' | 'error';

/** The steps of a network submission, in order, as the sending sheet shows them. */
export type SubmitStep = 'fee' | 'sent' | 'ledger' | 'account';

/** A log line that also marks a submission step as done. */
export interface SubmitStepMark {
  step: SubmitStep;
  /** The Horizon the transaction was sent to. */
  host?: string;
  /** The ledger the transaction is in. */
  ledger?: number;
}

export interface SubmitLogEntry {
  id: number;
  /** ms since the first entry of the current session */
  t: number;
  level: SubmitLogLevel;
  message: string;
  data?: unknown;
  step?: SubmitStepMark;
}

let entries: SubmitLogEntry[] = [];
let sessionStart = 0;
let nextId = 1;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((fn) => fn());

const consoleFor: Record<SubmitLogLevel, (...args: unknown[]) => void> = {
  info: console.log,
  wait: console.log,
  ok: console.log,
  error: console.error,
};

export const submitLog = {
  /** Start a fresh session (called when a submit button is pressed). */
  clear() {
    entries = [];
    sessionStart = 0;
    notify();
  },
  push(level: SubmitLogLevel, message: string, data?: unknown, step?: SubmitStepMark) {
    const now = performance.now();
    if (entries.length === 0) sessionStart = now;
    const entry: SubmitLogEntry = { id: nextId++, t: Math.round(now - sessionStart), level, message, data, ...(step ? { step } : {}) };
    entries = [...entries, entry];
    if (import.meta.env.DEV) {
      consoleFor[level](`[submit +${entry.t}ms] ${message}`, ...(data === undefined ? [] : [data]));
    }
    notify();
  },
  info: (message: string, data?: unknown, step?: SubmitStepMark) => submitLog.push('info', message, data, step),
  wait: (message: string, data?: unknown, step?: SubmitStepMark) => submitLog.push('wait', message, data, step),
  ok: (message: string, data?: unknown, step?: SubmitStepMark) => submitLog.push('ok', message, data, step),
  error: (message: string, data?: unknown) => submitLog.push('error', message, data),
  get: () => entries,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export const useSubmitLog = (): SubmitLogEntry[] => useSyncExternalStore(submitLog.subscribe, submitLog.get, submitLog.get);

// Dev convenience: poke the log from the browser console (window.__submitLog.get()).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __submitLog: typeof submitLog }).__submitLog = submitLog;
}
