import { TaskListOutput } from '@colanode/core';

export type TaskListQueryInput = {
  type: 'task_list';
  accountId: string;
  workspaceId: string;
  after?: string;
  limit: number;
};

declare module '@/shared/queries' {
  interface QueryMap {
    task_list: {
      input: TaskListQueryInput;
      output: TaskListOutput;
    };
  }
}
