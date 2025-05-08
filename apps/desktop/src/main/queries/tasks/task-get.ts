import { TaskGetOutput } from '@colanode/core';

import { WorkspaceQueryHandlerBase } from '../workspace-query-handler-base';

import { ChangeCheckResult, QueryHandler } from '@/main/lib/types';
import { parseApiError } from '@/shared/lib/axios';
import { Event } from '@/shared/types/events';
import { TaskGetQueryInput } from '@/shared/queries/tasks/task-get';
import { QueryError, QueryErrorCode } from '@/shared/queries';

export class TaskGetQueryHandler
  extends WorkspaceQueryHandlerBase
  implements QueryHandler<TaskGetQueryInput>
{
  public async handleQuery(
    input: TaskGetQueryInput
  ): Promise<TaskGetOutput | null> {
    try {
      return this.fetchTask(input);
    } catch (error) {
      const apiError = parseApiError(error);
      throw new QueryError(QueryErrorCode.Unknown, apiError.message);
    }
  }

  public async checkForChanges(
    event: Event,
    input: TaskGetQueryInput,
    output: TaskGetOutput | null
  ): Promise<ChangeCheckResult<TaskGetQueryInput>> {
    if (
      event.type === 'workspace_deleted' &&
      event.workspace.accountId === input.accountId &&
      event.workspace.id === input.workspaceId
    ) {
      return {
        hasChanges: true,
        result: null,
      };
    }

    if (event.type === 'account_connection_message') {
      const message = event.message;
      if (
        message.type === 'task_created' &&
        message.task.workspaceId === input.workspaceId &&
        message.task.id === input.taskId
      ) {
        if (output === null) {
          const newOutput = await this.fetchTask(input);
          return {
            hasChanges: true,
            result: newOutput,
          };
        }

        return {
          hasChanges: true,
          result: {
            ...output,
            task: message.task,
          },
        };
      }

      if (
        message.type === 'task_updated' &&
        message.task.workspaceId === input.workspaceId &&
        message.task.id === input.taskId
      ) {
        if (output === null) {
          const newOutput = await this.fetchTask(input);
          return {
            hasChanges: true,
            result: newOutput,
          };
        }

        return {
          hasChanges: true,
          result: {
            ...output,
            task: message.task,
          },
        };
      }

      if (
        message.type === 'task_log_created' &&
        message.task.workspaceId === input.workspaceId &&
        message.task.id === input.taskId
      ) {
        if (output === null) {
          const newOutput = await this.fetchTask(input);
          return {
            hasChanges: true,
            result: newOutput,
          };
        }

        return {
          hasChanges: true,
          result: {
            ...output,
            task: message.task,
            logs: [
              ...output.logs.filter((log) => log.id !== message.log.id),
              message.log,
            ].sort((a, b) => a.id.localeCompare(b.id)),
          },
        };
      }

      if (
        message.type === 'task_artifact_created' &&
        message.task.workspaceId === input.workspaceId &&
        message.task.id === input.taskId
      ) {
        if (output === null) {
          const newOutput = await this.fetchTask(input);
          return {
            hasChanges: true,
            result: newOutput,
          };
        }

        return {
          hasChanges: true,
          result: {
            ...output,
            task: message.task,
            artifacts: [
              ...output.artifacts.filter(
                (artifact) => artifact.id !== message.artifact.id
              ),
              message.artifact,
            ],
          },
        };
      }
    }

    return {
      hasChanges: false,
    };
  }

  private async fetchTask(input: TaskGetQueryInput): Promise<TaskGetOutput> {
    const workspace = this.getWorkspace(input.accountId, input.workspaceId);

    const response = await workspace.account.client.get<TaskGetOutput>(
      `/v1/workspaces/${workspace.id}/tasks/${input.taskId}`
    );

    return response.data;
  }
}
