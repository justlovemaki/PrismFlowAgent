import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServiceContext } from '../../services/ServiceContext.js';
import { LogService } from '../../services/LogService.js';

const PUBLIC_PATHS = ['/api/login', '/api/ai/v1/register', '/api/ai/v1/verify'];

export function registerAuthHook(fastify: FastifyInstance, context: ServiceContext) {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC_PATHS.some((p) => request.url.startsWith(p)) || !request.url.startsWith('/api')) {
      return;
    }

    try {
      const apiKey = request.headers['x-api-key'] as string | undefined;
      if (apiKey) {
        const isValid = await context.interopService.verifyApiKey(apiKey);
        if (isValid) {
          if (request.url.startsWith('/api/ai/v1')) {
            request.isApiKeyAuth = true;
            return;
          }
          return reply.status(403).send({ error: 'API Key is only authorized for /api/ai/v1 endpoints' });
        }
      }

      const queryToken = (request.query as { token?: string } | undefined)?.token;
      if (queryToken) {
        await fastify.jwt.verify(queryToken);
        return;
      }

      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });
}

export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production. Set it in environment variables.');
  }

  const devSecret = 'prismflow-dev-jwt-secret-change-me';
  LogService.warn('JWT_SECRET is not set; using insecure development default. Set JWT_SECRET before production use.');
  return devSecret;
}

export function resolveCorsOrigin(): boolean | string | string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw || raw === '*') {
    if (process.env.NODE_ENV === 'production') {
      LogService.warn('CORS_ORIGIN not set in production; defaulting to same-origin only (false). Set CORS_ORIGIN to allow frontends.');
      return false;
    }
    return true;
  }
  if (raw.includes(',')) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return raw;
}
