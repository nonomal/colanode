import { z } from 'zod';
import { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  ApiErrorCode,
  apiErrorOutputSchema,
  taskGetOutputSchema,
  TaskGetOutput,
} from '@colanode/core';

import { database } from '@/data/database';
import {
  mapTaskArtifactOutput,
  mapTaskLogOutput,
  mapTaskOutput,
} from '@/lib/tasks/mappers';

export const taskGetRoute: FastifyPluginCallbackZod = (instance, _, done) => {
  instance.route({
    method: 'GET',
    url: '/:taskId',
    schema: {
      params: z.object({
        taskId: z.string(),
      }),
      response: {
        200: taskGetOutputSchema,
        400: apiErrorOutputSchema,
      },
    },
    handler: async (request, reply) => {
      const { taskId } = request.params;

      if (request.user.role !== 'owner') {
        return reply.code(403).send({
          code: ApiErrorCode.Forbidden,
          message: 'Only owners can create a full workspace export.',
        });
      }

      const task = await database
        .selectFrom('tasks')
        .selectAll()
        .where('workspace_id', '=', request.user.workspace_id)
        .where('id', '=', taskId)
        .executeTakeFirst();

      if (!task) {
        return reply.code(404).send({
          code: ApiErrorCode.NotFound,
          message: 'Task not found.',
        });
      }

      const logs = await database
        .selectFrom('task_logs')
        .selectAll()
        .where('task_id', '=', taskId)
        .execute();

      const artifacts = await database
        .selectFrom('task_artifacts')
        .selectAll()
        .where('task_id', '=', taskId)
        .execute();

      const output: TaskGetOutput = {
        task: mapTaskOutput(task),
        logs: logs.map(mapTaskLogOutput),
        artifacts: artifacts.map(mapTaskArtifactOutput),
      };

      return output;
    },
  });

  done();
};
