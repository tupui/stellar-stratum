import { useMemo } from 'react';
import { NormalizedTransaction } from '@/lib/horizon-utils';

export interface GroupedTransaction {
  id: string;
  createdAt: Date;
  type: string;
  category: string;
  direction?: 'in' | 'out';
  amount?: number;
  assetType?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  assetCode?: string;
  assetIssuer?: string;
  swapFromAmount?: number;
  swapFromAssetType?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  swapFromAssetCode?: string;
  swapFromAssetIssuer?: string;
  swapToAmount?: number;
  swapToAssetType?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  swapToAssetCode?: string;
  swapToAssetIssuer?: string;
  counterparty?: string;
  transactionHash: string;
  // Grouping specific fields
  isGrouped: boolean;
  count: number;
  totalAmount?: number;
  groupedTransactions?: NormalizedTransaction[];
  latestTransaction?: NormalizedTransaction;
  oldestTransaction?: NormalizedTransaction;
}

/**
 * Groups transactions that are identical except for timestamp
 * Groups transactions that occur within the same time window and have identical properties
 */
const groupTransactions = (transactions: NormalizedTransaction[]): GroupedTransaction[] => {
  const groups: GroupedTransaction[] = [];
  const processedIds = new Set<string>();

  // Sort transactions by date descending (newest first)
  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  for (const tx of sortedTransactions) {
    if (processedIds.has(tx.id)) continue;

    // Find transactions that should be grouped with this one
    const similarTransactions = sortedTransactions.filter(otherTx => {
      if (processedIds.has(otherTx.id) || otherTx.id === tx.id) return false;
      
      // Group by identical properties
      return (
        tx.type === otherTx.type &&
        tx.category === otherTx.category &&
        tx.direction === otherTx.direction &&
        tx.counterparty === otherTx.counterparty &&
        tx.assetCode === otherTx.assetCode &&
        tx.assetIssuer === otherTx.assetIssuer &&
        // For swaps, also match swap details
        (tx.category !== 'swap' || (
          tx.swapFromAssetCode === otherTx.swapFromAssetCode &&
          tx.swapFromAssetIssuer === otherTx.swapFromAssetIssuer &&
          tx.swapToAssetCode === otherTx.swapToAssetCode &&
          tx.swapToAssetIssuer === otherTx.swapToAssetIssuer
        )) &&
        // Group transactions that occur within the same hour (for batch operations)
        Math.abs(new Date(tx.createdAt).getTime() - new Date(otherTx.createdAt).getTime()) < 60 * 60 * 1000
      );
    });

    // Mark all similar transactions as processed
    const allGroupTransactions = [tx, ...similarTransactions];
    allGroupTransactions.forEach(t => processedIds.add(t.id));

    // Create grouped transaction
    const isGrouped = similarTransactions.length > 0;
    const totalAmount = allGroupTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const latestTransaction = allGroupTransactions[0]; // Already sorted by date desc
    const oldestTransaction = allGroupTransactions[allGroupTransactions.length - 1];

    const groupedTx: GroupedTransaction = {
      id: tx.id,
      createdAt: latestTransaction.createdAt,
      type: tx.type,
      category: tx.category,
      direction: tx.direction,
      amount: isGrouped ? totalAmount : tx.amount,
      assetType: tx.assetType,
      assetCode: tx.assetCode,
      assetIssuer: tx.assetIssuer,
      swapFromAmount: tx.swapFromAmount,
      swapFromAssetType: tx.swapFromAssetType,
      swapFromAssetCode: tx.swapFromAssetCode,
      swapFromAssetIssuer: tx.swapFromAssetIssuer,
      swapToAmount: tx.swapToAmount,
      swapToAssetType: tx.swapToAssetType,
      swapToAssetCode: tx.swapToAssetCode,
      swapToAssetIssuer: tx.swapToAssetIssuer,
      counterparty: tx.counterparty,
      transactionHash: latestTransaction.transactionHash,
      isGrouped,
      count: allGroupTransactions.length,
      totalAmount: isGrouped ? totalAmount : undefined,
      groupedTransactions: isGrouped ? allGroupTransactions : undefined,
      latestTransaction,
      oldestTransaction,
    };

    groups.push(groupedTx);
  }

  return groups;
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