import { lazy, memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

// Simplified lazy loading without complex error handling to avoid TypeScript issues
const LazyTransactionBuilder = lazy(() => import('@/components/TransactionBuilder').then(module => ({
  default: module.TransactionBuilder
})));

// Loading skeleton that matches the TransactionBuilder layout
export const TransactionBuilderSkeleton = memo(() => (
  <div className="min-h-screen bg-background p-3 sm:p-6">
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      
      {/* Tabs skeleton */}
      <div className="space-y-4">
        <div className="flex space-x-4">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
        
        {/* Content skeleton */}
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
          <div className="flex space-x-4">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      </div>
    </div>
  </div>
));

TransactionBuilderSkeleton.displayName = 'TransactionBuilderSkeleton';

export default LazyTransactionBuilder;