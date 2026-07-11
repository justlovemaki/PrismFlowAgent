import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import formbody from '@fastify/formbody';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'path';
import { fileURLToPath } from 'url';
import { LocalStore } from '../services/LocalStore.js';
import { ServiceContext } from '../services/ServiceContext.js';
import { LogService } from '../services/LogService.js';
import type { RouteDeps } from './types.js';
import { registerAuthHook, resolveCorsOrigin, resolveJwtSecret } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerDashboardRoutes } from './routes/dashboardRoutes.js';
import { registerPublishRoutes } from './routes/publishRoutes.js';
import { registerContentRoutes } from './routes/contentRoutes.js';
import { registerAdapterRoutes } from './routes/adapterRoutes.js';
import { registerSettingsRoutes } from './routes/settingsRoutes.js';
import { registerInteropRoutes } from './routes/interopRoutes.js';
import { registerAgentRoutes } from './routes/agentRoutes.js';
import { registerSkillRoutes } from './routes/skillRoutes.js';
import { registerToolWorkflowRoutes } from './routes/toolWorkflowRoutes.js';
import { registerScheduleRoutes } from './routes/scheduleRoutes.js';
import { registerMcpRoutes } from './routes/mcpRoutes.js';
import { registerKbRoutes } from './routes/kbRoutes.js';
import { registerMemoryRoutes } from './routes/memoryRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createServer(existingStore?: LocalStore) {
  const jwtSecret = resolveJwtSecret();

  const fastify = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024,
    maxParamLength: 5000,
  });

  const store = existingStore || new LocalStore();
  if (!existingStore) {
    await store.init();
  }

  const context = await ServiceContext.getInstance(store);
  const deps: RouteDeps = { store, context };

  if (!context.settings.SYSTEM_PASSWORD) {
    LogService.warn('SYSTEM_PASSWORD is not configured; login falls back to default "admin123". Change it in Settings immediately.');
  }

  await fastify.register(formbody);
  await fastify.register(cors, { origin: resolveCorsOrigin() });
  await fastify.register(jwt, { secret: jwtSecret });
  await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  const frontendDistPath = path.join(__dirname, '../../frontend/dist');
  await fastify.register(fastifyStatic, {
    root: frontendDistPath,
    prefix: '/',
  });

  registerAuthHook(fastify, context);

  fastify.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (statusCode >= 500) {
      LogService.error(err.message || String(err));
    }
    reply.status(statusCode).send({
      error: err.message || 'Internal Server Error',
    });
  });

  await registerAuthRoutes(fastify, deps);
  await registerDashboardRoutes(fastify, deps);
  await registerPublishRoutes(fastify, deps);
  await registerContentRoutes(fastify, deps);
  await registerAdapterRoutes(fastify, deps);
  await registerSettingsRoutes(fastify, deps);
  await registerInteropRoutes(fastify, deps);
  await registerAgentRoutes(fastify, deps);
  await registerSkillRoutes(fastify, deps);
  await registerToolWorkflowRoutes(fastify, deps);
  await registerScheduleRoutes(fastify, deps);
  await registerMcpRoutes(fastify, deps);
  await registerKbRoutes(fastify, deps);
  await registerMemoryRoutes(fastify, deps);

  // Backward-compatible alias (now authenticated under /api)
  fastify.post('/api/writeData', async (request, reply) => {
    try {
      const { date } = (request.body as { date?: string }) || {};
      await context.taskService.runDailyIngestion(date);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      reply.status(404).send({ error: `API route not found: ${request.url}` });
    } else {
      reply.sendFile('index.html');
    }
  });

  return fastify;
}
