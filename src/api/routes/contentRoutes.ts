import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import sharp from 'sharp';
import { getISODate } from '../../utils/helpers.js';
import { LogService } from '../../services/LogService.js';

export async function registerContentRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

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
    } else if (agentId.startsWith('tool:')) {
      const toolId = agentId.replace('tool:', '');
      const toolRegistry = (await import('../../registries/ToolRegistry.js')).ToolRegistry.getInstance();
      // 工具调用通常需要一个对象参数，我们将输入映射为 prompt/input/markdown 以增强兼容性
      const result = await toolRegistry.callTool(toolId, { prompt: input, input, markdown: input });
      return {
        content: typeof result === 'string' ? result : (result.content || result.html || JSON.stringify(result)),
        data: result
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
      const body = request.body as any;
      const agentId = body.agentId;
      const prompt = body.prompt;
      const type = body.type;
      const content = body.content;
      const date = body.date || id; // 优先使用 body 中的 date，否则使用路径中的 id (日期)
      
      if (!agentId) {
        return reply.status(400).send({ error: 'Missing agentId' });
      }

      // 1. 确定输入内容
      let input: string;
      let item: any = null;
      let finalContent = content;

      if (type === 'cover') {
        if (prompt && finalContent) {
          input = `${prompt}\n\n[分隔符]:\n${finalContent}`;
        } else {
          input = prompt || finalContent || '请为文章生成一张封面图';
        }
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
        
        // 1. 优先从结构化数据中获取 URL
        if (result.data?.urls && Array.isArray(result.data.urls)) {
          urls.push(...result.data.urls);
        } else if (result.data?.url) {
          urls.push(result.data.url);
        }
        
        // 2. 检查是否显式返回了 HTML (通常来自专门的渲染工具)
        if (result.data?.html && urls.length === 0) {
          return { 
            status: 'success', 
            html: result.data.html,
            isHtml: true 
          };
        }

        // 3. 扫描文本内容中的图片 URL 和 Base64
        // 匹配 HTTP 图片链接 (常见后缀)
        const imgUrlMatches = result.content.match(/https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|gif|webp|avif)(?:[?#][^\s)]*)?/gi);
        if (imgUrlMatches) {
          for (const m of imgUrlMatches) {
            if (!urls.includes(m)) urls.push(m);
          }
        }
        
        // 匹配 Base64 data URLs
        const base64Matches = result.content.match(/data:image\/[a-zA-Z+]+;base64,[a-zA-Z0-9+/=]+/gi);
        if (base64Matches) {
          for (const m of base64Matches) {
            if (!urls.includes(m)) urls.push(m);
          }
        }

        // 如果之前没配到图片后缀，但有通用链接且不是 HTML，尝试匹配所有链接 (兼容一些无后缀的 API 链接)
        const isLikelyHtml = /<\/(p|div|section|h[1-6]|table|ul|ol|img|br)>/i.test(result.content);
        if (urls.length === 0 && !isLikelyHtml) {
          const generalHttpMatches = result.content.match(/https?:\/\/[^\s)]+/gi);
          if (generalHttpMatches) {
            for (const m of generalHttpMatches) {
              if (!urls.includes(m)) urls.push(m);
            }
          }
        }

        // 4. 如果找到了图片 URL，处理并返回
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
        
        // 5. 如果没找到图片，但内容看起来像 HTML，则作为 HTML 返回 (截图流程)
        if (isLikelyHtml || result.data?.html || result.data?.content?.includes('<')) {
          return { 
            status: 'success', 
            html: result.data?.html || result.data?.content || result.content,
            isHtml: true 
          };
        }

        // 如果是封面图生成但没找到 URL 且没找到 HTML，才抛出错误
        throw new Error('AI 未能成功生成图片 URL 或渲染内容');
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

  // 单条完整数据（含 content_html 等大字段），列表接口已 slim
  fastify.get('/api/content/item/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      if (typeof id === 'string' && id.startsWith('history-')) {
        const historyId = Number(id.replace('history-', ''));
        const record = await store.getCommitHistoryById(historyId);
        if (!record) {
          return reply.status(404).send({ error: 'Not found' });
        }
        return {
          id,
          title: record.commitMessage || `Archive: ${record.date}`,
          url: '',
          description: (record.fullContent || '').substring(0, 500),
          published_date: new Date(record.commitTime).toISOString(),
          ingestion_date: record.date,
          source: record.platform,
          category: 'history',
          metadata: {
            full_content: record.fullContent,
            archive_date: record.date,
            file_path: record.filePath
          }
        };
      }
      const item = await store.getSourceData(id);
      if (!item) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return item;
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

      // 对于 http 链接，尝试代理以支持跨域抓取，失败则回退到重定向
      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        try {
          const response = await fetch(filePath, { 
            method: 'GET',
            dispatcher: (context as any).proxyAgent 
          } as any);
          if (response.ok) {
            const contentType = response.headers.get('content-type');
            if (contentType) reply.header('content-type', contentType);
            const buffer = await response.arrayBuffer();
            return Buffer.from(buffer);
          }
        } catch (e: any) {
          LogService.warn(`Proxy fetch failed for ${filePath}, falling back to redirect: ${e.message}`);
        }
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
}
