import { FastifyPluginCallback } from 'fastify';

import { taskCreateRoute } from './task-create';
import { taskListRoute } from './task-list';
import { taskGetRoute } from './task-get';

import { accountAuthenticator } from '@/api/client/plugins/account-auth';

export const tasksRoutes: FastifyPluginCallback = (instance, _, done) => {
  instance.register(accountAuthenticator);

  instance.register(taskCreateRoute);
  instance.register(taskListRoute);
  instance.register(taskGetRoute);

  done();
};
