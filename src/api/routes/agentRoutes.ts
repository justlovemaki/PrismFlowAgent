import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import { createAIProvider } from '../../services/AIProvider.js';
import { LogService } from '../../services/LogService.js';

export async function registerAgentRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.get('/api/agents', async () => {
    const startedAt = performance.now();
    const agents = await store.listAgents();
    const visibleAgents = agents.filter((a: any) => !a.isHidden);
    LogService.info(`GET /api/agents returned ${visibleAgents.length} agents in ${Math.round(performance.now() - startedAt)}ms`);
    return visibleAgents;
  });

  fastify.post('/api/agents', async (request) => {
    const agent = request.body as any;

    // 保存前清理已不存在的 MCP 配置引用
    if (agent.mcpServerIds?.length) {
      const existingMCPs = await store.listMCPConfigs();
      const existingIds = new Set(existingMCPs.map((m: any) => m.id));
      agent.mcpServerIds = agent.mcpServerIds.filter((id: string) => existingIds.has(id));
    }

    await store.saveAgent(agent);
    await context.reload();
    return { status: 'success' };
  });

  fastify.delete('/api/agents/:id', async (request) => {
    const { id } = request.params as any;
    await store.deleteAgent(id);
    await context.reload();
    return { status: 'success' };
  });

  fastify.post('/api/agents/:id/run', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { input, date, stream: requestStream } = request.body as any;
      if (!context.agentService) {
        throw new Error('Agent Service not initialized (check AI Provider)');
      }

      const agentDef = await store.getAgent(id);
      const isStreaming = requestStream === true || (agentDef?.streaming === true && requestStream !== false);

      if (isStreaming) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        try {
          const stream = context.agentService.streamAgent(id, input, date);
          for await (const chunk of stream) {
            if (!reply.raw.writable) break;
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          if (reply.raw.writable) {
            reply.raw.write('data: [DONE]\n\n');
          }
        } catch (err: any) {
          if (reply.raw.writable) {
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
          }
        } finally {
          if (!reply.raw.destroyed) {
            reply.raw.end();
          }
        }
        return;
      }

      return await context.agentService.runAgent(id, input, date);
    } catch (error: any) {
      if (!reply.raw.headersSent) {
        reply.status(500).send({ error: error.message });
      } else if (!reply.raw.destroyed) {
        reply.raw.end();
      }
    }
  });

  fastify.post('/api/agents/:id/run-stream', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { input, date } = request.body as any;
      if (!context.agentService) {
        throw new Error('Agent Service not initialized');
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      try {
        const stream = context.agentService.streamAgent(id, input, date);
        for await (const chunk of stream) {
          if (!reply.raw.writable) break;
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        if (reply.raw.writable) {
          reply.raw.write('data: [DONE]\n\n');
        }
      } catch (err: any) {
        if (reply.raw.writable) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        }
      } finally {
        if (!reply.raw.destroyed) {
          reply.raw.end();
        }
      }
    } catch (error: any) {
      if (!reply.raw.headersSent) {
        reply.status(500).send({ error: error.message });
      } else if (!reply.raw.destroyed) {
        reply.raw.end();
      }
    }
  });

  fastify.post('/api/ai/stream', async (request, reply) => {
    try {
        const { prompt, systemInstruction, config } = request.body as any;
        let provider = context.aiProvider;
        if (config) {
            const effectiveConfig = {
                ...config,
                model: config.model || (config.models && config.models[0])
            };
            const created = createAIProvider(effectiveConfig, context.proxyAgent);
            if (created) provider = created;
        }

        if (!provider || !provider.streamContent) {
            throw new Error('AI Provider not configured or does not support streaming');
        }

        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        try {
          const stream = provider.streamContent(prompt, [], systemInstruction);
          for await (const chunk of stream) {
              if (!reply.raw.writable) break;
              reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          if (reply.raw.writable) {
            reply.raw.write('data: [DONE]\n\n');
          }
        } catch (err: any) {
          if (reply.raw.writable) {
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
          }
        } finally {
          if (!reply.raw.destroyed) {
            reply.raw.end();
          }
        }
    } catch (error: any) {
        if (!reply.raw.headersSent) {
          reply.status(500).send({ error: error.message });
        } else if (!reply.raw.destroyed) {
          reply.raw.end();
        }
    }
  });
}
