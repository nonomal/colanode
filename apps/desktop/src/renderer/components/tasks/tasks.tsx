import { useServer } from '@/renderer/contexts/server';
import { TaskList } from '@/renderer/components/tasks/task-list';

export const Tasks = () => {
  const server = useServer();
  const areTasksSupported = server.supports('tasks');

  if (!areTasksSupported) {
    return (
      <div className="flex flex-col gap-4">
        <h3 className="font-heading mb-px text-2xl font-semibold tracking-tight">
          Tasks
        </h3>
        <p>
          This feature is not supported on the server this workspace is hosted
          on. Please contact your administrator to upgrade the server.
        </p>
      </div>
    );
  }

  return <TaskList />;
};
