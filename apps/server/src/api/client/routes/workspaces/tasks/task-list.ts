import { z } from 'zod';
import { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  ApiErrorCode,
  apiErrorOutputSchema,
  taskListOutputSchema,
  TaskOutput,
} from '@colanode/core';

import { database } from '@/data/database';
import { mapTaskOutput } from '@/lib/tasks/mappers';

export const taskListRoute: FastifyPluginCallbackZod = (instance, _, done) => {
  instance.route({
    method: 'GET',
    url: '/',
    schema: {
      querystring: z.object({
        after: z.string().optional(),
        limit: z
          .string()
          .optional()
          .transform((val) => (val ? parseInt(val, 10) : 20)),
      }),
      response: {
        200: taskListOutputSchema,
        400: apiErrorOutputSchema,
      },
    },
    handler: async (request, reply) => {
      const { after, limit } = request.query;

      if (request.user.role !== 'owner') {
        return reply.code(403).send({
          code: ApiErrorCode.Forbidden,
          message: 'Only owners can create a full workspace export.',
        });
      }

      const tasks = await database
        .selectFrom('tasks')
        .selectAll()
        .where('workspace_id', '=', request.user.workspace_id)
        .$if(after !== undefined, (qb) => qb.where('id', '<', after!))
        .orderBy('id', 'desc')
        .limit(limit + 1)
        .execute();

      const hasMore = tasks.length > limit;
      const nextCursor = hasMore ? tasks[tasks.length - 1]?.id : undefined;
      const data: TaskOutput[] = tasks.slice(0, limit).map(mapTaskOutput);

      return {
        hasMore,
        nextCursor,
        limit,
        data,
      };
    },
  });

  done();
};
