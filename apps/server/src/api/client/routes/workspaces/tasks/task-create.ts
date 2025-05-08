import { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  ApiErrorCode,
  taskCreateInputSchema,
  apiErrorOutputSchema,
  taskCreateOutputSchema,
  generateId,
  IdType,
  TaskStatus,
} from '@colanode/core';

import { database } from '@/data/database';
import { jobService } from '@/services/job-service';
import { eventBus } from '@/lib/event-bus';
import { mapTaskOutput } from '@/lib/tasks/mappers';

export const taskCreateRoute: FastifyPluginCallbackZod = (
  instance,
  _,
  done
) => {
  instance.route({
    method: 'POST',
    url: '/',
    schema: {
      body: taskCreateInputSchema,
      response: {
        200: taskCreateOutputSchema,
        400: apiErrorOutputSchema,
      },
    },
    handler: async (request, reply) => {
      if (request.user.role !== 'owner') {
        return reply.code(403).send({
          code: ApiErrorCode.Forbidden,
          message: 'Only owners can create a full workspace export.',
        });
      }

      const id = generateId(IdType.Task);
      const attributes = request.body.attributes;

      const task = await database
        .insertInto('tasks')
        .returningAll()
        .values({
          id,
          workspace_id: request.user.workspace_id,
          name: request.body.name,
          description: request.body.description,
          status: TaskStatus.Pending,
          attributes: JSON.stringify(attributes),
          created_at: new Date(),
          created_by: request.user.id,
        })
        .executeTakeFirst();

      if (!task) {
        return reply.code(500).send({
          code: ApiErrorCode.TaskCreateFailed,
          message: 'Failed to create task.',
        });
      }

      const taskOutput = mapTaskOutput(task);
      eventBus.publish({
        type: 'task_created',
        task: taskOutput,
      });

      await jobService.addJob(
        {
          type: 'execute_task',
          id,
        },
        {
          delay: 100,
          jobId: `task_${id}`,
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 1000 * 60 * 10, //10 minutes
          },
        }
      );

      return { task: taskOutput };
    },
  });

  done();
};
