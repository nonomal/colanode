import { TaskListOutput } from '@colanode/core';

import { WorkspaceQueryHandlerBase } from '../workspace-query-handler-base';

import { ChangeCheckResult, QueryHandler } from '@/main/lib/types';
import { parseApiError } from '@/shared/lib/axios';
import { TaskListQueryInput } from '@/shared/queries/tasks/task-list';
import { Event } from '@/shared/types/events';
import { QueryError, QueryErrorCode } from '@/shared/queries';

export class TaskListQueryHandler
  extends WorkspaceQueryHandlerBase
  implements QueryHandler<TaskListQueryInput>
{
  public async handleQuery(input: TaskListQueryInput): Promise<TaskListOutput> {
    try {
      return this.fetchTasks(input);
    } catch (error) {
      const apiError = parseApiError(error);
      throw new QueryError(QueryErrorCode.Unknown, apiError.message);
    }
  }

  public async checkForChanges(
    event: Event,
    input: TaskListQueryInput,
    output: TaskListOutput
  ): Promise<ChangeCheckResult<TaskListQueryInput>> {
    if (
      event.type === 'workspace_deleted' &&
      event.workspace.accountId === input.accountId &&
      event.workspace.id === input.workspaceId
    ) {
      return {
        hasChanges: true,
        result: {
          hasMore: false,
          limit: input.limit,
          data: [],
          nextCursor: undefined,
        },
      };
    }

    if (event.type === 'account_connection_message') {
      const message = event.message;
      if (
        message.type === 'task_created' &&
        message.task.workspaceId === input.workspaceId
      ) {
        const newOutput = {
          ...output,
          data: [
            ...output.data.filter((task) => task.id !== message.task.id),
            message.task,
          ].sort((a, b) => -a.id.localeCompare(b.id)),
        };

        return {
          hasChanges: true,
          result: newOutput,
        };
      }

      if (
        message.type === 'task_updated' &&
        message.task.workspaceId === input.workspaceId
      ) {
        const newOutput = {
          ...output,
          data: output.data.map((task) =>
            task.id === message.task.id ? message.task : task
          ),
        };

        return {
          hasChanges: true,
          result: newOutput,
        };
      }

      if (
        message.type === 'task_log_created' &&
        message.task.workspaceId === input.workspaceId
      ) {
        const newOutput = {
          ...output,
          data: output.data.map((task) =>
            task.id === message.task.id ? message.task : task
          ),
        };

        return {
          hasChanges: true,
          result: newOutput,
        };
      }

      if (
        message.type === 'task_artifact_created' &&
        message.task.workspaceId === input.workspaceId
      ) {
        const newOutput = {
          ...output,
          data: output.data.map((task) =>
            task.id === message.task.id ? message.task : task
          ),
        };

        return {
          hasChanges: true,
          result: newOutput,
        };
      }
    }

    return {
      hasChanges: false,
    };
  }

  private async fetchTasks(input: TaskListQueryInput): Promise<TaskListOutput> {
    const workspace = this.getWorkspace(input.accountId, input.workspaceId);

    const response = await workspace.account.client.get<TaskListOutput>(
      `/v1/workspaces/${workspace.id}/tasks`,
      {
        params: {
          after: input.after,
          limit: input.limit,
        },
      }
    );

    return response.data;
  }
}
