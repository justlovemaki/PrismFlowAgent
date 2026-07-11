import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import { LogService } from '../../services/LogService.js';

export async function registerPublishRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.post('/api/publish/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { content, ...options } = request.body as any;

      if (!content) {
        return reply.status(400).send({ error: 'Missing content' });
      }

      const result = await context.taskService.publish(id, content, options);
      return { status: 'success', data: result };
    } catch (error: any) {
      LogService.error(`Publish to ${(request.params as any).id} failed: ${error.message}`);
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/history/commits', async (request, reply) => {
    try {
      const { date, platform, limit, offset, search } = request.query as any;
      const result = await context.taskService.getCommitHistory({
        date,
        platform,
        limit: limit ? parseInt(limit) : 20,
        offset: offset ? parseInt(offset) : 0,
        search
      });
      
      // 为每个记录添加查看链接
      const commits = result.records.map(record => {
        // 尝试找到对应的发布者实例
        const platformLower = record.platform.toLowerCase();
        const publisher = context.publisherInstances.find(p => 
          p.id.toLowerCase() === platformLower || 
          p.name.toLowerCase() === platformLower ||
          (platformLower === 'github' && p.id === 'github')
        );
        
        return {
          ...record,
          viewUrl: publisher?.getItemUrl?.(record) || ''
        };
      });
      
      return { 
        commits, 
        total: result.total
      };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.delete('/api/history/commits/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      await context.taskService.deleteCommitHistory(parseInt(id));
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/history/republish/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const recordId = parseInt(id);
      
      const record = await store.getCommitHistoryById(recordId);
      if (!record) {
        reply.status(404).send({ error: 'History record not found' });
        return;
      }

      const platformLower = record.platform.toLowerCase();
      const publisher = context.publisherInstances.find(p =>
        p.id.toLowerCase() === platformLower ||
        p.name.toLowerCase() === platformLower 
      );

      if (!publisher) {
        reply.status(400).send({ error: `Publisher for platform ${record.platform} not found or not configured` });
        return;
      }

      // 准备发布参数
      const options: any = {
        title: record.commitMessage, //Wechat
        filePath: record.filePath, //Github 
        date: record.date
      };

      const result = await context.taskService.publish(publisher.id, record.fullContent, options);
      return { status: 'success', data: result };
    } catch (error: any) {
      LogService.error(`Failed to republish: ${error.message}`);
      reply.status(500).send({ error: error.message });
    }
  });
}
