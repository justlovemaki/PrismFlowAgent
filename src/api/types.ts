import type { LocalStore } from '../services/LocalStore.js';
import type { ServiceContext } from '../services/ServiceContext.js';

export interface RouteDeps {
  store: LocalStore;
  context: ServiceContext;
}

declare module 'fastify' {
  interface FastifyRequest {
    isApiKeyAuth?: boolean;
  }
}
