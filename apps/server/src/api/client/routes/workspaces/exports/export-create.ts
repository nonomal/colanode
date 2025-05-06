import { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  ApiErrorCode,
  exportCreateInputSchema,
  apiErrorOutputSchema,
  exportCreateOutputSchema,
  generateId,
  IdType,
  ExportStatus,
} from '@colanode/core';

import { database } from '@/data/database';
import { jobService } from '@/services/job-service';

export const exportCreateRoute: FastifyPluginCallbackZod = (
  instance,
  _,
  done
) => {
  instance.route({
    method: 'POST',
    url: '/',
    schema: {
      body: exportCreateInputSchema,
      response: {
        200: exportCreateOutputSchema,
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

      const id = generateId(IdType.Export);

      await database
        .insertInto('exports')
        .values({
          id,
          workspace_id: request.user.workspace_id,
          status: ExportStatus.Pending,
          type: 'workspace',
          created_at: new Date(),
          created_by: request.user.id,
        })
        .execute();

      await jobService.addJob(
        {
          type: 'export',
          id,
        },
        {
          delay: 100,
          jobId: `export_${id}`,
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 1000 * 60 * 10, //10 minutes
          },
        }
      );

      return { id };
    },
  });

  done();
};
