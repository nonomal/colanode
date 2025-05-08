import { TaskLogOutput } from '@colanode/core';

import { TaskLogLevelBadge } from '@/renderer/components/tasks/task-log-level-badge';

interface TaskLogsProps {
  logs: TaskLogOutput[];
}

export const TaskLogs = ({ logs }: TaskLogsProps) => {
  return (
    <div className="rounded-md bg-gray-100/50 p-3">
      <div className="flex flex-col gap-1 font-mono text-sm text-muted-foreground">
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-4">
            <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
            <TaskLogLevelBadge level={log.level} />
            <span>{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
