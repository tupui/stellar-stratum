import { lazy, memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

// Simplified lazy loading without complex error handling to avoid TypeScript issues
const LazyAccountOverview = lazy(() => import('@/components/AccountOverview').then(module => ({
  default: module.AccountOverview
})));

// Loading skeleton that matches the AccountOverview layout
export const AccountOverviewSkeleton = memo(() => (
  <div className="min-h-screen bg-background p-3 sm:p-6">
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
      
      {/* Account info skeleton */}
      <div className="p-6 border rounded-lg space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="p-3 bg-secondary/50 rounded-lg">
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-5 w-full" />
        </div>
      </div>
      
      {/* Tabs skeleton */}
      <div className="space-y-6">
        <div className="flex justify-center">
          <div className="flex space-x-1 p-1 bg-secondary rounded-lg">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
        </div>
        
        {/* Content skeleton */}
        <div className="grid gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  </div>
));

AccountOverviewSkeleton.displayName = 'AccountOverviewSkeleton';

export default LazyAccountOverview;