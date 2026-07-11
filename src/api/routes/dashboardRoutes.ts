import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import { AIService } from '../../services/AIService.js';
import { createAIProvider } from '../../services/AIProvider.js';
import { LogService } from '../../services/LogService.js';

export async function registerDashboardRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.post('/api/dashboard/ingest', async (request, reply) => {
    try {
      const { date } = (request.body as { date?: string }) || {};
      await context.taskService.runDailyIngestion(date);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/dashboard/stats', async (request, reply) => {
    try {
      return await context.taskService.getStats();
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/dashboard/adapters', async (request, reply) => {
    try {
      return await context.taskService.getAdapterStatus();
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/dashboard/adapters/:name/sync', async (request, reply) => {
    try {
      const { name } = request.params as any;
      const { date, ...config } = request.body as any;

      // 如果适配器实例配置了 useProxy，且请求中未指定，则透传实例配置
      const adapter = context.adapterInstances.find((a: any) => a.name === name);
      if (adapter && (adapter as any).useProxy !== undefined && config.useProxy === undefined) {
        config.useProxy = (adapter as any).useProxy;
      }

      await context.taskService.runSingleAdapterIngestion(name, date, config);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/dashboard/adapters/:name/clear', async (request, reply) => {
    try {
      const { name } = request.params as any;
      const { date } = request.body as any;
      await context.taskService.clearAdapterData(name, date);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/dashboard/logs', async (request, reply) => {
    try {
      return LogService.getLogs();
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/import', async (request, reply) => {
    try {
      const { mode, categoryId, payload } = request.body as any;
      if (!mode || !categoryId || !payload) {
        return reply.status(400).send({ error: '缺少必要参数 (mode, categoryId, payload)' });
      }

      const importService = context.importService;
      if (mode === 'URL') {
        const item = await importService.importFromUrl(payload.url, categoryId);
        context.taskService.clearCache();
        return { status: 'success', data: item };
      } else if (mode === 'TEXT') {
        const item = await importService.importFromText(payload.title, payload.content, categoryId);
        context.taskService.clearCache();
        return { status: 'success', data: item };
      } else if (mode === 'JSON') {
        const count = await importService.importFromJson(payload.json, categoryId);
        context.taskService.clearCache();
        return { status: 'success', count };
      } else {
        return reply.status(400).send({ error: '不支持的导入模式' });
      }
    } catch (error: any) {
      LogService.error(`API Import failed: ${error.message}`);
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/dashboard/test-ai', async (request, reply) => {

    try {
      if (!context.aiProvider) {
        return { status: 'error', message: 'AI Provider not configured' };
      }
      const aiService = new AIService(context.aiProvider, context.settings);
      const result = await aiService.testConnection();
      return result;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/ai/models', async (request, reply) => {
    try {
      const config = request.body as any;
      // 确保在获取模型列表时，如果 config 已经有了 models 数组但没有单个 model，
      // 我们提供一个合理的默认值给 createAIProvider
      const effectiveConfig = {
        ...config,
        model: config.model || (config.models && config.models[0])
      };
      const provider = createAIProvider(effectiveConfig);
      if (!provider) {
        reply.status(400).send({ error: 'Invalid provider configuration' });
        return;
      }
      if (!provider.listModels) {
        return [];
      }
      const models = await provider.listModels();
      return models;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/ai/test', async (request, reply) => {
    try {
      const config = request.body as any;
      const effectiveConfig = {
        ...config,
        model: config.model || (config.models && config.models[0])
      };
      const provider = createAIProvider(effectiveConfig);
      if (!provider) {
        return { status: 'error', message: '无效的提供商配置' };
      }
      const aiService = new AIService(provider, context.settings);
      return await aiService.testConnection();
    } catch (error: any) {
      return { status: 'error', message: error.message };
    }
  });
}
