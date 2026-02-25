import { BaseAdapter } from '../../../base/BaseAdapter.js';
import type { UnifiedData } from '../../../../types/index.js';
import type { AdapterMetadata } from '../../../../registries/AdapterRegistry.js';
import { LogService } from '../../../../services/LogService.js';
import type { AgentService } from '../../../../services/agents/AgentService.js';
import type { WorkflowEngine } from '../../../../services/agents/WorkflowEngine.js';
import { PromptService } from '../../../../services/PromptService.js';
import { removeMarkdownCodeBlock } from '../../../../utils/helpers.js';

export class AISearchAdapter extends BaseAdapter {
  static metadata: AdapterMetadata = {
    type: 'AISearchAdapter',
    name: 'AI 搜索获取',
    description: '利用 AI Agent 或工作流进行搜索并获取结构化资讯',
    icon: 'manage_search',
    configFields: [
      { key: 'keyword', label: '搜索关键词', type: 'text', required: true, scope: 'item' },
      { key: 'executorId', label: '执行器 ID', type: 'executor', scope: 'item' }
    ]
  };

  configFields = AISearchAdapter.metadata.configFields;
  private agentService?: AgentService;
  private workflowEngine?: WorkflowEngine;
  public keyword: string = '';
  public executorId: string = 'default_summarizer';

  constructor(
    public readonly name: string = 'AI Search',
    public readonly category: string = 'aiSearch',
    private itemConfig: any = {}
  ) {
    super();
    this.keyword = itemConfig.keyword || '';
    this.executorId = itemConfig.executorId || itemConfig.agentId || 'default_summarizer';
    this.appendDateToId = true;
  }

  setAgentService(service: AgentService) {
    this.agentService = service;
  }

  setWorkflowEngine(engine: WorkflowEngine) {
    this.workflowEngine = engine;
  }

  async fetch(config: any): Promise<any[]> {
    const keyword = config.keyword || this.keyword;
    const executorId = config.executorId || this.executorId;

    if (!keyword) {
      LogService.error(`[AISearchAdapter: ${this.name}] Keyword is missing.`);
      return [];
    }

    const input = PromptService.getInstance().getPrompt('ai_search', { keyword });

    LogService.info(`[AISearchAdapter: ${this.name}] Requesting ${executorId} for task: ${keyword}`);
    
    try {
      let content = '';
      
      if (executorId.startsWith('workflow:')) {
        if (!this.workflowEngine) throw new Error('WorkflowEngine not initialized');
        const wfId = executorId.replace('workflow:', '');
        const result = await this.workflowEngine.runWorkflow(wfId, input);
        content = typeof result === 'string' ? result : JSON.stringify(result);
      } else {
        if (!this.agentService) throw new Error('AgentService not initialized');
        const agentId = executorId.startsWith('agent:') ? executorId.replace('agent:', '') : executorId;
        const response = await this.agentService.runAgent(agentId, input);
        content = response.content.trim();
      }

      // 尝试清理可能存在的 Markdown 标记
      const cleanedContent = removeMarkdownCodeBlock(content).trim();
      
      try {
        const data = JSON.parse(cleanedContent);
        if (Array.isArray(data)) {
          return data;
        }
        LogService.warn(`[AISearchAdapter: ${this.name}] Response is not an array: ${cleanedContent}`);
        return [];
      } catch (e) {
        LogService.error(`[AISearchAdapter: ${this.name}] Failed to parse response as JSON: ${cleanedContent}`);
        return [];
      }
    } catch (error: any) {
      LogService.error(`[AISearchAdapter: ${this.name}] Execution error: ${error.message}`);
      throw error;
    }
  }

  transform(rawData: any[], config?: any): UnifiedData[] {
    const now = new Date().toISOString();
    return rawData.map((item, index) => ({
      id: `ai-search-${this.name}-${index}-${Buffer.from(item.title || '').toString('hex').slice(0, 8)}`,
      title: item.title || '无标题',
      url: item.url || '#',
      description: item.description || '',
      published_date: item.published_date || now,
      ingestion_date: now.split('T')[0],
      source: item.author || this.name,
      category: this.category,
      author: item.author,
      metadata: {
        content_html: item.content || '',
        is_ai_generated: true,
        keyword: config?.keyword || this.keyword,
        executor_id: config?.executorId || this.executorId
      }
    }));
  }
}


