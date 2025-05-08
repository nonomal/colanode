import { TaskAttributes, TaskOutput } from '@colanode/core';

export type TaskCreateMutationInput = {
  type: 'task_create';
  accountId: string;
  workspaceId: string;
  name: string;
  description: string;
  attributes: TaskAttributes;
};

export type TaskCreateMutationOutput = {
  task: TaskOutput;
};

declare module '@/shared/mutations' {
  interface MutationMap {
    task_create: {
      input: TaskCreateMutationInput;
      output: TaskCreateMutationOutput;
    };
  }
}
