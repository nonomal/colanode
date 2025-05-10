import {
  generateId,
  IdType,
  TaskArtifactStatus,
  TaskArtifactType,
  TaskLogLevel,
  TaskStatus,
} from '@colanode/core';

import { SelectTask } from '@/data/schema';
import { database } from '@/data/database';
import { eventBus } from '@/lib/event-bus';
import {
  mapTaskOutput,
  mapTaskLogOutput,
  mapTaskArtifactOutput,
} from '@/lib/tasks/mappers';

export abstract class TaskBase {
  protected readonly task: SelectTask;
  protected readonly taskDir: string;

  constructor(dbTask: SelectTask) {
    this.task = dbTask;
    this.taskDir = `tasks/${this.task.id}`;
  }

  protected async markTaskAsRunning() {
    const task = await database
      .updateTable('tasks')
      .returningAll()
      .set({
        status: TaskStatus.Running,
        started_at: new Date(),
      })
      .where('id', '=', this.task.id)
      .executeTakeFirst();

    if (!task) {
      throw new Error('Failed to update task');
    }

    eventBus.publish({
      type: 'task_updated',
      task: mapTaskOutput(task),
    });
  }

  protected async markTaskAsCompleted() {
    const task = await database
      .updateTable('tasks')
      .returningAll()
      .set({
        status: TaskStatus.Completed,
        completed_at: new Date(),
      })
      .where('id', '=', this.task.id)
      .executeTakeFirst();

    if (!task) {
      throw new Error('Failed to update task');
    }

    eventBus.publish({ type: 'task_updated', task: mapTaskOutput(task) });
  }

  protected async saveLog(level: TaskLogLevel, message: string) {
    const { taskLog, task } = await database
      .transaction()
      .execute(async (tx) => {
        const taskLog = await tx
          .insertInto('task_logs')
          .returningAll()
          .values({
            id: generateId(IdType.TaskLog),
            task_id: this.task.id,
            level,
            message,
            created_at: new Date(),
          })
          .executeTakeFirst();

        if (!taskLog) {
          throw new Error('Failed to write task log');
        }

        const task = await tx
          .updateTable('tasks')
          .returningAll()
          .set({
            active_at: new Date(),
          })
          .where('id', '=', this.task.id)
          .executeTakeFirst();

        if (!task) {
          throw new Error('Failed to update task');
        }

        return { taskLog, task };
      });

    eventBus.publish({
      type: 'task_log_created',
      task: mapTaskOutput(task),
      log: mapTaskLogOutput(taskLog),
    });
  }

  protected async saveArtifact(
    type: TaskArtifactType,
    path: string,
    name: string,
    mimeType: string,
    size: number,
    expiresAt: Date
  ) {
    const { taskArtifact, task } = await database
      .transaction()
      .execute(async (tx) => {
        const taskArtifact = await tx
          .insertInto('task_artifacts')
          .returningAll()
          .values({
            id: generateId(IdType.TaskArtifact),
            task_id: this.task.id,
            type,
            name,
            mime_type: mimeType,
            size,
            path,
            created_at: new Date(),
            expires_at: expiresAt,
            status: TaskArtifactStatus.Available,
          })
          .executeTakeFirst();

        if (!taskArtifact) {
          throw new Error('Failed to write task artifact');
        }

        const task = await tx
          .updateTable('tasks')
          .returningAll()
          .set({
            active_at: new Date(),
          })
          .where('id', '=', this.task.id)
          .executeTakeFirst();

        if (!task) {
          throw new Error('Failed to update task');
        }

        return { taskArtifact, task };
      });

    eventBus.publish({
      type: 'task_artifact_created',
      task: mapTaskOutput(task),
      artifact: mapTaskArtifactOutput(taskArtifact),
    });
  }
}
