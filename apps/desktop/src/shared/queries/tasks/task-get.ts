import { TaskGetOutput } from '@colanode/core';

export type TaskGetQueryInput = {
  type: 'task_get';
  accountId: string;
  workspaceId: string;
  taskId: string;
};

declare module '@/shared/queries' {
  interface QueryMap {
    task_get: {
      input: TaskGetQueryInput;
      output: TaskGetOutput | null;
    };
  }
}
