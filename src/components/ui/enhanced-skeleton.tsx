import { memo } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

// Enhanced skeleton components for better loading states
export const CardSkeleton = memo(({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-6 border rounded-lg space-y-4", className)} {...props}>
    <div className="flex items-center gap-2">
      <Skeleton className="h-5 w-5" />
      <Skeleton className="h-6 w-48" />
    </div>
    <Skeleton className="h-20 w-full" />
    <div className="flex gap-2">
      <Skeleton className="h-8 flex-1" />
      <Skeleton className="h-8 w-24" />
    </div>
  </div>
));

export const TabsSkeleton = memo(({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("space-y-6", className)} {...props}>
    <div className="flex justify-center">
      <div className="flex space-x-1 p-1 bg-secondary rounded-lg">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
    <div className="grid gap-4">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  </div>
));

export const FormSkeleton = memo(({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("space-y-4", className)} {...props}>
    <div className="grid gap-2">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-10 w-full" />
    </div>
    <div className="grid gap-2">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-10 w-full" />
    </div>
    <div className="flex gap-2">
      <Skeleton className="h-10 flex-1" />
      <Skeleton className="h-10 w-24" />
    </div>
  </div>
));

CardSkeleton.displayName = 'CardSkeleton';
TabsSkeleton.displayName = 'TabsSkeleton';
FormSkeleton.displayName = 'FormSkeleton';