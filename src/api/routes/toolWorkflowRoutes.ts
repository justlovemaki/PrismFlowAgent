import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import { ToolRegistry } from '../../registries/ToolRegistry.js';
import { WechatService } from '../../plugins/builtin/publishers/wechat/WechatService.js';
import { LogService } from '../../services/LogService.js';

export async function registerToolWorkflowRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.post('/api/wechat/upload-material', async (request, reply) => {
    try {
      const { url } = request.body as any;
      if (!url) {
        return reply.status(400).send({ error: 'Missing url' });
      }
      const wechatService = WechatService.getInstance();
      if (!wechatService) {
        throw new Error('Wechat Service not initialized');
      }
      const result = await wechatService.uploadResource(url);
      return result;

    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/tools', async () => {
    const startedAt = performance.now();
    const allTools = ToolRegistry.getInstance().getAllTools();
    const closedPlugins = context.settings.CLOSED_PLUGINS || [];
    const tools = allTools.filter(tool => !closedPlugins.includes(tool.id));
    LogService.info(`GET /api/tools returned ${tools.length} tools in ${Math.round(performance.now() - startedAt)}ms`);
    return tools;
  });

  fastify.post('/api/tools/:id/run', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const args = request.body as any;

      const closedPlugins = context.settings.CLOSED_PLUGINS || [];
      if (closedPlugins.includes(id)) {
        return reply.status(403).send({ success: false, error: `Tool ${id} is disabled` });
      }
      
      const result = await ToolRegistry.getInstance().callTool(id, args);
      
      // 统一输出格式为 ToolResult
      if (result && typeof result === 'object') {
        if ('success' in result) return result;
        if ('error' in result) return { success: false, error: result.error };
        
        // 启发式转换
        return {
          success: true,
          content: typeof result.html === 'string' ? result.html :
                   typeof result.content === 'string' ? result.content : 
                   typeof result.summary === 'string' ? result.summary : undefined,
          data: result
        };
      }
      
      return {
        success: true,
        content: typeof result === 'string' ? result : JSON.stringify(result),
        data: result
      };
    } catch (error: any) {
      reply.status(500).send({ success: false, error: error.message });
    }
  });


  fastify.get('/api/workflows', async () => {
    const startedAt = performance.now();
    const workflows = await store.listWorkflows();
    LogService.info(`GET /api/workflows returned ${workflows.length} workflows in ${Math.round(performance.now() - startedAt)}ms`);
    return workflows;
  });

  fastify.post('/api/workflows', async (request) => {
    const workflow = request.body as any;
    await store.saveWorkflow(workflow);
    await context.reload();
    return { status: 'success' };
  });

  fastify.delete('/api/workflows/:id', async (request) => {
    const { id } = request.params as any;
    await store.deleteWorkflow(id);
    await context.reload();
    return { status: 'success' };
  });

  fastify.post('/api/workflows/:id/run', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { input, date } = request.body as any;
      if (!context.workflowEngine) {
        throw new Error('Workflow Engine not initialized');
      }
      const result = await context.workflowEngine.runWorkflow(id, input, date);
      return { content: typeof result === 'string' ? result : JSON.stringify(result) };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
}
