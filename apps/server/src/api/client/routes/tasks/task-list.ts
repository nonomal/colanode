import { z } from 'zod';
import { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
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
    handler: async (request) => {
      const { after, limit } = request.query;

      const tasks = await database
        .selectFrom('tasks')
        .selectAll()
        .where('created_by', '=', request.account.id)
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
