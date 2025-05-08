import { FastifyPluginCallback } from 'fastify';

import { taskCreateRoute } from './task-create';
import { taskListRoute } from './task-list';
import { taskGetRoute } from './task-get';

export const tasksRoutes: FastifyPluginCallback = (instance, _, done) => {
  instance.register(taskCreateRoute);
  instance.register(taskListRoute);
  instance.register(taskGetRoute);

  done();
};
