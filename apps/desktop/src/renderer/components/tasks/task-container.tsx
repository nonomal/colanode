import {
  formatDuration,
  formatTaskStatus,
  formatTaskType,
  timeAgo,
} from '@colanode/core';
import { Clock, Calendar } from 'lucide-react';

import { Container, ContainerBody } from '@/renderer/components/ui/container';
import { useWorkspace } from '@/renderer/contexts/workspace';
import { useQuery } from '@/renderer/hooks/use-query';
import { TaskLogs } from '@/renderer/components/tasks/task-logs';
import { TaskArtifacts } from '@/renderer/components/tasks/task-artifacts';
import { TaskNotFound } from '@/renderer/components/tasks/task-not-found';
import { TaskStatusBadge } from '@/renderer/components/tasks/task-status-badge';

interface TaskContainerProps {
  taskId: string;
}

export const TaskContainer = ({ taskId }: TaskContainerProps) => {
  const workspace = useWorkspace();

  const { data, isPending } = useQuery({
    type: 'task_get',
    accountId: workspace.accountId,
    workspaceId: workspace.id,
    taskId: taskId,
  });

  if (isPending) {
    return <div>Loading...</div>;
  }

  if (!data) {
    return <TaskNotFound />;
  }

  const duration = formatDuration(data.task.createdAt, data.task.completedAt);
  const createdAtAgo = timeAgo(data.task.createdAt);

  return (
    <Container>
      <ContainerBody>
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-3 flex flex-col gap-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-row items-center gap-4">
                <TaskStatusBadge status={data.task.status} className="size-7" />
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold">{data.task.name}</h1>
                  <p className="text-sm text-muted-foreground">
                    {data.task.description}
                  </p>
                </div>
              </div>
              <div className="mt-4 pt-4 pb-4 border-t border-b border-border/40">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Type</span>
                    <span className="font-semibold">
                      {formatTaskType(data.task.attributes.type)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      Status
                    </span>
                    <span className="font-semibold">
                      {formatTaskStatus(data.task.status)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      Started
                    </span>
                    <div className="flex items-center gap-1">
                      <Calendar className="size-4" />
                      <span className="font-semibold">{createdAtAgo}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      Duration
                    </span>
                    <div className="flex items-center gap-1">
                      <Clock className="size-4" />
                      <span className="font-semibold">{duration}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      Artifacts
                    </span>
                    <span className="font-semibold">
                      {data.artifacts.length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Logs</h2>
              <TaskLogs logs={data.logs} />
            </div>
          </div>
          <div className="col-span-2">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Artifacts</h2>
              <TaskArtifacts artifacts={data.artifacts} />
            </div>
          </div>
        </div>
      </ContainerBody>
    </Container>
  );
};
