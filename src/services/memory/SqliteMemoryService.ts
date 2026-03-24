import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { MemoryEntry, MemorySearchResult, IMemoryService } from '../../types/memory.js';
import { typeid } from 'typeid-js';
import { LogService } from '../LogService.js';

export class SqliteMemoryService implements IMemoryService {
  private store: LocalStore;
  private agentService: AgentService | null;

  constructor(store: LocalStore, agentService: AgentService | null) {
    this.store = store;
    this.agentService = agentService;
  }

  /**
   * 保存一条记忆
   */
  async saveMemory(content: string, options: { 
    agentId?: string; 
    importance?: number; 
    tags?: string[];
    metadata?: any;
  } = {}): Promise<string> {
    const id = typeid('mem').toString();
    const entry: MemoryEntry = {
      id,
      agentId: options.agentId,
      content,
      importance: options.importance || 1,
      tags: options.tags || [],
      metadata: options.metadata || {},
      createdAt: Date.now()
    };

    await this.store.saveMemory(entry);
    LogService.info(`Memory saved: ${id} (${options.tags?.join(', ') || 'no tags'})`);
    return id;
  }

  /**
   * 搜索并摘要记忆（渐进式披露核心）
   */
  async queryMemory(query: string, options: {
    agentId?: string;
    limit?: number;
    minImportance?: number;
  } = {}): Promise<string> {
    // 1. 从 SQLite FTS5 获取原始匹配
    const rawResults: MemorySearchResult[] = await this.store.searchMemories(query, options);

    if (rawResults.length === 0) {
      return "未找到相关记忆。";
    }

    // 2. 如果没有 AgentService，直接返回原始拼接（降级方案）
    if (!this.agentService) {
      return rawResults.map(r => `[${new Date(r.createdAt).toLocaleDateString()}] ${r.content}`).join('\n---\n');
    }

    // 3. 准备子 Agent 输入：将原始记录格式化为上下文
    const contextStr = rawResults.map((r, i) => {
      const date = new Date(r.createdAt).toISOString().split('T')[0];
      return `记录 ${i+1} [日期: ${date}, 重要度: ${r.importance}, 标签: ${r.tags.join(',')}]:\n${r.content}`;
    }).join('\n\n');

    // 4. 定义子 Agent 的 Prompt
    const subAgentSystemPrompt = `你是一个记忆检索助手。你的任务是从提供的原始记忆片段中提取并重构出与用户查询最相关的核心信息。

规则：
1. **忠实原文**：仅基于提供的记录进行回答，不得凭空捏造。
2. **确保完整性**：在整合信息时，必须保留关键的技术细节、参数、特定偏好和决策背景。
3. **逻辑重组**：将分散的记录按时间或逻辑顺序重组。如果记录中有冲突，请清晰指出不同阶段的变化或演进。
4. **动态篇幅**：根据信息量决定长度，不设硬性字数限制，但应避免冗余。
5. **标识来源**：每个关键点应简要对应其相关的记录标签或日期。

用户查询词：${query}`;

    // 5. 启动影子 Agent（临时创建）
    // 注意：这里我们使用 AgentService 现有的 runAgent 能力，但我们需要一个临时的定义
    // 为了简单起见，我们可以直接调用底层的 provider 逻辑，或者创建一个临时的 Agent 定义
    try {
      // 临时保存一个用于记忆总结的 Agent 定义（如果不存在）
      const tempAgentId = 'memory_gatekeeper';
      const existing = await this.store.getAgent(tempAgentId);
      if (!existing) {
        await this.store.saveAgent({
          id: tempAgentId,
          name: '记忆门卫',
          description: '内部工具，用于总结检索到的记忆片段',
          systemPrompt: subAgentSystemPrompt,
          providerId: '', // 将使用默认 provider
          model: '',
          toolIds: [],
          skillIds: []
        });
      }

      const result = await this.agentService.runAgent(tempAgentId, `原始记录如下：\n\n${contextStr}\n\n请总结与"${query}"相关的记忆内容。`, undefined, { silent: true });
      const content = result.content;
      // 避免返回 AgentService 的默认错误内容
      if (content === 'No response generated (AI returned empty content)') {
        return "";
      }
      return content;
    } catch (error: any) {
      LogService.error(`Memory Sub-Agent failed: ${error.message}`);
      // 报错时降级回原始数据拼接
      return "记忆检索子 Agent 运行失败，以下为原始数据片段：\n" + rawResults.slice(0, 3).map(r => r.content).join('\n---\n');
    }
  }

  async deleteMemory(id: string): Promise<void> {
    await this.store.deleteMemory(id);
  }

  async getMemoryFullText(id: string): Promise<string> {
    const memories = await this.store.searchMemories('', { limit: 1000 });
    const memory = memories.find(m => m.id === id);
    return memory?.content || '内容未找到';
  }

  async getCategories(): Promise<any[]> {
    return [{
      id: 'default',
      name: '全部记忆',
      description: 'SQLite 模式下的全量记忆记录',
      entryCount: 0,
      lastUpdatedAt: Date.now()
    }];
  }

  async getCategoryDetails(id: string): Promise<any> {
    const memories = await this.store.searchMemories('', { limit: 100 });
    return {
      id: 'default',
      name: '全部记忆',
      description: 'SQLite 模式下的全量记忆记录',
      entries: memories.map(m => ({
        id: m.id,
        summary: m.content.slice(0, 100),
        importance: m.importance,
        tags: m.tags,
        createdAt: m.createdAt
      })),
      updatedAt: Date.now()
    };
  }

  async deleteCategory(id: string): Promise<void> {
    const memories = await this.store.searchMemories('', { limit: 1000 });
    for (const mem of memories) {
      await this.store.deleteMemory(mem.id);
    }
  }
}
