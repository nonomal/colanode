import { Skeleton } from '@/renderer/components/ui/skeleton';

export const TaskSkeleton = () => {
  return (
    <div className="grid grid-cols-5 gap-4">
      <div className="col-span-3 flex flex-col gap-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-row items-center gap-4">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex flex-col gap-1">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <div className="mt-4 pt-4 pb-4 border-t border-b border-border/40">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
              {Array.from({ length: 5 }).map((_, index) => (
                <div className="flex flex-col gap-1" key={index}>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-5 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
      <div className="col-span-2">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
};
