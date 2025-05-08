import { TaskCreateInput, TaskCreateOutput } from '@colanode/core';

import { MutationHandler } from '@/main/lib/types';
import {
  TaskCreateMutationInput,
  TaskCreateMutationOutput,
} from '@/shared/mutations/tasks/task-create';
import { MutationError, MutationErrorCode } from '@/shared/mutations';
import { parseApiError } from '@/shared/lib/axios';
import { WorkspaceMutationHandlerBase } from '@/main/mutations/workspace-mutation-handler-base';

export class TaskCreateMutationHandler
  extends WorkspaceMutationHandlerBase
  implements MutationHandler<TaskCreateMutationInput>
{
  async handleMutation(
    input: TaskCreateMutationInput
  ): Promise<TaskCreateMutationOutput> {
    const workspace = this.getWorkspace(input.accountId, input.workspaceId);

    try {
      const body: TaskCreateInput = {
        name: input.name,
        description: input.description,
        attributes: input.attributes,
      };

      const response = await workspace.account.client.post<TaskCreateOutput>(
        `/v1/workspaces/${workspace.id}/tasks`,
        body
      );

      return {
        task: response.data.task,
      };
    } catch (error) {
      const apiError = parseApiError(error);
      throw new MutationError(MutationErrorCode.ApiError, apiError.message);
    }
  }
}
