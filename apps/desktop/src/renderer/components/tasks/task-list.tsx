import React from 'react';

import { useQuery } from '@/renderer/hooks/use-query';
import { useWorkspace } from '@/renderer/contexts/workspace';
import { Button } from '@/renderer/components/ui/button';
import { TaskCreateDialog } from '@/renderer/components/tasks/task-create-dialog';
import { TaskCard } from '@/renderer/components/tasks/task-card';
import { TaskCardSkeleton } from '@/renderer/components/tasks/task-card-skeleton';

export const TaskList = () => {
  const workspace = useWorkspace();
  const [showCreateModal, setShowCreateModal] = React.useState(false);

  const { data, isPending } = useQuery({
    type: 'task_list',
    accountId: workspace.accountId,
    workspaceId: workspace.id,
    limit: 10,
  });

  const tasks = data?.data ?? [];

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-heading mb-px text-2xl font-semibold tracking-tight">
            Tasks
          </h3>
          <Button onClick={() => setShowCreateModal(true)}>Create task</Button>
        </div>
        <div className="flex flex-col gap-2">
          {isPending && (
            <>
              <TaskCardSkeleton />
              <TaskCardSkeleton />
              <TaskCardSkeleton />
            </>
          )}
          {!isPending && tasks.map((t) => <TaskCard key={t.id} task={t} />)}
        </div>
      </div>
      <TaskCreateDialog
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
      />
    </>
  );
};
