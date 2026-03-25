import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import formbody from '@fastify/formbody';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import YAML from 'yaml';
import { LocalStore } from '../services/LocalStore.js';
import { AIService } from '../services/AIService.js';
import { createAIProvider } from '../services/AIProvider.js';
import { getISODate, parseGithubUrl } from '../utils/helpers.js';
import { parseOPML } from '../utils/opml.js';

import { LogService } from '../services/LogService.js';
import { ServiceContext } from '../services/ServiceContext.js';
import { ToolRegistry } from '../registries/ToolRegistry.js';
import { AdapterRegistry } from '../registries/AdapterRegistry.js';
import { PublisherRegistry } from '../registries/PublisherRegistry.js';
import { StorageRegistry } from '../registries/StorageRegistry.js';
import { WechatService } from '../plugins/builtin/publishers/wechat/WechatService.js';

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

export async function createServer(existingStore?: LocalStore) {
  const fastify = Fastify({ logger: true });
  const store = existingStore || new LocalStore();
  if (!existingStore) {
    await store.init();
  }

  // --- Get current context ---
  const context = await ServiceContext.getInstance(store);

  fastify.register(formbody);
  fastify.register(cors, { origin: true });
  fastify.register(jwt, { secret: process.env.JWT_SECRET || '' });
  fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  // --- 静态文件服务 (前端构建产物) ---
  const frontendDistPath = path.join(__dirname, '../../frontend/dist');
  fastify.register(fastifyStatic, {
    root: frontendDistPath,
    prefix: '/',
  });

  // --- Auth Middleware ---
  fastify.addHook('preHandler', async (request, reply) => {
    // 排除登录接口、注册接口、验证页面和静态资源
    const publicPaths = ['/api/login', '/api/ai/v1/register', '/api/ai/v1/verify'];
    if (publicPaths.some(path => request.url.startsWith(path)) || !request.url.startsWith('/api')) {
      return;
    }

    try {
      // 1. 检查 API Key (优先)
      const apiKey = request.headers['x-api-key'] as string;
      if (apiKey) {
        const isValid = await context.interopService.verifyApiKey(apiKey);
        if (isValid) {
          // 如果是 API Key 认证，仅允许访问 /api/ai/v1 路径
          if (request.url.startsWith('/api/ai/v1')) {
            (request as any).isApiKeyAuth = true;
            return;
          } else {
            return reply.status(403).send({ error: 'API Key is only authorized for /api/ai/v1 endpoints' });
          }
        }
      }

      // 2. 允许通过 query 参数携带 token (用于 <img> 标签访问)
      const queryToken = (request.query as any)?.token;
      if (queryToken) {
        await fastify.jwt.verify(queryToken);
        return;
      }

      // 3. 标准 JWT 认证
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // --- Routes ---

  fastify.post('/api/login', async (request, reply) => {
    const { password } = request.body as any;
    const currentPassword = context.settings.SYSTEM_PASSWORD || 'admin123';

    if (password === currentPassword) {
      const expiresIn = context.settings.AUTH_EXPIRE_TIME || '7d';
      const token = fastify.jwt.sign({ role: 'admin' }, { expiresIn });
      return { token };
    } else {
      reply.status(401).send({ error: 'Invalid password' });
    }
  });

  fastify.post('/writeData', async (request, reply) => {
    const { date } = request.body as any;
    await context.taskService.runDailyIngestion(date);
    return { status: 'success' };
  });

  // --- Unified Publish API ---

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

  // --- API Routes ---

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


  // --- Helper for unified AI execution ---
  const executeAI = async (agentId: string, input: string, date?: string) => {
    if (agentId.startsWith('workflow:')) {
      if (!context.workflowEngine) throw new Error('工作流引擎未初始化');
      const workflowId = agentId.replace('workflow:', '');
      const result = await context.workflowEngine.runWorkflow(workflowId, input, date);
      return {
        content: typeof result === 'string' ? result : JSON.stringify(result),
        data: typeof result === 'object' ? result : { result }
      };
    } else {
      if (!context.agentService) throw new Error('智能体服务未初始化');
      const actualAgentId = agentId.startsWith('agent:') ? agentId.replace('agent:', '') : agentId;
      return await context.agentService.runAgent(actualAgentId, input, date);
    }
  };

  fastify.post('/api/content/:id/regenerate', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { agentId, prompt, type, date } = request.body as any;
      
      if (!agentId) {
        return reply.status(400).send({ error: 'Missing agentId' });
      }

      // 1. 确定输入内容
      let input: string;
      let item: any = null;

      if (type === 'cover') {
        input = prompt || '请为文章生成一张封面图';
      } else {
        item = await store.getSourceData(id);
        if (!item) {
          return reply.status(404).send({ error: 'Content item not found' });
        }
        input = `请为以下内容生成简短的 AI 摘要（ai_summary）：\n标题：${item.title}\n描述：${item.metadata?.content_html || item.description}\n来源：${item.source}\n作者：${item.author || '未知'}`;
      }

      // 2. 执行 AI (Agent 或 Workflow)
      const result = await executeAI(agentId, input, date);

      // 3. 处理结果
      if (type === 'cover') {
        const urls: string[] = [];
        
        // Try to get URLs from result.data
        if (result.data?.urls && Array.isArray(result.data.urls)) {
          urls.push(...result.data.urls);
        } else if (result.data?.url) {
          urls.push(result.data.url);
        }
        
        // Match HTTP URLs
        const httpMatches = result.content.match(/https?:\/\/[^\s)]+/gi);
        if (httpMatches) {
          for (const m of httpMatches) {
            if (!urls.includes(m)) urls.push(m);
          }
        }
        // Match Base64 data URLs
        const base64Matches = result.content.match(/data:image\/[a-zA-Z+]+;base64,[a-zA-Z0-9+/=]+/gi);
        if (base64Matches) {
          for (const m of base64Matches) {
            if (!urls.includes(m)) urls.push(m);
          }
        }

        if (urls.length > 0) {
          // 确保所有 URL 都是唯一的并处理 base64
          const processedUrls = await Promise.all(urls.map(async (u) => {
            if (u.startsWith('data:image/')) {
              try {
                const matches = u.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
                if (!matches) return u;
                
                const buffer = Buffer.from(matches[2], 'base64');
                const tempDir = os.tmpdir();
                const filename = `ai_cover_${crypto.randomBytes(8).toString('hex')}.jpg`;
                const fullPath = path.resolve(tempDir, filename);
                
                await sharp(buffer).jpeg({ quality: 80 }).toFile(fullPath);
                LogService.info(`Saved base64 image to temp file: ${fullPath}`);
                return fullPath;
              } catch (err: any) {
                LogService.error(`Failed to save base64 image: ${err.message}`);
                return u;
              }
            }
            return u;
          }));

          const uniqueUrls = Array.from(new Set(processedUrls));
          // 返回第一个作为默认，同时返回所有
          return { status: 'success', url: uniqueUrls[0], urls: uniqueUrls };
        }
        // 如果是封面图生成但没找到 URL，才抛出错误
        throw new Error('AI 未能成功生成图片 URL');
      }

      // 更新摘要
      const newSummary = result.content;
      if (item) {
        item.metadata = { ...(item.metadata || {}), ai_summary: newSummary };
        await store.updateSourceDataMetadata(id, item.metadata);
      }
      
      return { status: 'success', ai_summary: newSummary };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/content', async (request, reply) => {
    try {
      const { date } = request.query as any;
      const targetDate = date || getISODate();
      const data = await context.taskService.getAggregatedData(targetDate, { settings: context.settings });
      
      return data;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.delete('/api/content/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      await context.taskService.deleteSourceData(id);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/temp-image', async (request, reply) => {
    try {
      const { path: filePath } = request.query as any;
      if (!filePath) {
        return reply.status(400).send({ error: 'Missing path parameter' });
      }

      // 对于 http 链接，直接返回 302 重定向
      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        return reply.redirect(filePath);
      }

      // 仅允许访问临时目录下的文件，防止路径遍历
      const resolvedPath = path.resolve(filePath);
      const tempDir = os.tmpdir();
      
      if (!resolvedPath.startsWith(tempDir)) {
        return reply.status(403).send({ error: 'Forbidden: Can only access temp files' });
      }

      if (!fs.existsSync(resolvedPath)) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const buffer = fs.readFileSync(resolvedPath);
      reply.header('content-type', 'image/jpeg');
      return buffer;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/proxy/image', async (request, reply) => {
    try {
      const { url } = request.query as any;
      if (!url) {
        return reply.status(400).send({ error: 'Missing url parameter' });
      }

      const response = await fetch(url, { dispatcher: context.proxyAgent } as any);
      if (!response.ok) {
        return reply.status(response.status).send({ error: `Failed to fetch image: ${response.statusText}` });
      }

      const contentType = response.headers.get('content-type');
      if (contentType) {
        reply.header('content-type', contentType);
      }

      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

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

  fastify.get('/api/settings', async (request, reply) => {
    return context.settings;
  });

  fastify.get('/api/plugins/metadata', async (request, reply) => {
    const adapterRegistry = AdapterRegistry.getInstance();
    const publisherRegistry = PublisherRegistry.getInstance();
    const storageRegistry = StorageRegistry.getInstance();
    const toolRegistry = (await import('../registries/ToolRegistry.js')).ToolRegistry.getInstance();

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
    if ((request as any).isApiKeyAuth) return reply.status(403).send({ error: 'Forbidden' });
    return await store.listApiKeys();
  });

  fastify.post('/api/settings/api-keys', async (request, reply) => {
    if ((request as any).isApiKeyAuth) return reply.status(403).send({ error: 'Forbidden' });
    const { name } = request.body as any;
    if (!name) return reply.status(400).send({ error: 'Missing name' });
    return await context.interopService.createApiKey({ name, status: 'active' });
  });

  fastify.delete('/api/settings/api-keys/:id', async (request, reply) => {
    if ((request as any).isApiKeyAuth) return reply.status(403).send({ error: 'Forbidden' });
    const { id } = request.params as any;
    await store.deleteApiKey(id);
    return { status: 'success' };
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

  // --- AI Interop API (v1) ---

  fastify.post('/api/ai/v1/register', async (request, reply) => {
    try {
      const { name } = request.body as any;
      const userAgent = request.headers['user-agent'] || 'unknown';
      const ip = request.ip;
      
      // 技术识别：基于 IP 和 UA 的哈希指纹
      const fingerprint = crypto.createHash('sha256')
        .update(`${ip}-${userAgent}`)
        .digest('hex');
      
      const result = await context.interopService.registerPendingKey(name, fingerprint);
      
      // 域名补全
      const host = request.headers.host || 'localhost';
      const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
      const fullVerificationUrl = `${protocol}://${host}${result.verificationUrl}`;

      return { 
        status: 'pending', 
        apiKey: result.key,
        verificationUrl: fullVerificationUrl,
        message: 'Your API Key has been generated but is currently PENDING. A human must visit the verificationUrl to approve your access.'
      };
    } catch (error: any) {
      reply.status(400).send({ error: error.message });
    }
  });

  const VERIFY_PAGE_CSS = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #f8fafc; color: #1e293b; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; -webkit-font-smoothing: antialiased; }
      .card { background: white; padding: 2.5rem; border-radius: 24px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); text-align: center; max-width: 440px; width: 90%; border: 1px solid rgba(226, 232, 240, 0.8); }
      .icon-circle { width: 72px; height: 72px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; font-size: 2rem; }
      .icon-success { background: #ecfdf5; color: #10b981; }
      .icon-error { background: #fef2f2; color: #ef4444; }
      .icon-info { background: #eff6ff; color: #3b82f6; }
      h1 { font-size: 1.5rem; font-weight: 800; margin: 0 0 0.75rem; color: #0f172a; letter-spacing: -0.025em; }
      p { color: #64748b; line-height: 1.6; font-size: 0.95rem; margin: 0 0 1.5rem; }
      .btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 0.875rem 1.5rem; font-size: 1rem; font-weight: 600; border-radius: 12px; border: none; cursor: pointer; transition: all 0.2s; text-decoration: none; box-sizing: border-box; }
      .btn-primary { background: #0cafcf; color: white; box-shadow: 0 4px 6px -1px rgba(12, 175, 207, 0.3); }
      .btn-primary:hover { background: #099bb8; transform: translateY(-1px); box-shadow: 0 10px 15px -3px rgba(12, 175, 207, 0.4); }
      .btn-secondary { background: #f1f5f9; color: #475569; }
      .btn-secondary:hover { background: #e2e8f0; }
      .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; text-align: left; margin-bottom: 2rem; font-size: 0.875rem; }
      .meta-item { display: flex; justify-content: space-between; margin-bottom: 0.75rem; }
      .meta-item:last-child { margin-bottom: 0; }
      .meta-label { color: #94a3b8; font-weight: 500; }
      .meta-value { color: #334155; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      .animate-success { animation: scaleIn 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
      @keyframes scaleIn { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    </style>
  `;

  fastify.get('/api/ai/v1/verify/:token', async (request, reply) => {
    const { token } = request.params as any;
    const record = await store.getApiKeyByVerificationToken(token);
    
    reply.type('text/html; charset=utf-8');
    if (!record) {
      return `
        <html>
          <head><meta charset="UTF-8"><title>验证失败</title>${VERIFY_PAGE_CSS}</head>
          <body>
            <div class="card">
              <div class="icon-circle icon-error">❌</div>
              <h1>验证链接无效</h1>
              <p>该验证令牌不存在或已过期，请检查链接是否完整。</p>
              <a href="/" class="btn btn-secondary">返回首页</a>
            </div>
          </body>
        </html>
      `;
    }

    if (record.status === 'active') {
      return `
        <html>
          <head><meta charset="UTF-8"><title>权限已激活</title>${VERIFY_PAGE_CSS}</head>
          <body>
            <div class="card">
              <div class="icon-circle icon-success animate-success">✅</div>
              <h1>权限已激活</h1>
              <p>该 API Key 已经是激活状态，无需重复验证。您可以直接开始使用，现在可以安全地关闭此页面。</p>
            </div>
          </body>
        </html>
      `;
    }

    return `
      <html>
        <head><meta charset="UTF-8"><title>确认接入申请</title>${VERIFY_PAGE_CSS}</head>
        <body>
          <div class="card">
            <div class="icon-circle icon-info">🔑</div>
            <h1>确认 AI 接入申请</h1>
            <p>系统收到一个新的接入申请，请核对来源信息后手动批准。</p>
            
            <div class="meta-box">
              <div class="meta-item">
                <span class="meta-label">申请名称</span>
                <span class="meta-value">${record.name}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">来源指纹</span>
                <span class="meta-value">${record.prefix}...</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">申请时间</span>
                <span class="meta-value">${new Date(record.created_at).toLocaleString()}</span>
              </div>
            </div>

            <form method="POST">
              <button type="submit" class="btn btn-primary">确认并批准接入</button>
            </form>
            <p style="margin-top: 1.5rem; font-size: 0.8rem; color: #94a3b8; margin-bottom: 0;">批准后，该 AI 系统将获得访问 API 接口的权限。</p>
          </div>
        </body>
      </html>
    `;
  });

  fastify.post('/api/ai/v1/verify/:token', async (request, reply) => {
    const { token } = request.params as any;
    const success = await context.interopService.approveKey(token);
    
    reply.type('text/html; charset=utf-8');
    if (success) {
      return `
        <html>
          <head><meta charset="UTF-8"><title>验证成功</title>${VERIFY_PAGE_CSS}</head>
          <body>
            <div class="card">
              <div class="icon-circle icon-success animate-success">✅</div>
              <h1>验证成功</h1>
              <p>该 AI 系统的访问权限已成功激活。</p>
            </div>
          </body>
        </html>
      `;
    } else {
      return `
        <html>
          <head><meta charset="UTF-8"><title>批准失败</title>${VERIFY_PAGE_CSS}</head>
          <body>
            <div class="card">
              <div class="icon-circle icon-error">❌</div>
              <h1>批准失败</h1>
              <p>无法完成批准操作。这可能是由于网络原因或令牌已失效。</p>
              <button onclick="location.reload()" class="btn btn-primary">刷新重试</button>
            </div>
          </body>
        </html>
      `;
    }

  });

  fastify.get('/api/ai/v1/discovery', async () => {
    return await context.interopService.getDiscovery();
  });

  fastify.get('/api/ai/v1/context', async (request, reply) => {
    const md = await context.interopService.getSystemContextMarkdown();
    reply.type('text/markdown');
    return md;
  });

  fastify.get('/api/ai/v1/tools', async () => {
    return await context.interopService.getToolsAsOpenAIFormat();
  });

  fastify.get('/api/ai/v1/skills', async () => {
    return await context.skillService.listSkills();
  });

  fastify.get('/api/ai/v1/settings', async (request, reply) => {
    try {
      return await context.interopService.getSettings();
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/ai/v1/settings', async (request, reply) => {
    try {
      const newSettings = request.body as any;
      await context.interopService.updateSettings(newSettings);
      
      // CRITICAL: Reload context after saving
      await context.reload();
      
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/ai/v1/schedules', async (request, reply) => {
    try {
      return await context.interopService.getSchedules();
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/ai/v1/schedules', async (request, reply) => {
    try {
      const schedule = request.body as any;
      await context.interopService.saveSchedule(schedule);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.delete('/api/ai/v1/schedules/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      await context.interopService.deleteSchedule(id);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/ai/v1/agents', async (request, reply) => {
    try {
      return await context.interopService.getAgents();
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/ai/v1/agents', async (request, reply) => {
    try {
      const agent = request.body as any;
      await context.interopService.saveAgent(agent);
      await context.reload();
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.delete('/api/ai/v1/agents/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      await context.interopService.deleteAgent(id);
      await context.reload();
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/ai/v1/workflows', async (request, reply) => {
    try {
      return await context.interopService.getWorkflows();
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/ai/v1/workflows', async (request, reply) => {
    try {
      const workflow = request.body as any;
      await context.interopService.saveWorkflow(workflow);
      await context.reload();
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.delete('/api/ai/v1/workflows/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      await context.interopService.deleteWorkflow(id);
      await context.reload();
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/ai/v1/execute', async (request, reply) => {
    try {
      const body = request.body as any;
      if (body.stream) {
        if (body.action !== 'agent') {
          return reply.status(400).send({ error: 'Streaming is only supported for agent action' });
        }
        
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        try {
          const result = await context.interopService.execute(body);
          if (typeof (result as any)[Symbol.asyncIterator] === 'function') {
            for await (const chunk of (result as any)) {
              if (!reply.raw.writable) break;
              reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          } else {
            reply.raw.write(`data: ${JSON.stringify(result)}\n\n`);
          }
          if (reply.raw.writable) reply.raw.write('data: [DONE]\n\n');
        } catch (err: any) {
          if (reply.raw.writable) reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        } finally {
          if (!reply.raw.destroyed) reply.raw.end();
        }
        return;
      }

      return await context.interopService.execute(body);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  // --- Agent & Workflow API ---

  fastify.get('/api/agents', async () => {
    const agents = await store.listAgents();
    return agents.filter((a: any) => !a.isHidden);
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

  fastify.get('/api/skills', async () => {
    return await store.listSkills();
  });

  fastify.get('/api/skills/store/search', async (request, reply) => {
    try {
      const { q, page, limit, sortBy } = request.query as any;
      return await context.skillStoreService.searchSkills(q, page, limit, sortBy);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/skills/store/ai-search', async (request, reply) => {
    try {
      const { q } = request.query as any;
      return await context.skillStoreService.aiSearchSkills(q);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/skills/import/github', async (request, reply) => {
    try {
      const { githubUrl } = request.body as any;
      if (!githubUrl) {
        return reply.status(400).send({ error: '缺少 githubUrl 参数' });
      }

      const params = parseGithubUrl(githubUrl);
      if (!params) {
        return reply.status(400).send({ error: '无效的 GitHub URL' });
      }

      // 尝试获取 GitHub Token
      const githubToken = context.settings.GLOBAL_GITHUB_TOKEN || (context.publisherInstances.find(p => p.id === 'github') as any)?.config?.token;

      // 使用直接从 GitHub API 获取内容的方法
      const response = await context.skillStoreService.fetchGithubSkillContentsDirectly(params, githubToken);
      const files = response.files;

      if (!files || !Array.isArray(files) || files.length === 0) {
        return reply.status(400).send({ error: '在指定的 GitHub 路径中未找到文件' });
      }

      // 查找 SKILL.md 以获取元数据
      const skillMdFile = files.find(f => f.path === 'SKILL.md');
      if (!skillMdFile) {
        return reply.status(400).send({ error: '在指定的 GitHub 路径中未找到 SKILL.md' });
      }

      // 解析 SKILL.md 元数据
      const skillMdContent = skillMdFile.content
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      const frontmatterMatch = skillMdContent.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/);
      
      let metadata: any = {};
      let instructions = '';
      if (frontmatterMatch) {
        try {
          metadata = YAML.parse(frontmatterMatch[1]);
          instructions = frontmatterMatch[2].trim();
        } catch (e) {
          LogService.error(`Failed to parse SKILL.md frontmatter: ${e}`);
        }
      }

      const skillId = metadata.name || params.path.split('/').pop() || 'imported-skill';
      const skillsDir = store.getSkillsDir();
      const skillDir = path.join(skillsDir, skillId);

      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      // 保存所有文件
      for (const file of files) {
        const filePath = path.join(skillDir, file.path);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, file.content, 'utf8');
      }

      const skill = {
        id: skillId,
        name: metadata.name || skillId,
        description: metadata.description || '',
        instructions: instructions || skillMdContent,
        files: files.map(f => f.path).filter(p => p !== 'SKILL.md'),
        dirPath: skillDir,
      };

      await store.saveSkill(skill);
      await context.skillService.refreshSkills();

      return { status: 'success', skill };
    } catch (error: any) {
      LogService.error(`GitHub skill import failed: ${error.message}`);
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/skills', async (request, reply) => {

    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: '请上传 .zip 压缩包' });
      }

      const buffer = await data.toBuffer();
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();

      // 查找 SKILL.md（支持根目录或一级子目录）
      let skillMdEntry = entries.find(e => e.entryName === 'SKILL.md');
      if (!skillMdEntry) {
        skillMdEntry = entries.find(e => e.entryName.endsWith('/SKILL.md') && e.entryName.split('/').length === 2);
      }
      if (!skillMdEntry) {
        return reply.status(400).send({ error: '压缩包中未找到 SKILL.md 文件' });
      }

      // 解析 YAML frontmatter（规范化换行符和 BOM）
      const skillMdContent = skillMdEntry.getData().toString('utf8')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      const frontmatterMatch = skillMdContent.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/);
      if (!frontmatterMatch) {
        return reply.status(400).send({ error: 'SKILL.md 缺少 YAML frontmatter（需要 --- 包裹的元数据）' });
      }

      let metadata: any;
      try {
        metadata = YAML.parse(frontmatterMatch[1]);
      } catch (yamlErr: any) {
        return reply.status(400).send({ error: `SKILL.md frontmatter YAML 格式错误: ${yamlErr.message}` });
      }

      if (!metadata.name) {
        return reply.status(400).send({ error: 'SKILL.md frontmatter 缺少 name 字段' });
      }
      if (!metadata.description) {
        return reply.status(400).send({ error: 'SKILL.md frontmatter 缺少 description 字段' });
      }

      // name 校验: 最多64字符，仅小写字母、数字、连字符
      if (metadata.name.length > 64 || !/^[a-z0-9-]+$/.test(metadata.name)) {
        return reply.status(400).send({ error: 'name 仅允许小写字母、数字和连字符，最多64字符' });
      }

      const instructions = frontmatterMatch[2].trim();
      const skillId = metadata.name;
      const skillsDir = store.getSkillsDir();
      const skillDir = path.join(skillsDir, skillId);

      // 清理旧目录（如果存在）
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }
      fs.mkdirSync(skillDir, { recursive: true });

      // 解压所有文件到技能目录
      const prefix = skillMdEntry.entryName === 'SKILL.md' ? '' : skillMdEntry.entryName.replace('SKILL.md', '');
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const relativePath = prefix ? entry.entryName.replace(prefix, '') : entry.entryName;
        const targetPath = path.join(skillDir, relativePath);
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(targetPath, entry.getData());
        if (relativePath !== 'SKILL.md') {
          files.push(relativePath);
        }
      }

      const skill = {
        id: skillId,
        name: metadata.name,
        description: metadata.description,
        instructions,
        files,
        dirPath: skillDir,
      };

      await store.saveSkill(skill);
      await context.skillService.refreshSkills();
      return { status: 'success', skill };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.delete('/api/skills/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const skill = await store.getSkill(id);
      
      if (skill && skill.isBuiltin) {
        return reply.status(403).send({ error: '系统内置技能不可删除' });
      }

      // 仅当目录在 data/skills 下时才物理删除文件夹
      const skillsDir = store.getSkillsDir();
      const skillDir = (skill && skill.dirPath) || path.join(skillsDir, id);
      
      if (fs.existsSync(skillDir) && skillDir.startsWith(skillsDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }
      
      await store.deleteSkill(id);
      await context.skillService.refreshSkills();
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  // 解析技能目录的辅助函数：优先使用数据库路径，路径不存在时回退到 SkillService 的路径
  const resolveSkillDir = (skill: any): string => {
    // 1. 数据库中的路径存在，直接使用
    if (skill.dirPath && fs.existsSync(skill.dirPath)) {
      return skill.dirPath;
    }
    // 2. 回退到 SkillService 中扫描到的路径（解决 Docker ↔ 本地环境切换问题）
    const fsSkill = context.skillService.getSkill(skill.id);
    if (fsSkill?.dirPath && fs.existsSync(fsSkill.dirPath)) {
      return fsSkill.dirPath;
    }
    // 3. 最后回退到 data/skills 下的默认路径
    return skill.dirPath || path.join(store.getSkillsDir(), skill.id);
  };

  fastify.get('/api/skills/:id/files', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const skill = await store.getSkill(id);
      if (!skill) {
        return reply.status(404).send({ error: '技能不存在' });
      }
      const skillDir = resolveSkillDir(skill);
      
      if (!fs.existsSync(skillDir)) {
        return { files: [] };
      }
      const walkDir = (dir: string, prefix = ''): any[] => {
        const items: any[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            items.push({ name: entry.name, path: rel, type: 'dir', children: walkDir(path.join(dir, entry.name), rel) });
          } else {
            const stat = fs.statSync(path.join(dir, entry.name));
            items.push({ name: entry.name, path: rel, type: 'file', size: stat.size });
          }
        }
        return items;
      };
      return { files: walkDir(skillDir) };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/skills/:id/file/*', async (request, reply) => {
    try {
      const { id, '*': filePath } = request.params as any;
      const skill = await store.getSkill(id);
      if (!skill) {
        return reply.status(404).send({ error: '技能不存在' });
      }
      const skillDir = resolveSkillDir(skill);
      const fullPath = path.join(skillDir, filePath);
      
      // 防止路径穿越
      if (!fullPath.startsWith(skillDir)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        return reply.status(404).send({ error: '文件不存在' });
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return { content, path: filePath };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/api/skills/:id/file/*', async (request, reply) => {
    try {
      const { id, '*': filePath } = request.params as any;
      const { content } = request.body as any;
      const skill = await store.getSkill(id);
      if (!skill) {
        return reply.status(404).send({ error: '技能不存在' });
      }
      const skillDir = resolveSkillDir(skill);
      const fullPath = path.join(skillDir, filePath);
      
      // 防止路径穿越
      if (!fullPath.startsWith(skillDir)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // 确保目录存在
      const targetDir = path.dirname(fullPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf8');

      let needsDbSave = false;

      // 如果是新文件，更新技能的文件列表
      if (!skill.files) skill.files = [];
      if (filePath !== 'SKILL.md' && !skill.files.includes(filePath)) {
        skill.files.push(filePath);
        needsDbSave = true;
      }

      // 如果修改的是 SKILL.md，同步更新数据库元数据
      if (filePath === 'SKILL.md') {
        const skillMdContent = content
          .replace(/^\uFEFF/, '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n');
        const frontmatterMatch = skillMdContent.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/);
        if (frontmatterMatch) {
          try {
            const metadata = YAML.parse(frontmatterMatch[1]);
            const instructions = frontmatterMatch[2].trim();
            
            // 只要有任何一项更新，就同步到数据库
            if (metadata.name) {
              skill.name = metadata.name;
              needsDbSave = true;
            }
            if (metadata.description) {
              skill.description = metadata.description;
              needsDbSave = true;
            }
            if (instructions !== undefined) {
              skill.instructions = instructions;
              needsDbSave = true;
            }
          } catch (e: any) {
            // YAML 解析失败也允许保存文件，但不更新元数据
            LogService.warn(`Failed to parse SKILL.md YAML: ${e.message}`);
          }
        }
      }

      if (needsDbSave) {
        await store.saveSkill(skill);
      }
      
      // 无论是否更新数据库，都刷新内存缓存，因为文件已经在磁盘上更新了
      await context.skillService.refreshSkills();

      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });



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
    const allTools = ToolRegistry.getInstance().getAllTools();
    const closedPlugins = context.settings.CLOSED_PLUGINS || [];
    return allTools.filter(tool => !closedPlugins.includes(tool.id));
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
    return await store.listWorkflows();
  });

  fastify.post('/api/workflows', async (request) => {
    const workflow = request.body as any;
    await store.saveWorkflow(workflow);
    await context.reload();
    return { status: 'success' };
  });

  // --- Scheduler API ---

  fastify.get('/api/schedules', async () => {
    return await store.listSchedules();
  });

  fastify.post('/api/schedules', async (request) => {
    const schedule = request.body as any;
    await store.saveSchedule(schedule);
    
    // Restart/Start the task in memory
    if (schedule.enabled) {
      context.schedulerService.startSchedule(schedule);
    } else {
      context.schedulerService.stopSchedule(schedule.id);
    }
    
    return { status: 'success' };
  });

  fastify.delete('/api/schedules/:id', async (request) => {
    const { id } = request.params as any;
    context.schedulerService.stopSchedule(id);
    await store.deleteSchedule(id);
    return { status: 'success' };
  });

  fastify.get('/api/schedules/logs', async (request) => {
    const { limit, offset, taskId } = request.query as any;
    return await store.listTaskLogs({
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      taskId
    });
  });

  fastify.post('/api/schedules/:id/run', async (request, reply) => {
    try {
      const { id } = request.params as any;
      
      // Fire and forget
      context.schedulerService.runNow(id).catch(err => LogService.error(`Manual run for ${id} failed: ${err}`));
      
      return { status: 'success', message: 'Task triggered' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  // --- MCP Config API ---


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

  // --- Knowledge Base API ---

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

  fastify.post('/api/kb/query', async (request) => {
    const { query, categoryIds, limit } = request.body as any;
    const answer = await context.knowledgeBaseService.queryKnowledge(query, { categoryIds, limit });
    return { answer };
  });

  // --- Memory API ---

  fastify.get('/api/memory/categories', async () => {
    return await context.memoryService.getCategories();
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

  fastify.get('/api/memory/:id/content', async (request) => {
    const { id } = request.params as any;
    const content = await context.memoryService.getMemoryFullText(id);
    return { content };
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      reply.status(404).send({ error: `API route not found: ${request.url}` });
    } else {
      // SPA 路由回退：所有非 API 请求返回 index.html
      reply.sendFile('index.html');
    }
  });

  return fastify;
}
