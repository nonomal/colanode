import { TaskStatus } from '@colanode/core';
import { CheckCircle, CircleX, Clock, RefreshCw } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

interface TaskStatusBadgeProps {
  status: TaskStatus;
  className?: string;
}

export const TaskStatusBadge = ({
  status,
  className,
}: TaskStatusBadgeProps) => {
  if (status === TaskStatus.Completed) {
    return <CheckCircle className={cn('size-5 text-green-500', className)} />;
  }

  if (status === TaskStatus.Failed) {
    return <CircleX className={cn('size-5 text-red-500', className)} />;
  }

  if (status === TaskStatus.Running) {
    return (
      <RefreshCw
        className={cn('size-5 animate-spin text-blue-500', className)}
      />
    );
  }

  if (status === TaskStatus.Pending) {
    return <Clock className={cn('size-5 text-gray-500', className)} />;
  }

  return null;
};
