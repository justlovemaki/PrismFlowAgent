import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import crypto from 'crypto';
import { LogService } from '../../services/LogService.js';

export async function registerInteropRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

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
                <span class="meta-value">${new Date(record.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>
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
}
