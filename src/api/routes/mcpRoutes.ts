import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';

export async function registerMcpRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.get('/api/mcp-configs', async () => {
    return await store.listMCPConfigs();
  });

  fastify.post('/api/mcp-configs', async (request) => {
    const config = request.body as any;
    await store.saveMCPConfig(config);
    await context.reload();
    return { status: 'success' };
  });

  fastify.delete('/api/mcp-configs/:id', async (request) => {
    const { id } = request.params as any;
    await store.deleteMCPConfig(id);

    // 清理所有 Agent 中对该 MCP 的引用
    const agents = await store.listAgents();
    for (const agent of agents) {
      if (agent.mcpServerIds?.includes(id)) {
        agent.mcpServerIds = agent.mcpServerIds.filter((mid: string) => mid !== id);
        await store.saveAgent(agent);
      }
    }

    await context.reload();
    return { status: 'success' };
  });
}
