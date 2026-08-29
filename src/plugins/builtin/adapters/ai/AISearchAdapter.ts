import { BaseAdapter } from '../../../base/BaseAdapter.js';
import type { UnifiedData } from '../../../../types/index.js';
import type { AdapterMetadata } from '../../../../registries/AdapterRegistry.js';
import { LogService } from '../../../../services/LogService.js';
import type { AgentService } from '../../../../services/agents/AgentService.js';
import type { WorkflowEngine } from '../../../../services/agents/WorkflowEngine.js';
import { PromptService } from '../../../../services/PromptService.js';
import {
  normalizeAISearchItems,
  parseAISearchItems,
  type AISearchRawItem,
} from '../../../../core/sources/AISearchSource.js';

interface AISearchConfig {
  keyword?: string;
  executorId?: string;
  agentId?: string;
}

export class AISearchAdapter extends BaseAdapter {
  static metadata: AdapterMetadata = {
    type: 'AISearchAdapter',
    name: 'AI 搜索获取',
    description: '利用 AI Agent 或工作流进行搜索并获取结构化资讯',
    icon: 'manage_search',
    configFields: [
      { key: 'keyword', label: '搜索关键词', type: 'text', required: true, scope: 'item' },
      { key: 'executorId', label: '执行器 ID', type: 'executor', scope: 'item' },
    ],
  };

  configFields = AISearchAdapter.metadata.configFields;
  private agentService?: AgentService;
  private workflowEngine?: WorkflowEngine;
  public keyword = '';
  public executorId = 'default_summarizer';

  constructor(
    public readonly name: string = 'AI Search',
    public readonly category: string = 'aiSearch',
    itemConfig: AISearchConfig = {},
  ) {
    super();
    this.keyword = itemConfig.keyword || '';
    this.executorId = itemConfig.executorId || itemConfig.agentId || 'default_summarizer';
    this.appendDateToId = true;
  }

  setAgentService(service: AgentService): void {
    this.agentService = service;
  }

  setWorkflowEngine(engine: WorkflowEngine): void {
    this.workflowEngine = engine;
  }

  async fetch(config: AISearchConfig): Promise<AISearchRawItem[]> {
    const keyword = config.keyword || this.keyword;
    const executorId = config.executorId || this.executorId;
    if (!keyword) {
      LogService.error(`[AISearchAdapter: ${this.name}] Keyword is missing.`);
      return [];
    }

    const input = PromptService.getInstance().getPrompt('ai_search', { keyword });
    LogService.info(`[AISearchAdapter: ${this.name}] Requesting ${executorId} for task: ${keyword}`);

    let content: string;
    if (executorId.startsWith('workflow:')) {
      if (!this.workflowEngine) throw new Error('WorkflowEngine not initialized');
      const workflowId = executorId.replace('workflow:', '');
      const result = await this.workflowEngine.runWorkflow(workflowId, input);
      content = typeof result === 'string' ? result : JSON.stringify(result);
    } else {
      if (!this.agentService) throw new Error('AgentService not initialized');
      const agentId = executorId.startsWith('agent:') ? executorId.replace('agent:', '') : executorId;
      const response = await this.agentService.runAgent(agentId, input);
      content = response.content.trim();
    }

    const items = parseAISearchItems(content);
    if (items.length === 0) {
      LogService.warn(`[AISearchAdapter: ${this.name}] Executor returned no parseable search items.`);
    }
    return items;
  }

  transform(rawData: AISearchRawItem[], config: AISearchConfig = {}): UnifiedData[] {
    return normalizeAISearchItems(rawData, {
      sourceName: this.name,
      category: this.category,
      keyword: config.keyword || this.keyword,
      executorId: config.executorId || this.executorId,
    });
  }
}
