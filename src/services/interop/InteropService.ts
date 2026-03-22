import crypto from 'crypto';
import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { SkillService } from '../agents/SkillService.js';
import { WorkflowEngine } from '../agents/WorkflowEngine.js';
import { ToolRegistry } from '../../registries/ToolRegistry.js';
import { LogService } from '../LogService.js';
import { DiscoveryResponse, ExecuteRequest } from '../../types/interop.js';
import { ToolDefinition } from '../../types/agent.js';

export class InteropService {
  constructor(
    private store: LocalStore,
    private agentService: AgentService | null,
    private skillService: SkillService,
    private workflowEngine: WorkflowEngine | null,
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
        tools: tools.map(t => ({ id: t.id, name: t.name, description: t.description }))
      },
      endpoints: {
        context: '/api/ai/v1/context',
        tools: '/api/ai/v1/tools',
        skills: '/api/ai/v1/skills',
        execute: '/api/ai/v1/execute'
      }
    };
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
    
    let md = `# PrismFlowAgent (流光) 交互指南\n\n`;
    md += `你正在与 PrismFlowAgent 系统直接交互。这是一个跨平台内容处理与 AI 自动化系统。\n\n`;
    
    md += `## 核心能力\n`;
    md += `- **Agents**: 针对特定任务优化的智能体。\n`;
    md += `- **Workflows**: 预定义的多步骤处理流程。\n`;
    md += `- **Skills**: 系统已学习的专业技能，通常包含特定领域的指令。\n`;
    md += `- **Tools**: 可直接调用的底层工具，包括数据采集、存储、发布等。\n\n`;

    md += `## 如何交互\n`;
    md += `你可以通过 \`/api/ai/v1/execute\` 接口触发本系统内的任何能力。\n\n`;
    
    md += `### 调用示例 (JSON Body)\n`;
    md += `\`\`\`json\n`;
    md += `{\n`;
    md += `  "action": "agent",\n`;
    md += `  "id": "agent-id",\n`;
    md += `  "input": "用户的原始输入内容",\n`;
    md += `  "stream": true\n`;
    md += `}\n`;
    md += `\`\`\`\n\n`;

    md += `## 当前可用列表\n`;
    
    md += `### Agents\n`;
    discovery.capabilities.agents.forEach(a => {
      md += `- **${a.id}**: ${a.name} - ${a.description}\n`;
    });

    md += `\n### Workflows\n`;
    discovery.capabilities.workflows.forEach(w => {
      md += `- **${w.id}**: ${w.name} - ${w.description}\n`;
    });

    md += `\n### Tools (主要功能)\n`;
    discovery.capabilities.tools.forEach(t => {
      md += `- **${t.id}**: ${t.description}\n`;
    });

    md += `\n请根据以上信息决定你的下一步行动。你可以要求我执行特定的 Agent，或直接调用 Tool 进行数据操作。`;

    return md;
  }

  /**
   * 统一执行网关
   */
  async execute(req: ExecuteRequest) {
    const { action, id, input, date, stream } = req;
    LogService.info(`Interop Execute: ${action}:${id}`);

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
          return this.agentService.streamAgent(id, input, date);
        }
        return await this.agentService.runAgent(id, input, date);

      case 'workflow':
        if (!this.workflowEngine) throw new Error('Workflow Engine not initialized');
        const workflowResult = await this.workflowEngine.runWorkflow(id, input, date);
        return {
          content: typeof workflowResult === 'string' ? workflowResult : JSON.stringify(workflowResult),
          data: typeof workflowResult === 'object' ? workflowResult : { result: workflowResult }
        };

      default:
        throw new Error(`Unsupported action type: ${action}`);
    }
  }
}
