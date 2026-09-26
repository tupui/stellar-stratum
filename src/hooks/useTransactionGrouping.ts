import { useMemo } from 'react';
import { format } from 'date-fns';
import { NormalizedTransaction } from '@/lib/horizon-utils';

export interface GroupedTransaction extends NormalizedTransaction {
  // Grouping specific fields. A group's amount is the sum of its members'.
  isGrouped: boolean;
  count: number;
  groupedTransactions?: NormalizedTransaction[];
}

// Entries fold together only when they are the same movement (type, direction,
// counterparty and assets) on the same day. Contract calls and config changes
// always keep their own row: each one matters on its own, e.g. a signer change.
const groupKey = (tx: NormalizedTransaction): string | null => {
  if (tx.category === 'contract' || tx.category === 'config') return null;
  return [
    format(tx.createdAt, 'yyyy-MM-dd'),
    tx.type,
    tx.category,
    tx.direction,
    tx.counterparty,
    tx.assetCode,
    tx.assetIssuer,
    tx.swapFromAssetCode,
    tx.swapFromAssetIssuer,
    tx.swapToAssetCode,
    tx.swapToAssetIssuer,
  ].join('|');
};

/**
 * Folds runs of adjacent matching transactions (newest first) into one row, in
 * a single pass.
 */
const groupTransactions = (transactions: NormalizedTransaction[]): GroupedTransaction[] => {
  const sorted = [...transactions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const runs: NormalizedTransaction[][] = [];
  let lastKey: string | null = null;
  for (const tx of sorted) {
    const key = groupKey(tx);
    if (key !== null && key === lastKey) runs[runs.length - 1].push(tx);
    else runs.push([tx]);
    lastKey = key;
  }

  return runs.map((run) => run.length === 1
    ? { ...run[0], isGrouped: false, count: 1 }
    : {
        ...run[0],
        // Summed in stroops so float error doesn't show up as a stray 7th decimal
        amount: run.reduce((sum, t) => sum + Math.round((t.amount || 0) * 1e7), 0) / 1e7,
        isGrouped: true,
        count: run.length,
        groupedTransactions: run,
      });
};

/**
 * Hook to group similar transactions together
 */
export const useTransactionGrouping = (transactions: NormalizedTransaction[]) => {
  const groupedTransactions = useMemo(() => {
    return groupTransactions(transactions);
  }, [transactions]);

  return groupedTransactions;
};
