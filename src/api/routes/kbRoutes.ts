import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import { PromptService } from '../../services/PromptService.js';
import { MEMORY_WRITE_AGENT_ID } from '../../services/agents/defaultAgentIds.js';
import { LogService } from '../../services/LogService.js';

export async function registerKbRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.get('/api/kb/categories', async () => {
    return await context.knowledgeBaseService.getCategories();
  });

  fastify.post('/api/kb/categories', async (request) => {
    const { name, description } = request.body as any;
    const id = await context.knowledgeBaseService.addCategory(name, description);
    return { id };
  });

  fastify.delete('/api/kb/categories/:id', async (request) => {
    const { id } = request.params as any;
    await context.knowledgeBaseService.deleteCategory(id);
    return { status: 'success' };
  });

  fastify.put('/api/kb/categories/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { name, description } = request.body as any;
      await context.knowledgeBaseService.updateCategory(id, name, description);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/kb/categories/merge', async (request, reply) => {
    try {
      const { ids, targetName, targetDescription } = request.body as any;
      if (!ids || ids.length < 2 || !targetName) {
        return reply.status(400).send({ error: '合并至少需要两个 ID (ids) 和目标名称 (targetName)' });
      }
      const newId = await context.knowledgeBaseService.mergeCategories(ids, targetName, targetDescription);
      return { status: 'success', id: newId };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/kb/documents', async (request) => {
    const { categoryId } = request.query as any;
    if (!categoryId) return [];
    return await context.knowledgeBaseService.getDocuments(categoryId);
  });

  fastify.post('/api/kb/documents', async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });
      
      const categoryId = (data.fields.categoryId as any)?.value;
      if (!categoryId) return reply.status(400).send({ error: 'Missing categoryId' });

      const buffer = await data.toBuffer();
      const id = await context.knowledgeBaseService.addDocument(categoryId, {
        name: data.filename,
        path: data.filename,
        buffer
      });
      return { status: 'success', id };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.delete('/api/kb/documents/:id', async (request) => {
    const { id } = request.params as any;
    await context.knowledgeBaseService.deleteDocument(id);
    return { status: 'success' };
  });

  fastify.get('/api/kb/documents/:id/content', async (request) => {
    const { id } = request.params as any;
    const content = await context.knowledgeBaseService.getDocumentFullText(id);
    return { content };
  });

  fastify.put('/api/kb/documents/:id/content', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { content } = request.body as any;
      await context.knowledgeBaseService.updateDocumentContent(id, content);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/kb/documents/:id/move-to-memory', async (request, reply) => {
    try {
      const { id } = request.params as any;
      
      // 1. 获取文档内容
      const content = await context.knowledgeBaseService.getDocumentFullText(id);
      if (content === '文档内容未找到') {
        return reply.status(404).send({ error: '文档不存在' });
      }

      // 2. 调用 AI 进行深度整理 (按照流光记忆协议重构内容)
      const organizePrompt = PromptService.getInstance().getPrompt('knowledge_organize_for_memory', { content });

      const organizeResult = await context.agentService?.runAgent(MEMORY_WRITE_AGENT_ID, organizePrompt, undefined, { silent: false, noTools: true });
      const organizedContent = organizeResult?.content || content;

      if (!organizeResult?.content || organizeResult.content === 'No response generated (AI returned empty content)') {
        LogService.warn(`AI organization failed for document ${id}, falling back to raw content.`);
      }

      // 3. 存入记忆 (使用 AI 整理后的内容)
      const memoryId = await context.memoryService.saveMemory(organizedContent, {
        importance: 4, // 经过整理的知识通常重要度较高
        tags: ['organized_from_kb']
      });

      // 4. 删除原文档
      await context.knowledgeBaseService.deleteDocument(id);

      return { status: 'success', memoryId };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/kb/query', async (request) => {
    const { query, categoryIds, limit } = request.body as any;
    const answer = await context.knowledgeBaseService.queryKnowledge(query, { categoryIds, limit });
    return { answer };
  });
}
