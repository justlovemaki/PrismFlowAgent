import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import formbody from '@fastify/formbody';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import YAML from 'yaml';
import { LocalStore } from '../services/LocalStore.js';
import { AIService } from '../services/AIService.js';
import { createAIProvider } from '../services/AIProvider.js';
import { getISODate, parseGithubUrl } from '../utils/helpers.js';

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
    // 排除登录接口和静态资源
    if (request.url === '/api/login' || !request.url.startsWith('/api')) {
      return;
    }

    try {
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
        const urlMatch = result.data?.url || result.content.match(/https?:\/\/[^\s)]+/i)?.[0];
        if (urlMatch) {
          return { status: 'success', url: urlMatch };
        }
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
      const data = await context.taskService.getAggregatedData(targetDate);
      
      return data;
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

  // --- Agent & Workflow API ---

  fastify.get('/api/agents', async () => {
    return await store.listAgents();
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
    return { status: 'success' };
  });

  fastify.delete('/api/agents/:id', async (request) => {
    const { id } = request.params as any;
    await store.deleteAgent(id);
    return { status: 'success' };
  });

  fastify.post('/api/agents/:id/run', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { input, date } = request.body as any;
      if (!context.agentService) {
        throw new Error('Agent Service not initialized (check AI Provider)');
      }
      return await context.agentService.runAgent(id, input, date);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
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
      return { status: 'success', skill };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.delete('/api/skills/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      // 删除技能文件目录
      const skillsDir = store.getSkillsDir();
      const skillDir = path.join(skillsDir, id);
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }
      await store.deleteSkill(id);
      return { status: 'success' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/api/skills/:id/files', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const skill = await store.getSkill(id);
      if (!skill) {
        return reply.status(404).send({ error: '技能不存在' });
      }
      const skillDir = path.join(store.getSkillsDir(), id);
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
      const skillDir = path.join(store.getSkillsDir(), id);
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
      const skillDir = path.join(store.getSkillsDir(), id);
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
            if (metadata.name && metadata.description) {
              skill.name = metadata.name;
              skill.description = metadata.description;
              skill.instructions = instructions;
              await store.saveSkill(skill);
            }
          } catch (e) {
            // YAML 解析失败也允许保存文件，但不更新元数据
          }
        }
      }

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

    return { status: 'success' };
  });

  fastify.delete('/api/workflows/:id', async (request) => {
    const { id } = request.params as any;
    await store.deleteWorkflow(id);
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
