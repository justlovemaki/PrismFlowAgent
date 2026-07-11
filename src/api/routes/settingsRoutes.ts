import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import { AdapterRegistry } from '../../registries/AdapterRegistry.js';
import { PublisherRegistry } from '../../registries/PublisherRegistry.js';
import { StorageRegistry } from '../../registries/StorageRegistry.js';
import { LogService } from '../../services/LogService.js';

export async function registerSettingsRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.get('/api/settings', async (request, reply) => {
    return context.settings;
  });

  fastify.get('/api/plugins/metadata', async (request, reply) => {
    const adapterRegistry = AdapterRegistry.getInstance();
    const publisherRegistry = PublisherRegistry.getInstance();
    const storageRegistry = StorageRegistry.getInstance();
    const toolRegistry = (await import('../../registries/ToolRegistry.js')).ToolRegistry.getInstance();

    return { 
      adapters: adapterRegistry.listMetadata(), 
      publishers: publisherRegistry.listMetadata(),
      storages: storageRegistry.listMetadata(),
      tools: toolRegistry.listMetadata()
    };
  });

  fastify.post('/api/settings', async (request, reply) => {

    try {
      const newSettings = request.body as any;
      const currentSettings = await store.get('system_settings') || {};
      
      // 深度合并，确保数组字段被正确覆盖而不是合并
      const updatedSettings = { ...currentSettings };
      for (const key in newSettings) {
        if (newSettings.hasOwnProperty(key)) {
          updatedSettings[key] = newSettings[key];
        }
      }
      
      // 日志记录保存前后的 CLOSED_PLUGINS
      LogService.info(`Saving settings - CLOSED_PLUGINS before: ${JSON.stringify(currentSettings.CLOSED_PLUGINS || [])}`);
      LogService.info(`Saving settings - CLOSED_PLUGINS after: ${JSON.stringify(updatedSettings.CLOSED_PLUGINS || [])}`);
      
      await store.put('system_settings', updatedSettings);
      
      // 验证保存是否成功
      const savedSettings = await store.get('system_settings');
      LogService.info(`Saved settings - CLOSED_PLUGINS verified: ${JSON.stringify(savedSettings.CLOSED_PLUGINS || [])}`);
      
      // --- CRITICAL: Reload context after saving ---
      await context.reload();
      
      return { status: 'success' };
    } catch (error: any) {
      LogService.error(`Failed to save settings: ${error.message}`);
      reply.status(500).send({ error: error.message });
    }
  });

  // --- API Key Management API (Admin Only) ---

  fastify.get('/api/settings/api-keys', async (request, reply) => {
    if (request.isApiKeyAuth) return reply.status(403).send({ error: 'Forbidden' });
    return await store.listApiKeys();
  });

  fastify.post('/api/settings/api-keys', async (request, reply) => {
    if (request.isApiKeyAuth) return reply.status(403).send({ error: 'Forbidden' });
    const { name, status } = request.body as any;
    if (!name) return reply.status(400).send({ error: 'Missing name' });
    return await context.interopService.createApiKey({ name, status: status || 'active' });
  });

  fastify.patch('/api/settings/api-keys/:id', async (request, reply) => {
    if (request.isApiKeyAuth) return reply.status(403).send({ error: 'Forbidden' });
    const { id } = request.params as any;
    const data = request.body as any;
    await context.interopService.updateApiKey(id, data);
    return { status: 'success' };
  });

  fastify.delete('/api/settings/api-keys/:id', async (request, reply) => {
    if (request.isApiKeyAuth) return reply.status(403).send({ error: 'Forbidden' });
    const { id } = request.params as any;
    await store.deleteApiKey(id);
    return { status: 'success' };
  });
}
