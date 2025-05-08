import { Skeleton } from '@/renderer/components/ui/skeleton';

export const TaskCardSkeleton = () => {
  return (
    <div className="flex flex-row items-center gap-4 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex-shrink-0">
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
      <div className="flex flex-col min-w-0 gap-1">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>
      <div className="flex-1" />
      <div className="flex-shrink-0 px-4">
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="flex-1" />
      <div className="flex flex-col items-end gap-1 min-w-[90px]">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
};
