import { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sql } from 'kysely';

import { database } from '@colanode/server/data/database';
import { redis } from '@colanode/server/data/redis';
import { config } from '@colanode/server/lib/config';

const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  timestamp: z.string(),
  services: z.object({
    database: z.object({
      status: z.enum(['healthy', 'unhealthy']),
      responseTime: z.number().optional(),
      error: z.string().optional(),
    }),
    redis: z.object({
      status: z.enum(['healthy', 'unhealthy']),
      responseTime: z.number().optional(),
      error: z.string().optional(),
    }),
    storage: z.object({
      status: z.enum(['healthy', 'unhealthy']),
      responseTime: z.number().optional(),
      error: z.string().optional(),
    }),
  }),
});

type ServiceStatus = {
  status: 'healthy' | 'unhealthy';
  responseTime?: number;
  error?: string;
};

export const healthRoute: FastifyPluginCallbackZod = (instance, _, done) => {
  instance.route({
    method: 'GET',
    url: '/',
    schema: {
      response: {
        200: healthResponseSchema,
        503: healthResponseSchema,
      },
    },
    handler: async (_, reply) => {
      const timestamp = new Date().toISOString();
      const services: {
        database: ServiceStatus;
        redis: ServiceStatus;
        storage: ServiceStatus;
      } = {
        database: { status: 'unhealthy' },
        redis: { status: 'unhealthy' },
        storage: { status: 'unhealthy' },
      };

      // Database connectivity
      try {
        const start = Date.now();
        await sql`SELECT 1`.execute(database);
        const responseTime = Date.now() - start;
        services.database = { status: 'healthy', responseTime };
      } catch (error) {
        services.database = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      // Redis connectivity
      try {
        const start = Date.now();
        await redis.ping();
        const responseTime = Date.now() - start;
        services.redis = { status: 'healthy', responseTime };
      } catch (error) {
        services.redis = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      // S3 storage connectivity
      try {
        const start = Date.now();

        // Create a properly configured S3 client with forcePathStyle for health check
        const healthCheckS3 = new S3Client({
          endpoint: config.storage.endpoint,
          region: config.storage.region,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.storage.accessKey,
            secretAccessKey: config.storage.secretKey,
          },
        });

        const command = new HeadObjectCommand({
          Bucket: config.storage.bucket,
          Key: 'health-check',
        });
        try {
          await healthCheckS3.send(command);
        } catch (error: any) {
          if (
            error.name !== 'NotFound' &&
            error.$metadata?.httpStatusCode !== 404
          ) {
            throw error;
          }
        }
        const responseTime = Date.now() - start;
        services.storage = { status: 'healthy', responseTime };
      } catch (error) {
        services.storage = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      const allHealthy = Object.values(services).every(
        (service) => service.status === 'healthy'
      );
      const overallStatus: 'healthy' | 'unhealthy' = allHealthy
        ? 'healthy'
        : 'unhealthy';

      const response = {
        status: overallStatus,
        timestamp,
        services,
      };

      reply.status(allHealthy ? 200 : 503);
      return response;
    },
  });

  done();
};
