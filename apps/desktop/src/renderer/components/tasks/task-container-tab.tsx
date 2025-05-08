import { DatabaseBackup } from 'lucide-react';

import { useWorkspace } from '@/renderer/contexts/workspace';
import { useQuery } from '@/renderer/hooks/use-query';
import { TaskStatusBadge } from '@/renderer/components/tasks/task-status-badge';

interface TaskContainerTabProps {
  taskId: string;
  isActive: boolean;
}

export const TaskContainerTab = ({ taskId }: TaskContainerTabProps) => {
  const workspace = useWorkspace();

  const { data } = useQuery({
    type: 'task_get',
    accountId: workspace.accountId,
    workspaceId: workspace.id,
    taskId: taskId,
  });

  return (
    <div className="flex items-center space-x-2">
      {data ? (
        <TaskStatusBadge status={data.task.status} className="size-4" />
      ) : (
        <DatabaseBackup className="size-4" />
      )}
      <span>{data?.task.name ?? 'Task'}</span>
    </div>
  );
};
