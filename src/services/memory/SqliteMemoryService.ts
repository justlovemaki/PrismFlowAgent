import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { 
  MemoryEntry, 
  MemorySearchResult, 
  IMemoryService,
  MemoryCategorySummary,
  MemoryCategoryIndex
} from '../../types/memory.js';
import { typeid } from 'typeid-js';
import { LogService } from '../LogService.js';
import { PromptService } from '../PromptService.js';
import { MEMORY_WRITE_AGENT_ID } from '../agents/defaultAgentIds.js';
import { normalizeTags, getISODate } from '../../utils/helpers.js';

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
      tags: normalizeTags(options.tags),
      metadata: options.metadata || {},
      createdAt: Date.now()
    };

    if (!this.agentService) {
      await this.addToCategory('uncategorized', '未分类', '包含未经过推理分类的原始记忆片段', entry);
      return id;
    }

    try {
      const categories = await this.getCategories();
      const categoriesStr = categories.map(c => `[ID: ${c.id}] ${c.name}: ${c.description}`).join('\n');
      
      const classifierPrompt = PromptService.getInstance().getPrompt('memory_classifier', {
        categoriesStr: categoriesStr || '目前暂无分类。',
        recentEntriesStr: '暂无已存在记忆上下文。', // SQLite 模式下暂不查询上下文
        content
      });

      const result = await this.agentService.runAgent(MEMORY_WRITE_AGENT_ID, classifierPrompt, undefined, { silent: true, noTools: true, noSkills: true });
      
      let decision;
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        decision = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
      } catch (err) {
        LogService.warn(`Memory classifier output not a valid JSON, falling back to uncategorized. Output: ${result.content}`);
        decision = { categoryId: 'uncategorized', entrySummary: content.slice(0, 50) + '...' };
      }

      await this.addToCategory(
        decision.categoryId || 'uncategorized',
        decision.categoryName || decision.categoryId,
        decision.categoryDescription,
        entry,
        decision.entrySummary
      );

      LogService.info(`Memory saved and indexed in SQLite: ${id} -> [${decision.categoryId}]`);
    } catch (error: any) {
      LogService.error(`Memory classification failed in SQLite: ${error.message}`);
      await this.addToCategory('uncategorized', '未分类', '包含分类失败的记录', entry);
    }

    return id;
  }

  private async addToCategory(
    catId: string, 
    catName: string, 
    catDesc: string | undefined, 
    entry: any, 
    entrySummary?: string
  ) {
    let category = await this.store.getMemoryCategory(catId);
    if (!category) {
      category = {
        id: catId,
        name: catName,
        description: catDesc || `${catName} 相关记录`,
        entryCount: 0,
        updatedAt: Date.now()
      };
      await this.store.saveMemoryCategory(category);
    }

    // 更新 entry 中的 categoryId 并保存
    entry.categoryId = catId;
    if (entrySummary) {
      if (!entry.metadata) entry.metadata = {};
      entry.metadata.summary = entrySummary;
    }
    await this.store.saveMemory(entry);

    // 更新分类计数
    const memories = await this.store.listMemoriesByCategory(catId);
    category.entryCount = memories.length;
    category.updatedAt = Date.now();
    await this.store.saveMemoryCategory(category);
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
      return rawResults.map(r => `[${getISODate(new Date(r.createdAt))}] ${r.content}`).join('\n---\n');
    }

    // 3. 准备子 Agent 输入：将原始记录格式化为上下文
    const contextStr = rawResults.map((r, i) => {
      const date = getISODate(new Date(r.createdAt));
      return `记录 ${i+1} [日期: ${date}, 重要度: ${r.importance}, 标签: ${r.tags.join(',')}]:\n${r.content}`;
    }).join('\n\n');

    // 4. 定义子 Agent 的 Prompt
    const subAgentSystemPrompt = PromptService.getInstance().getPrompt('memory_query_subagent', { query });

    try {
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
      if (content === 'No response generated (AI returned empty content)') {
        return "";
      }
      return content;
    } catch (error: any) {
      LogService.error(`Memory Sub-Agent failed: ${error.message}`);
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
      if (content !== '内容未找到' && content !== '记忆内容未找到') {
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

    const result = await this.agentService.runAgent(MEMORY_WRITE_AGENT_ID, mergePrompt, undefined, { silent: false, noTools: true, noSkills: true });
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
    // 获取记忆详情
    const memories = await this.store.listAllMemories();
    const memory = memories.find(m => m.id === id);
    if (!memory) throw new Error("Memory entry not found");

    memory.content = content;
    await this.store.saveMemory(memory);
  }

  async getMemoryFullText(id: string): Promise<string> {
    const memories = await this.store.listAllMemories();
    const memory = memories.find(m => m.id === id);
    return memory?.content || '记忆内容未找到';
  }

  async getCategories(): Promise<MemoryCategorySummary[]> {
    return await this.store.listMemoryCategories();
  }

  async getCategoryDetails(id: string): Promise<MemoryCategoryIndex | null> {
    const category = await this.store.getMemoryCategory(id);
    if (!category) return null;

    const memories = await this.store.listMemoriesByCategory(id);
    return {
      id: category.id,
      name: category.name,
      description: category.description,
      entries: memories.map((m: any) => ({
        id: m.id,
        summary: m.metadata?.summary || m.content.slice(0, 100),
        importance: m.importance,
        tags: normalizeTags(m.tags),
        createdAt: m.createdAt
      })),
      updatedAt: category.updatedAt
    };
  }

  async deleteCategory(id: string): Promise<void> {
    const memories = await this.store.listMemoriesByCategory(id);
    for (const mem of memories) {
      await this.store.deleteMemory(mem.id);
    }
    await this.store.deleteMemoryCategory(id);
  }

  async updateCategory(id: string, name: string, description?: string): Promise<void> {
    const category = await this.store.getMemoryCategory(id);
    if (!category) throw new Error(`Category ${id} not found`);

    category.name = name;
    if (description !== undefined) category.description = description;
    category.updatedAt = Date.now();

    await this.store.saveMemoryCategory(category);
  }

  async addCategory(name: string, description: string = ''): Promise<string> {
    const categories = await this.store.listMemoryCategories();
    const existing = categories.find(c => c.name === name);
    if (existing) return existing.id;

    const id = typeid('mcat').toString();
    await this.store.saveMemoryCategory({
      id,
      name,
      description,
      entryCount: 0,
      updatedAt: Date.now()
    });
    return id;
  }

  async moveMemoryToCategory(memoryId: string, targetCategoryId: string): Promise<void> {
    const targetCategory = await this.store.getMemoryCategory(targetCategoryId);
    if (!targetCategory) throw new Error(`Target category ${targetCategoryId} not found`);

    const memory = await this.store.getMemory(memoryId);
    if (!memory) throw new Error(`Memory ${memoryId} not found`);

    const oldCategoryId = memory.categoryId;
    memory.categoryId = targetCategoryId;
    await this.store.saveMemory(memory);

    // 更新新旧分类计数
    if (oldCategoryId) {
      const oldCat = await this.store.getMemoryCategory(oldCategoryId);
      if (oldCat) {
        const memories = await this.store.listMemoriesByCategory(oldCategoryId);
        oldCat.entryCount = memories.length;
        oldCat.updatedAt = Date.now();
        await this.store.saveMemoryCategory(oldCat);
      }
    }

    const newMemories = await this.store.listMemoriesByCategory(targetCategoryId);
    targetCategory.entryCount = newMemories.length;
    targetCategory.updatedAt = Date.now();
    await this.store.saveMemoryCategory(targetCategory);
  }

  async mergeCategories(ids: string[], targetName: string, targetDescription?: string): Promise<string> {
    if (ids.length < 2) throw new Error("At least two categories are required for merge");

    const categories = await this.store.listMemoryCategories();
    const existing = categories.find(c => c.name === targetName);
    const targetId = typeid('mcat').toString();
    const allSourceIds = [...new Set([...ids, ...(existing ? [existing.id] : [])])];
    
    const targetCategory = {
      id: targetId,
      name: targetName,
      description: targetDescription || `${ids.length} 个主题合并后的记录`,
      entryCount: 0,
      updatedAt: Date.now()
    };
    await this.store.saveMemoryCategory(targetCategory);

    for (const id of allSourceIds) {
      if (id === targetId) continue;
      
      const memories = await this.store.listMemoriesByCategory(id);
      for (const mem of memories) {
        mem.categoryId = targetId;
        await this.store.saveMemory(mem);
      }
      await this.store.deleteMemoryCategory(id);
    }

    // 更新目标计数
    const targetMemories = await this.store.listMemoriesByCategory(targetId);
    targetCategory.entryCount = targetMemories.length;
    targetCategory.updatedAt = Date.now();
    await this.store.saveMemoryCategory(targetCategory);

    return targetId;
  }
}
