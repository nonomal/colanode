import { TaskListOutput } from '@colanode/core';

import { ChangeCheckResult, QueryHandler } from '@/main/lib/types';
import { parseApiError } from '@/shared/lib/axios';
import { TaskListQueryInput } from '@/shared/queries/tasks/task-list';
import { Event } from '@/shared/types/events';
import { QueryError, QueryErrorCode } from '@/shared/queries';
import { appService } from '@/main/services/app-service';
export class TaskListQueryHandler implements QueryHandler<TaskListQueryInput> {
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
      event.type === 'account_deleted' &&
      event.account.id === input.accountId
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
        message.task.createdBy === input.accountId
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
        message.task.createdBy === input.accountId
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
        message.task.createdBy === input.accountId
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
        message.task.createdBy === input.accountId
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
    const account = appService.getAccount(input.accountId);
    if (!account) {
      throw new QueryError(QueryErrorCode.AccountNotFound, 'Account not found');
    }

    const response = await account.client.get<TaskListOutput>(`/v1/tasks`, {
      params: {
        after: input.after,
        limit: input.limit,
      },
    });

    return response.data;
  }
}
