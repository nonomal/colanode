import { Container, ContainerBody } from '@/renderer/components/ui/container';
import { useWorkspace } from '@/renderer/contexts/workspace';
import { useQuery } from '@/renderer/hooks/use-query';
import { TaskNotFound } from '@/renderer/components/tasks/task-not-found';
import { TaskDetails } from '@/renderer/components/tasks/task-details';
import { TaskSkeleton } from '@/renderer/components/tasks/task-skeleton';

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

  return (
    <Container>
      <ContainerBody>
        {isPending ? (
          <TaskSkeleton />
        ) : data ? (
          <TaskDetails
            task={data.task}
            logs={data.logs}
            artifacts={data.artifacts}
          />
        ) : (
          <TaskNotFound />
        )}
      </ContainerBody>
    </Container>
  );
};
