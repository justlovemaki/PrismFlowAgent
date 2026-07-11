import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';

export async function registerAuthRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { context } = deps;

  fastify.post('/api/login', async (request, reply) => {
    const { password } = (request.body as { password?: string }) || {};
    const currentPassword = context.settings.SYSTEM_PASSWORD || 'admin123';
    const usingDefaultPassword = !context.settings.SYSTEM_PASSWORD;

    if (password === currentPassword) {
      const expiresIn = context.settings.AUTH_EXPIRE_TIME || '7d';
      const token = fastify.jwt.sign(
        { role: 'admin', mustChangePassword: usingDefaultPassword },
        { expiresIn }
      );
      return { token, mustChangePassword: usingDefaultPassword };
    }
    reply.status(401).send({ error: 'Invalid password' });
  });
}
