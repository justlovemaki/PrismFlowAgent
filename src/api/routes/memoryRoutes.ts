import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';

export async function registerMemoryRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.get('/api/memory/categories', async () => {
    return await context.memoryService.getCategories();
  });

  fastify.post('/api/memory/categories', async (request, reply) => {
    try {
      const { name, description } = request.body as any;
      if (!name) return reply.status(400).send({ error: '分类名称不能为空' });
      const id = await context.memoryService.addCategory(name, description);
      return { id };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/memory/categories/:id', async (request) => {
    const { id } = request.params as any;
    return await context.memoryService.getCategoryDetails(id);
  });

  fastify.delete('/api/memory/categories/:id', async (request) => {
    const { id } = request.params as any;
    await context.memoryService.deleteCategory(id);
    return { status: 'success' };
  });

  fastify.put('/api/memory/categories/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { name, description } = request.body as any;
      await context.memoryService.updateCategory(id, name, description);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/memory/categories/merge', async (request, reply) => {
    try {
      const { ids, targetName, targetDescription } = request.body as any;
      if (!ids || ids.length < 2 || !targetName) {
        return reply.status(400).send({ error: '合并至少需要两个 ID (ids) 和目标名称 (targetName)' });
      }
      const newId = await context.memoryService.mergeCategories(ids, targetName, targetDescription);
      return { status: 'success', id: newId };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/memory/query', async (request) => {
    const { query, categoryIds, limit } = request.body as any;
    const answer = await context.memoryService.queryMemory(query, { categoryIds, limit });
    return { answer };
  });

  fastify.delete('/api/memory/:id', async (request) => {
    const { id } = request.params as any;
    await context.memoryService.deleteMemory(id);
    return { status: 'success' };
  });

  fastify.post('/api/memory/merge', async (request, reply) => {
    try {
      const { ids, targetCategoryId } = request.body as any;
      if (!ids || !Array.isArray(ids) || ids.length < 2) {
        return reply.status(400).send({ error: '合并至少需要两条记忆 ID (ids)' });
      }
      const newId = await context.memoryService.mergeMemories(ids, { targetCategoryId });
      return { status: 'success', id: newId };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/memory/:id/move', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { targetCategoryId } = request.body as any;
      if (!targetCategoryId) return reply.status(400).send({ error: '目标分类 ID 不能为空' });
      await context.memoryService.moveMemoryToCategory(id, targetCategoryId);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/memory/:id/content', async (request) => {
    const { id } = request.params as any;
    const content = await context.memoryService.getMemoryFullText(id);
    return { content };
  });

  fastify.put('/api/memory/:id/content', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { content } = request.body as any;
      await context.memoryService.updateMemoryContent(id, content);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
}
