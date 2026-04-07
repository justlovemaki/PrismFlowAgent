import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { MemoryEntry, MemorySearchResult, IMemoryService } from '../../types/memory.js';
import { typeid } from 'typeid-js';
import { LogService } from '../LogService.js';
import { PromptService } from '../PromptService.js';

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
    const subAgentSystemPrompt = PromptService.getInstance().getPrompt('memory_query_subagent', { query });

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

      const summaryPrompt = PromptService.getInstance().getPrompt('memory_query_summarization', {
        contextStr,
        query
      });

      const result = await this.agentService.runAgent(tempAgentId, summaryPrompt, undefined, { silent: true });
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

  async mergeMemories(ids: string[], options: { 
    agentId?: string;
    targetCategoryId?: string;
  } = {}): Promise<string> {
    if (!this.agentService) {
      throw new Error("AgentService 不可用，无法进行记忆合并推理。");
    }

    if (ids.length < 2) {
      throw new Error("合并至少需要两条记忆。");
    }

    LogService.info(`Merging ${ids.length} memories in SQLite mode...`);

    // 1. 获取所有记忆全文
    const contents: string[] = [];
    for (const id of ids) {
      const content = await this.getMemoryFullText(id);
      if (content !== '内容未找到') {
        contents.push(`[记忆 ID: ${id}]\n${content}`);
      }
    }

    if (contents.length === 0) {
      throw new Error("未找到指定的记忆内容。");
    }

    // 2. 调用 AI 进行合并
    const mergePrompt = PromptService.getInstance().getPrompt('memory_merge', { 
      contents: contents.join('\n\n---\n\n') 
    });

    const result = await this.agentService.runAgent('memory_assistant', mergePrompt, undefined, { silent: false, noTools: true, noSkills: true });
    const mergedContent = result.content;

    if (!mergedContent || mergedContent === 'No response generated (AI returned empty content)') {
      throw new Error("AI 合并失败，返回内容为空。");
    }

    // 3. 保存新记忆
    const newId = await this.saveMemory(mergedContent, {
      agentId: options.agentId,
      importance: 3,
      tags: ['merged'],
      metadata: { mergedFrom: ids }
    });

    // 4. 删除旧记忆
    for (const id of ids) {
      await this.deleteMemory(id);
    }

    LogService.info(`Memories merged successfully in SQLite. New ID: ${newId}`);
    return newId;
  }

  async deleteMemory(id: string): Promise<void> {
    await this.store.deleteMemory(id);
  }

  async updateMemoryContent(id: string, content: string): Promise<void> {
    const memories = await this.store.searchMemories('', { limit: 1000 });
    const memory = memories.find(m => m.id === id);
    if (!memory) throw new Error("Memory entry not found");

    memory.content = content;
    await this.store.saveMemory(memory);
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

  async updateCategory(id: string, name: string, description?: string): Promise<void> {
    LogService.warn("Update category not supported in SQLite mode.");
  }

  async mergeCategories(ids: string[], targetName: string, targetDescription?: string): Promise<string> {
    LogService.warn("Merge categories not supported in SQLite mode.");
    return "default";
  }
}
