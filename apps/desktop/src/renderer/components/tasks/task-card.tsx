import {
  formatDuration,
  TaskOutput,
  timeAgo,
  formatTaskType,
} from '@colanode/core';
import { Clock, Calendar } from 'lucide-react';

import { TaskStatusBadge } from '@/renderer/components/tasks/task-status-badge';
import { Badge } from '@/renderer/components/ui/badge';
import { useLayout } from '@/renderer/contexts/layout';

interface TaskCardProps {
  task: TaskOutput;
}

export const TaskCard = ({ task }: TaskCardProps) => {
  const layout = useLayout();
  const duration = formatDuration(task.createdAt, task.completedAt);
  const startedAgo = timeAgo(task.createdAt);

  return (
    <div className="flex flex-row items-center gap-4 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex-shrink-0">
        <TaskStatusBadge status={task.status} />
      </div>
      <div className="flex flex-col min-w-0">
        <button
          onClick={() => {
            layout.previewLeft(task.id);
          }}
          className="font-semibold text-base truncate text-left hover:underline transition-colors"
          type="button"
        >
          {task.name}
        </button>
        <span className="text-xs text-muted-foreground mt-0.5 truncate">
          {task.description}
        </span>
      </div>
      <div className="flex-1" />
      <div className="flex-shrink-0 px-4">
        <Badge variant="secondary">
          {formatTaskType(task.attributes.type)}
        </Badge>
      </div>
      <div className="flex-1" />
      <div className="flex flex-col items-end gap-1 min-w-[90px]">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="w-3 h-3" />
          <span>{startedAgo}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>{duration}</span>
        </div>
      </div>
    </div>
  );
};
