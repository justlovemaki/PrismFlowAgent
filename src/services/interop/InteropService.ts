import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { SkillService } from '../agents/SkillService.js';
import { WorkflowEngine } from '../agents/WorkflowEngine.js';
import { ToolRegistry } from '../../registries/ToolRegistry.js';
import { LogService } from '../LogService.js';
import { DiscoveryResponse, ExecuteRequest } from '../../types/interop.js';
import { ToolDefinition } from '../../types/agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class InteropService {
  constructor(
    private store: LocalStore,
    private agentService: AgentService | null,
    private skillService: SkillService,
    private workflowEngine: WorkflowEngine | null,
    private schedulerService: any,
    private settings: any
  ) {}

  /**
   * 生成新的 API Key (基础方法)
   */
  async createApiKey(apiKeyData: { 
    name: string; 
    sourceFingerprint?: string; 
    status?: string;
  }): Promise<{ id: string; key: string; verificationToken?: string }> {
    const id = crypto.randomUUID();
    const rawKey = `sk_pf_${crypto.randomBytes(24).toString('hex')}`;
    const prefix = rawKey.substring(0, 8);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const verificationToken = apiKeyData.status === 'pending' ? crypto.randomBytes(16).toString('hex') : undefined;

    await this.store.saveApiKey({
      id,
      name: apiKeyData.name,
      keyHash,
      prefix,
      sourceFingerprint: apiKeyData.sourceFingerprint,
      verificationToken,
      status: apiKeyData.status || 'active'
    });

    return { id, key: rawKey, verificationToken };
  }

  /**
   * AI 自动注册流程
   */
  async registerPendingKey(name: string, fingerprint: string): Promise<{ id: string; key: string; verificationUrl: string }> {
    // 检查指纹是否已存在
    const existing = await this.store.getApiKeyByFingerprint(fingerprint);
    if (existing) {
      if (existing.status === 'pending') {
        throw new Error('A registration request from this source is already pending approval.');
      }
      throw new Error('This source is already registered.');
    }

    const { id, key, verificationToken } = await this.createApiKey({ 
      name: name || `AI-${fingerprint.substring(0, 6)}`, 
      sourceFingerprint: fingerprint,
      status: 'pending'
    });

    // 构造验证 URL
    // 注意：这里的域名应该根据实际部署环境调整，初版使用相对路径或占位符
    const verificationUrl = `/api/ai/v1/verify/${verificationToken}`;

    return { id, key, verificationUrl };
  }

  /**
   * 人工验证批准
   */
  async approveKey(token: string): Promise<boolean> {
    const record = await this.store.getApiKeyByVerificationToken(token);
    if (!record) return false;

    await this.store.updateApiKeyStatus(record.id, 'active');
    LogService.info(`API Key ${record.id} (${record.name}) approved via verification page.`);
    return true;
  }

  /**
   * 更新 API Key 属性
   */
  async updateApiKey(id: string, data: { name?: string; status?: string }): Promise<void> {
    if (data.status) {
      await this.store.updateApiKeyStatus(id, data.status);
    }
    
    if (data.name) {
      // 需要先获取原记录，因为 store.saveApiKey 是 INSERT OR REPLACE
      const keys = await this.store.listApiKeys();
      const existing = keys.find(k => k.id === id);
      if (existing) {
        // 由于 listApiKeys 不返回 keyHash，我们需要单独处理名称更新
        // 在 LocalStore 中增加专门的更新方法更安全
        await (this.store as any).updateApiKeyName(id, data.name);
      }
    }
  }

  /**
   * 验证 API Key 及其状态
   */
  async verifyApiKey(rawKey: string): Promise<boolean> {
    if (!rawKey || !rawKey.startsWith('sk_pf_')) return false;

    const prefix = rawKey.substring(0, 8);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    
    // 我们需要直接从数据库查出记录以检查状态
    const candidates = await this.store.getApiKeysByPrefix(prefix);
    const match = candidates.find(c => c.key_hash === keyHash);

    if (match && match.status === 'active') {
      await this.store.updateApiKeyLastUsed(match.id);
      return true;
    }

    return false;
  }

  /**
   * 获取系统能力发现数据
   */
  async getDiscovery(): Promise<DiscoveryResponse> {
    const agents = await this.store.listAgents();
    const workflows = await this.store.listWorkflows();
    const skills = this.skillService.listSkills();
    const tools = ToolRegistry.getInstance().getAllTools();
    const schedules = await this.store.listSchedules();

    return {
      system: {
        name: 'PrismFlowAgent',
        version: '1.0.0',
        description: '流光: 跨平台内容聚合与 AI 任务调度中心'
      },
      capabilities: {
        agents: agents.filter(a => !a.isHidden).map(a => ({ id: a.id, name: a.name, description: a.description })),
        workflows: workflows.map(w => ({ id: w.id, name: w.name, description: w.description })),
        skills: skills.map(s => ({ id: s.id, name: s.name, description: s.description })),
        tools: tools.map(t => ({ id: t.id, name: t.name, description: t.description })),
        schedules: schedules.map(s => ({ id: s.id, name: s.name, type: s.type, enabled: s.enabled }))
      },
      endpoints: {
        context: '/api/ai/v1/context',
        tools: '/api/ai/v1/tools',
        skills: '/api/ai/v1/skills',
        settings: '/api/ai/v1/settings',
        schedules: '/api/ai/v1/schedules',
        agents: '/api/ai/v1/agents',
        workflows: '/api/ai/v1/workflows',
        execute: '/api/ai/v1/execute'
      }
    };
  }

  /**
   * 管理智能体 (获取所有)
   */
  async getAgents(): Promise<any[]> {
    return (await this.store.listAgents()).filter(a => !a.isHidden);
  }

  /**
   * 保存或更新智能体
   */
  async saveAgent(agent: any): Promise<void> {
    if (!agent.id || !agent.name || !agent.systemPrompt) {
      throw new Error('Missing required fields: id, name, systemPrompt');
    }
    await this.store.saveAgent(agent);
  }

  /**
   * 删除智能体
   */
  async deleteAgent(id: string): Promise<void> {
    await this.store.deleteAgent(id);
  }

  /**
   * 管理工作流 (获取所有)
   */
  async getWorkflows(): Promise<any[]> {
    return await this.store.listWorkflows();
  }

  /**
   * 保存或更新工作流
   */
  async saveWorkflow(workflow: any): Promise<void> {
    if (!workflow.id || !workflow.name || !Array.isArray(workflow.nodes)) {
      throw new Error('Missing required fields: id, name, nodes');
    }
    await this.store.saveWorkflow(workflow);
  }

  /**
   * 删除工作流
   */
  async deleteWorkflow(id: string): Promise<void> {
    await this.store.deleteWorkflow(id);
  }

  /**
   * 管理定时任务 (获取所有任务)
   */
  async getSchedules(): Promise<any[]> {
    return await this.store.listSchedules();
  }

  /**
   * 保存或更新定时任务
   */
  async saveSchedule(schedule: any): Promise<void> {
    if (!schedule.id || !schedule.type || !schedule.targetId) {
      throw new Error('Missing required fields: id, type, targetId');
    }
    await this.store.saveSchedule(schedule);
    
    if (this.schedulerService) {
      if (schedule.enabled) {
        this.schedulerService.startSchedule(schedule);
      } else {
        this.schedulerService.stopSchedule(schedule.id);
      }
    }
  }

  /**
   * 删除定时任务
   */
  async deleteSchedule(id: string): Promise<void> {
    if (this.schedulerService) {
      this.schedulerService.stopSchedule(id);
    }
    await this.store.deleteSchedule(id);
  }

  /**
   * 获取并脱敏系统设置
   */
  async getSettings(): Promise<any> {
    const settings = { ...this.settings };
    
    // 脱敏敏感字段
    delete settings.SYSTEM_PASSWORD;
    delete settings.SKILL_STORE_API_KEY;
    delete settings.GLOBAL_GITHUB_TOKEN;
    delete settings.ARK_API_KEY;

    // 发布器和存储的配置，脱敏其中的敏感字段
    const maskSecrets = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(maskSecrets);
      
      const newObj: any = {};
      const sensitiveKeys = ['apiKey', 'token', 'secret', 'password', 'key', 'foloCookie'];
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveKeys.some(s => key.toLowerCase().includes(s.toLowerCase()))) {
          if (typeof value === 'string' && value.length > 8) {
            newObj[key] = `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
          } else {
            newObj[key] = '********';
          }
        } else if (typeof value === 'object') {
          newObj[key] = maskSecrets(value);
        } else {
          newObj[key] = value;
        }
      }
      return newObj;
    };

    if (settings.AI_PROVIDERS) {
      settings.AI_PROVIDERS = maskSecrets(settings.AI_PROVIDERS);
    }

    if (settings.PUBLISHERS) {
      settings.PUBLISHERS = maskSecrets(settings.PUBLISHERS);
    }

    if (settings.STORAGES) {
      settings.STORAGES = maskSecrets(settings.STORAGES);
    }

    if (settings.ADAPTERS) {
      settings.ADAPTERS = maskSecrets(settings.ADAPTERS);
    }

    return settings;
  }

  /**
   * 更新系统设置
   */
  async updateSettings(newSettings: any): Promise<void> {
    // 使用当前生效的完整设置作为基准，确保合并时不会因为 DB 中缺失某些默认值而导致脱敏回写失败
    const currentSettings = this.settings;
    
    // 允许更新的字段白名单
    const allowedKeys = [
      'ACTIVE_AI_PROVIDER_ID', 
      'AI_PROVIDERS',
      'ADAPTERS',
      'PUBLISHERS',
      'STORAGES',
      'CATEGORIES',
      'API_PROXY', 
      'IMAGE_PROXY', 
      'CLOSED_PLUGINS', 
      'SELECTION_FETCH_DAYS',
      'SELECTION_QUERY_FIELD',
      'MEMORY_SYSTEM_TYPE',
      'KNOWLEDGE_SYSTEM_TYPE',
      'SKILL_STORE_API_KEY',
      'GLOBAL_GITHUB_TOKEN'
    ];

    const updatedSettings = { ...currentSettings };
    
    // 递归合并对象，同时跳过脱敏后的 Key 回写
    const mergeConfigs = (oldVal: any, newVal: any): any => {
      if (newVal === undefined) return oldVal;
      if (newVal === null) return null;
      
      // 处理数组
      if (Array.isArray(newVal)) {
        // 如果数组元素有 ID，尝试按 ID 合并，且不丢失未在 newVal 中提及的旧元素（增量合并）
        if (newVal.length > 0 && newVal[0]?.id && Array.isArray(oldVal)) {
          const result = [...oldVal];
          newVal.forEach(newItem => {
            const index = result.findIndex(oi => oi.id === newItem.id);
            if (index >= 0) {
              result[index] = mergeConfigs(result[index], newItem);
            } else {
              result.push(newItem);
            }
          });
          return result;
        }
        return newVal; // 默认覆盖数组 (针对非 ID 数组，如 models)
      }

      // 处理普通对象
      if (typeof newVal === 'object') {
        const result = oldVal && typeof oldVal === 'object' ? { ...oldVal } : {};
        const sensitiveKeys = ['apiKey', 'token', 'secret', 'password', 'key', 'foloCookie'];
        
        for (const [key, val] of Object.entries(newVal)) {
          // 如果是敏感字段且带有脱敏占位符，保留原值
          if (sensitiveKeys.some(s => key.toLowerCase().includes(s.toLowerCase())) && 
              typeof val === 'string' && (val.includes('...') || val === '********')) {
            continue;
          }
          result[key] = mergeConfigs(result[key], val);
        }
        return result;
      }

      return newVal;
    };

    for (const key of allowedKeys) {
      if (newSettings[key] !== undefined) {
        updatedSettings[key] = mergeConfigs(updatedSettings[key], newSettings[key]);
      }
    }

    await this.store.put('system_settings', updatedSettings);
    LogService.info('System settings updated via Interop API (Full Deep Config)');
  }

  /**
   * 将系统内部工具定义转换为 OpenAI 兼容的 Tools 格式
   */
  async getToolsAsOpenAIFormat(): Promise<any[]> {
    const tools = ToolRegistry.getInstance().getAllTools();
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.id,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} }
      }
    }));
  }

  /**
   * 生成专供给外部 AI 阅读的“引导手册”
   */
  async getSystemContextMarkdown(): Promise<string> {
    const discovery = await this.getDiscovery();
    const templatePath = path.join(__dirname, 'INTEROP_GUIDE.md');
    
    let md = '';
    try {
      md = await fs.readFile(templatePath, 'utf-8');
    } catch (error: any) {
      LogService.error(`Failed to read interop guide template: ${error.message}`);
      return '# Error\n\nFailed to load the interop guide.';
    }

    // 动态替换 Agents 列表
    const agentsList = discovery.capabilities.agents
      .map(a => `- **${a.id}**: ${a.name} - ${a.description}`)
      .join('\n');
    md = md.replace('{{AGENTS_LIST}}', agentsList || '*暂无可用智能体*');

    // 动态替换 Workflows 列表
    const workflowsList = discovery.capabilities.workflows
      .map(w => `- **${w.id}**: ${w.name} - ${w.description}`)
      .join('\n');
    md = md.replace('{{WORKFLOWS_LIST}}', workflowsList || '*暂无可用工作流*');

    // 动态替换 Skills 列表
    const skillsList = discovery.capabilities.skills
      .map(s => `- **${s.id}**: ${s.name} - ${s.description}`)
      .join('\n');
    md = md.replace('{{SKILLS_LIST}}', skillsList || '*暂无可用技能*');

    // 动态替换 Schedules 列表
    const schedulesList = discovery.capabilities.schedules
      .map(s => `- **${s.id}**: ${s.name} (${s.type}) - ${s.enabled ? '已开启' : '已禁用'}`)
      .join('\n');
    md = md.replace('{{SCHEDULES_LIST}}', schedulesList || '*暂无可用定时任务*');

    // 动态替换 Tools 列表
    const toolsList = discovery.capabilities.tools
      .map(t => `- **${t.id}**: ${t.description}`)
      .join('\n');
    md = md.replace('{{TOOLS_LIST}}', toolsList || '*暂无可用工具*');

    return md;
  }


  /**
   * 统一执行网关
   */
  async execute(req: ExecuteRequest) {
    const { action, id, input, date, stream } = req;
    LogService.info(`Interop Execute: ${action}:${id}`);

    // Ensure input is a string for agent actions
    const agentInput = typeof input === 'string' ? input : (JSON.stringify(input) ?? '');

    switch (action) {
      case 'tool':
        const closedPlugins = this.settings.CLOSED_PLUGINS || [];
        if (closedPlugins.includes(id)) {
          throw new Error(`Tool ${id} is disabled`);
        }
        const result = await ToolRegistry.getInstance().callTool(id, input);
        return { success: true, data: result };

      case 'agent':
        if (!this.agentService) throw new Error('Agent Service not initialized');
        if (stream) {
          return this.agentService.streamAgent(id, agentInput, date);
        }
        return await this.agentService.runAgent(id, agentInput, date);

      case 'workflow':
        if (!this.workflowEngine) throw new Error('Workflow Engine not initialized');
        const workflowResult = await this.workflowEngine.runWorkflow(id, input, date);
        return {
          content: typeof workflowResult === 'string' ? workflowResult : JSON.stringify(workflowResult),
          data: typeof workflowResult === 'object' ? workflowResult : { result: workflowResult }
        };

      case 'schedule_run':
        if (!this.schedulerService) throw new Error('Scheduler Service not available');
        await this.schedulerService.runNow(id);
        return { success: true, message: `Schedule ${id} triggered` };

      default:
        throw new Error(`Unsupported action type: ${action}`);
    }
  }
}
