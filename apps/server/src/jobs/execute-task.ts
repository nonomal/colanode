import { createDebugger, TaskStatus } from '@colanode/core';

import { JobHandler } from '@/types/jobs';
import { database } from '@/data/database';
import { WorkspaceExport } from '@/lib/tasks/workspace-export';
import { WorkspaceImport } from '@/lib/tasks/workspace-import';

const debug = createDebugger('server:job:generate-export');

export type ExecuteTaskInput = {
  type: 'execute_task';
  id: string;
};

declare module '@/types/jobs' {
  interface JobMap {
    execute_task: {
      input: ExecuteTaskInput;
    };
  }
}

export const executeTaskHandler: JobHandler<ExecuteTaskInput> = async (
  input
) => {
  debug(`Executing task ${input.id}`);

  const task = await database
    .selectFrom('tasks')
    .selectAll()
    .where('id', '=', input.id)
    .executeTakeFirst();

  if (!task) {
    debug(`Task ${input.id} not found`);
    return;
  }

  if (task.status === TaskStatus.Completed) {
    debug(`Task ${input.id} is already completed`);
    return;
  }

  if (task.status === TaskStatus.Failed) {
    debug(`Task ${input.id} is marked as failed`);
    return;
  }

  if (task.status === TaskStatus.Running) {
    debug(`Task ${input.id} is still generating`);
    return;
  }

  const workspace = await database
    .selectFrom('workspaces')
    .where('id', '=', task.workspace_id)
    .selectAll()
    .executeTakeFirst();

  if (!workspace) {
    debug(`Workspace ${task.workspace_id} not found`);
    return;
  }

  if (task.attributes.type === 'export_workspace') {
    const exporter = new WorkspaceExport(task, workspace);
    await exporter.export();
  } else if (task.attributes.type === 'import_workspace') {
    const importer = new WorkspaceImport(task, workspace);
    await importer.import();
  }
};
