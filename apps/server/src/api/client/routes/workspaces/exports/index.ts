import { FastifyPluginCallback } from 'fastify';

import { exportCreateRoute } from './export-create';

export const exportsRoutes: FastifyPluginCallback = (instance, _, done) => {
  instance.register(exportCreateRoute);

  done();
};
