import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import crypto from 'crypto';
import { parseOPML } from '../../utils/opml.js';
import { LogService } from '../../services/LogService.js';

export async function registerAdapterRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.post('/api/adapters/import-opml', async (request, reply) => {
    try {
      const { opmlContent, adapterId } = request.body as any;
      if (!opmlContent) {
        return reply.status(400).send({ error: '缺少 opmlContent 参数' });
      }

      const feeds = parseOPML(opmlContent);
      if (feeds.length === 0) {
        return reply.status(400).send({ error: '未在 OPML 中找到任何 RSS 订阅源' });
      }

      const currentSettings = await store.get('system_settings') || {};
      const adapters = currentSettings.ADAPTERS || [];
      
      // 查找或创建 RSSAdapter 配置
      let rssAdapterConfig = adapterId 
        ? adapters.find((a: any) => a.id === adapterId)
        : adapters.find((a: any) => a.adapterType === 'RSSAdapter');
      
      if (!rssAdapterConfig) {
        rssAdapterConfig = {
          id: 'rss-bulk-import',
          name: 'RSS 批量导入',
          adapterType: 'RSSAdapter',
          enabled: true,
          apiUrl: '',
          items: []
        };
        adapters.push(rssAdapterConfig);
      }

      // 批量添加 items
      const newItems = feeds.map(feed => ({
        id: `rss-${crypto.createHash('md5').update(feed.xmlUrl).digest('hex').substring(0, 12)}`,
        name: feed.title,
        enabled: true,
        useProxy: false,
        category: feed.category || 'rss',
        rssUrl: feed.xmlUrl,
        limit: 20
      }));

      // 简单的去重逻辑（根据 rssUrl）
      const existingUrls = new Set(rssAdapterConfig.items.map((item: any) => item.rssUrl));
      for (const item of newItems) {
        if (!existingUrls.has(item.rssUrl)) {
          rssAdapterConfig.items.push(item);
        }
      }

      await store.put('system_settings', { ...currentSettings, ADAPTERS: adapters });
      await context.reload();

      return { status: 'success', count: feeds.length, added: newItems.length };
    } catch (error: any) {
      LogService.error(`OPML import failed: ${error.message}`);
      reply.status(500).send({ error: error.message });
    }
  });
}
