import {
  formatDuration,
  formatTaskStatus,
  formatTaskType,
  TaskArtifactOutput,
  TaskLogOutput,
  TaskOutput,
  timeAgo,
} from '@colanode/core';
import { Clock, Calendar } from 'lucide-react';

import { TaskLogs } from '@/renderer/components/tasks/task-logs';
import { TaskArtifacts } from '@/renderer/components/tasks/task-artifacts';
import { TaskStatusBadge } from '@/renderer/components/tasks/task-status-badge';

interface TaskDetailsProps {
  task: TaskOutput;
  logs: TaskLogOutput[];
  artifacts: TaskArtifactOutput[];
}

export const TaskDetails = ({ task, logs, artifacts }: TaskDetailsProps) => {
  const startedAgo = task.startedAt ? timeAgo(task.startedAt) : 'Pending';
  const duration = task.startedAt
    ? formatDuration(task.startedAt, task.completedAt)
    : '0s';

  return (
    <div className="grid grid-cols-5 gap-4">
      <div className="col-span-3 flex flex-col gap-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-row items-center gap-4">
            <TaskStatusBadge status={task.status} className="size-7" />
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold">{task.name}</h1>
              <p className="text-sm text-muted-foreground">
                {task.description}
              </p>
            </div>
          </div>
          <div className="mt-4 pt-4 pb-4 border-t border-b border-border/40">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Type</span>
                <span className="font-semibold">
                  {formatTaskType(task.attributes.type)}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Status</span>
                <span className="font-semibold">
                  {formatTaskStatus(task.status)}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Started</span>
                <div className="flex items-center gap-1">
                  <Calendar className="size-4" />
                  <span className="font-semibold">{startedAgo}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Duration</span>
                <div className="flex items-center gap-1">
                  <Clock className="size-4" />
                  <span className="font-semibold">{duration}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Artifacts</span>
                <span className="font-semibold">{artifacts.length}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Logs</h2>
          <TaskLogs logs={logs} />
        </div>
      </div>
      <div className="col-span-2">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Artifacts</h2>
          <TaskArtifacts artifacts={artifacts} />
        </div>
      </div>
    </div>
  );
};
