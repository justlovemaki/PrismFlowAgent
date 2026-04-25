import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { 
  MemoryEntry, 
  MemoryRootIndex, 
  MemoryCategoryIndex, 
  MemoryEntrySummary,
  MemoryCategorySummary,
  IMemoryService
} from '../../types/memory.js';
import { typeid } from 'typeid-js';
import { LogService } from '../LogService.js';
import { PromptService } from '../PromptService.js';
import { MEMORY_READ_AGENT_ID, MEMORY_WRITE_AGENT_ID } from '../agents/defaultAgentIds.js';
import { normalizeTags, getISODate } from '../../utils/helpers.js';

export class HierarchicalMemoryService implements IMemoryService {

  private store: LocalStore;
  private agentService: AgentService | null;
  private memoryDir: string;
  private categoryDir: string;
  private entryDir: string;
  private rootPath: string;

  constructor(store: LocalStore, agentService: AgentService | null) {
    this.store = store;
    this.agentService = agentService;
    
    // 初始化存储目录
    const dataDir = path.dirname(store.getDbPath());
    this.memoryDir = path.join(dataDir, 'memory');
    this.categoryDir = path.join(this.memoryDir, 'categories');
    this.entryDir = path.join(this.memoryDir, 'entries');
    this.rootPath = path.join(this.memoryDir, 'root.json');

    this.initDirs();
  }

  private initDirs() {
    [this.memoryDir, this.categoryDir, this.entryDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    if (!fs.existsSync(this.rootPath)) {
      const initialRoot: MemoryRootIndex = {
        version: '1.0',
        categories: [],
        updatedAt: Date.now()
      };
      fs.writeFileSync(this.rootPath, JSON.stringify(initialRoot, null, 2));
    }
  }

  private loadRoot(): MemoryRootIndex {
    return JSON.parse(fs.readFileSync(this.rootPath, 'utf8'));
  }

  private saveRoot(root: MemoryRootIndex) {
    fs.writeFileSync(this.rootPath, JSON.stringify(root, null, 2));
  }

  private loadCategory(id: string): MemoryCategoryIndex | null {
    const filePath = path.join(this.categoryDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const category: MemoryCategoryIndex = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      // 强制规范化所有条目的标签
      if (category.entries) {
        category.entries.forEach(entry => {
          entry.tags = normalizeTags(entry.tags);
        });
      }
      return category;
    } catch (err) {
      LogService.error(`Failed to load category ${id}: ${err}`);
      return null;
    }
  }

  private saveCategory(category: MemoryCategoryIndex) {
    const filePath = path.join(this.categoryDir, `${category.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(category, null, 2));
  }

  async saveMemory(content: string, options: {
    agentId?: string;
    importance?: number;
    tags?: string[];
    metadata?: any;
  } = {}): Promise<string> {
    const normalizedContent = this.normalizeMemoryContent(content);
    const contentHash = crypto.createHash('sha256').update(normalizedContent).digest('hex');
    const existingId = this.findDuplicate(contentHash);
    if (existingId) {
      LogService.info(`Memory content already exists: ${existingId}, skipping save.`);
      return existingId;
    }

    const id = typeid('mem').toString();
    const entry: MemoryEntry = {
      id,
      agentId: options.agentId,
      content,
      importance: options.importance || 1,
      tags: normalizeTags(options.tags),
      metadata: { ...(options.metadata || {}), hash: contentHash },
      createdAt: Date.now()
    };

    const entryPath = path.join(this.entryDir, `${id}.md`);
    fs.writeFileSync(entryPath, entry.content);

    if (!this.agentService) {
      await this.addToCategory('uncategorized', '未分类', '包含未经过推理分类的原始记忆片段', entry);
      return id;
    }

    try {
      const root = this.loadRoot();
      const categoriesStr = root.categories.map(c => `[ID: ${c.id}] ${c.name}: ${c.description}`).join('\n');
      const recentEntries = this.getRecentEntrySummaries(5);
      const recentEntriesStr = recentEntries.length > 0
        ? recentEntries.map((item, index) => `${index + 1}. [ID: ${item.id}] [分类: ${item.categoryName}] [日期: ${getISODate(new Date(item.createdAt))}]\n摘要: ${item.summary}`).join('\n\n')
        : '暂无已存在记忆。';
      
      const classifierPrompt = PromptService.getInstance().getPrompt('memory_classifier', {
        categoriesStr: categoriesStr || '目前暂无分类。',
        recentEntriesStr,
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

      LogService.info(`Memory saved and indexed: ${id} -> [${decision.categoryId}]`);
    } catch (error: any) {
      LogService.error(`Memory classification failed: ${error.message}`);
      await this.addToCategory('uncategorized', '未分类', '包含分类失败的记录', entry);
    }

    return id;
  }

  private normalizeMemoryContent(content: string): string {
    return content
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();
  }

  private getDayKey(timestamp: number): string {
    return getISODate(new Date(timestamp));
  }

  private isSameDay(timestamp: number, targetDayKey: string): boolean {
    return this.getDayKey(timestamp) === targetDayKey;
  }

  private findDuplicate(hash: string): string | null {
    try {
      const root = this.loadRoot();
      for (const catSummary of root.categories) {
        const category = this.loadCategory(catSummary.id);
        if (category) {
          const duplicate = category.entries.find(e => e.hash === hash);
          if (duplicate) return duplicate.id;
        }
      }
    } catch (err: any) {
      LogService.error(`Failed to check duplicates: ${err.message}`);
    }
    return null;
  }

  private getRecentEntrySummaries(limit: number): Array<MemoryEntrySummary & { categoryName: string }> {
    try {
      const root = this.loadRoot();
      return root.categories
        .flatMap(catSummary => {
          const category = this.loadCategory(catSummary.id);
          if (!category) {
            return [];
          }

          return category.entries.map(entry => ({
            ...entry,
            categoryName: category.name
          }));
        })
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    } catch (err: any) {
      LogService.error(`Failed to load recent memories: ${err.message}`);
      return [];
    }
  }

  private async addToCategory(
    catId: string, 
    catName: string, 
    catDesc: string | undefined, 
    entry: MemoryEntry, 
    entrySummary?: string
  ) {
    let category = this.loadCategory(catId);
    const root = this.loadRoot();

    if (!category) {
      category = {
        id: catId,
        name: catName,
        description: catDesc || `${catName} 相关记录`,
        entries: [],
        updatedAt: Date.now()
      };
      
      root.categories.push({
        id: catId,
        name: category.name,
        description: category.description,
        entryCount: 0,
        lastUpdatedAt: Date.now()
      });
    }

    if (!category.entries.find(e => e.id === entry.id)) {
      category.entries.push({
        id: entry.id,
        summary: entrySummary || entry.content.slice(0, 100) + '...',
        importance: entry.importance,
        tags: normalizeTags(entry.tags),
        hash: (entry.metadata as any)?.hash,
        createdAt: entry.createdAt
      });
    }
    
    category.updatedAt = Date.now();
    this.saveCategory(category);

    const rootCat = root.categories.find(c => c.id === catId);
    if (rootCat) {
      rootCat.entryCount = category.entries.length;
      rootCat.lastUpdatedAt = category.updatedAt;
    }
    root.updatedAt = Date.now();
    this.saveRoot(root);
  }

  async deleteCategory(id: string): Promise<void> {
    const category = this.loadCategory(id);
    if (!category) return;

    // Delete all entry files
    for (const entrySum of category.entries) {
      const entryPath = path.join(this.entryDir, `${entrySum.id}.md`);
      if (fs.existsSync(entryPath)) {
        fs.unlinkSync(entryPath);
      }
    }

    // Delete category index file
    const categoryPath = path.join(this.categoryDir, `${id}.json`);
    if (fs.existsSync(categoryPath)) {
      fs.unlinkSync(categoryPath);
    }

    // Update root index
    const root = this.loadRoot();
    root.categories = root.categories.filter(c => c.id !== id);
    root.updatedAt = Date.now();
    this.saveRoot(root);
  }

  async updateCategory(id: string, name: string, description?: string): Promise<void> {
    const root = this.loadRoot();
    const catSum = root.categories.find(c => c.id === id);
    if (!catSum) throw new Error(`Category ${id} not found`);

    const category = this.loadCategory(id);
    if (!category) throw new Error(`Category details for ${id} not found`);

    catSum.name = name;
    if (description !== undefined) catSum.description = description;
    catSum.lastUpdatedAt = Date.now();

    category.name = name;
    if (description !== undefined) category.description = description;
    category.updatedAt = Date.now();

    this.saveCategory(category);
    this.saveRoot(root);
  }

  async addCategory(name: string, description: string = ''): Promise<string> {
    const root = this.loadRoot();
    const existing = root.categories.find(c => c.name === name);
    if (existing) return existing.id;

    const id = typeid('mcat').toString();
    const newCat: MemoryCategorySummary = {
      id,
      name,
      description,
      entryCount: 0,
      lastUpdatedAt: Date.now()
    };
    
    root.categories.push(newCat);
    this.saveRoot(root);

    const catIndex: MemoryCategoryIndex = {
      id,
      name,
      description,
      entries: [],
      updatedAt: Date.now()
    };
    this.saveCategory(catIndex);
    
    return id;
  }

  async moveMemoryToCategory(memoryId: string, targetCategoryId: string): Promise<void> {
    const root = this.loadRoot();
    const targetCategory = this.loadCategory(targetCategoryId);
    if (!targetCategory) throw new Error(`Target category ${targetCategoryId} not found`);

    // Find source category
    let sourceCategory: MemoryCategoryIndex | null = null;
    let entrySumToMove: MemoryEntrySummary | null = null;

    for (const catSum of root.categories) {
      const category = this.loadCategory(catSum.id);
      if (category) {
        const entryIndex = category.entries.findIndex(e => e.id === memoryId);
        if (entryIndex !== -1) {
          sourceCategory = category;
          entrySumToMove = category.entries[entryIndex];
          
          // Remove from source
          category.entries.splice(entryIndex, 1);
          category.updatedAt = Date.now();
          this.saveCategory(category);
          
          catSum.entryCount = category.entries.length;
          catSum.lastUpdatedAt = category.updatedAt;
          break;
        }
      }
    }

    if (!sourceCategory || !entrySumToMove) {
      throw new Error(`Memory entry ${memoryId} not found in any category`);
    }

    // Add to target
    if (!targetCategory.entries.find(e => e.id === memoryId)) {
      targetCategory.entries.push(entrySumToMove);
      targetCategory.updatedAt = Date.now();
      this.saveCategory(targetCategory);

      const targetCatSum = root.categories.find(c => c.id === targetCategoryId);
      if (targetCatSum) {
        targetCatSum.entryCount = targetCategory.entries.length;
        targetCatSum.lastUpdatedAt = targetCategory.updatedAt;
      }
    }

    this.saveRoot(root);
  }

  async mergeCategories(ids: string[], targetName: string, targetDescription?: string): Promise<string> {
    if (ids.length < 2) throw new Error("At least two categories are required for merge");

    LogService.info(`Merging ${ids.length} memory categories into ${targetName}...`);
    
    // 1. Always generate a new unique ID for the merge result
    const targetId = typeid('mcat').toString();
    const root = this.loadRoot();
    
    // Find if a category with the same name already exists
    const existing = root.categories.find(c => c.name === targetName);
    const allSourceIds = [...new Set([...ids, ...(existing ? [existing.id] : [])])];
    
    let targetCategory: MemoryCategoryIndex = {
      id: targetId,
      name: targetName,
      description: targetDescription || `${ids.length} 个主题合并后的记录`,
      entries: [],
      updatedAt: Date.now()
    };
    
    // Add to root immediately so we can start merging into it
    root.categories.push({
      id: targetId,
      name: targetCategory.name,
      description: targetCategory.description,
      entryCount: 0,
      lastUpdatedAt: Date.now()
    });

    // 2. Move entries from all source categories (including any existing one with the same name)
    for (const id of allSourceIds) {
      if (id === targetId) continue;
      const sourceCategory = this.loadCategory(id);
      if (!sourceCategory) continue;

      for (const entrySum of sourceCategory.entries) {
        if (!targetCategory.entries.find(e => e.id === entrySum.id)) {
          targetCategory.entries.push(entrySum);
        }
      }

      // Physical deletion of source category files and root entries
      const categoryPath = path.join(this.categoryDir, `${id}.json`);
      if (fs.existsSync(categoryPath)) fs.unlinkSync(categoryPath);
      
      root.categories = root.categories.filter(c => c.id !== id);
    }

    // 3. Save final state
    targetCategory.updatedAt = Date.now();
    const targetRootCat = root.categories.find(c => c.id === targetId);
    if (targetRootCat) {
      targetRootCat.entryCount = targetCategory.entries.length;
      targetRootCat.lastUpdatedAt = targetCategory.updatedAt;
    }
    
    root.updatedAt = Date.now();
    this.saveCategory(targetCategory);
    this.saveRoot(root);

    LogService.info(`Memory categories merged into: ${targetId}`);
    return targetId;
  }

  async getCategories(): Promise<MemoryCategorySummary[]> {
    try {
      const root = this.loadRoot();
      return root.categories;
    } catch (err: any) {
      LogService.error(`Failed to get memory categories: ${err.message}`);
      return [];
    }
  }

  async getCategoryDetails(id: string): Promise<MemoryCategoryIndex | null> {
    try {
      return this.loadCategory(id);
    } catch (err: any) {
      LogService.error(`Failed to get category details for ${id}: ${err.message}`);
      return null;
    }
  }

  async queryMemory(query: string, options: {
    agentId?: string;
    limit?: number;
    minImportance?: number;
  } = {}): Promise<string> {
    if (!this.agentService) {
      return "AgentService 不可用，无法进行推理检索。";
    }

    try {
      const root = this.loadRoot();
      if (root.categories.length === 0) return "未找到任何记忆。";

      const excludedDayKey = this.getDayKey(Date.now());
      const minImportance = options.minImportance ?? 1;
      const limit = options.limit ?? 5;

      const rootNavPrompt = PromptService.getInstance().getPrompt('memory_root_nav', {
        categoriesStr: root.categories.map(c => `- [ID: ${c.id}] ${c.name}: ${c.description}`).join('\n'),
        query
      });

      const navResult = await this.agentService.runAgent(MEMORY_READ_AGENT_ID, rootNavPrompt, undefined, { silent: true, noTools: true, noSkills: true });
      let selectedCatIds: string[] = [];
      try {
        const jsonMatch = navResult.content.match(/\[[\s\S]*\]/);
        selectedCatIds = JSON.parse(jsonMatch ? jsonMatch[0] : navResult.content);
      } catch {
        selectedCatIds = [];
      }

      if (selectedCatIds.length === 0) return "未检索到与查询直接相关的记忆类别。";

      const relevantEntries: MemoryEntrySummary[] = [];
      for (const catId of selectedCatIds.slice(0, 3)) {
        const category = this.loadCategory(catId);
        if (!category) continue;

        const eligibleEntries = category.entries
          .filter(entry => entry.importance >= minImportance)
          .filter(entry => !this.isSameDay(entry.createdAt, excludedDayKey))
          .sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt);

        if (eligibleEntries.length === 0) {
          continue;
        }

        const entryChoicePrompt = PromptService.getInstance().getPrompt('memory_entry_choice', {
          categoryName: category.name,
          entriesStr: eligibleEntries.map((e, i) => `${i+1}. [ID: ${e.id}] (重要度: ${e.importance}, 日期: ${getISODate(new Date(e.createdAt))}) 摘要: ${e.summary}`).join('\n'),
          query
        });

        const choiceResult = await this.agentService.runAgent(MEMORY_READ_AGENT_ID, entryChoicePrompt, undefined, { silent: false, noTools: true, noSkills: true });
        let chosenIds: string[] = [];
        try {
          const jsonMatch = choiceResult.content.match(/\[[\s\S]*\]/);
          chosenIds = JSON.parse(jsonMatch ? jsonMatch[0] : choiceResult.content);
        } catch {
          chosenIds = [];
        }

        chosenIds.forEach(id => {
          const entry = eligibleEntries.find(e => e.id === id);
          if (entry && !relevantEntries.some(existing => existing.id === entry.id)) {
            relevantEntries.push(entry);
          }
        });
      }

      if (relevantEntries.length === 0) {
        return '在相关类别中未找到满足条件的历史记忆条目（当天新写入的记忆已自动排除）。';
      }

      // --- 阶段 3: 读取并精准提取 (Per-entry Extraction) ---
      const extractedSnippets: string[] = [];
      for (const entrySum of relevantEntries.slice(0, limit)) {
        const entryPath = path.join(this.entryDir, `${entrySum.id}.md`);
        if (fs.existsSync(entryPath)) {
          const fullContent = fs.readFileSync(entryPath, 'utf8');
          
          // 对每一条记忆进行独立的精准提取，过滤掉无关噪音
          const extractionPrompt = PromptService.getInstance().getPrompt('memory_extraction', {
            fullContent,
            query
          });

          const extractionResult = await this.agentService.runAgent(MEMORY_READ_AGENT_ID, extractionPrompt, undefined, { silent: false, noTools: true, noSkills: true });
          const cleanedContent = extractionResult.content.trim();
          
          if (cleanedContent && cleanedContent !== "无相关内容") {
            extractedSnippets.push(`[来源记录: ${entrySum.id}]\n${cleanedContent}`);
          }
        }
      }

      if (extractedSnippets.length === 0) return "虽然找到了相关条目，但经精读后发现其中并无直接相关的细节内容。";

      // --- 阶段 4: 最终汇总 ---
      const finalSummaryPrompt = PromptService.getInstance().getPrompt('memory_final_summary', {
        snippetsStr: extractedSnippets.join('\n\n---\n\n'),
        query
      });

      const finalResult = await this.agentService.runAgent(MEMORY_READ_AGENT_ID, finalSummaryPrompt, undefined, { silent: false, noTools: true, noSkills: true });
      const content = finalResult.content;
      // 避免返回 AgentService 的默认错误内容
      if (content === 'No response generated (AI returned empty content)') {
        return "";
      }
      return content;


    } catch (error: any) {
      LogService.error(`Hierarchical memory query failed: ${error.message}`);
      return `记忆检索过程中出现错误: ${error.message}`;
    }
  }

  async deleteMemory(id: string): Promise<void> {
    const entryPath = path.join(this.entryDir, `${id}.md`);
    if (fs.existsSync(entryPath)) fs.unlinkSync(entryPath);

    const root = this.loadRoot();
    for (const catSummary of root.categories) {
      const category = this.loadCategory(catSummary.id);
      if (category) {
        const initialCount = category.entries.length;
        category.entries = category.entries.filter(e => e.id !== id);
        if (category.entries.length !== initialCount) {
          category.updatedAt = Date.now();
          this.saveCategory(category);
          catSummary.entryCount = category.entries.length;
          catSummary.lastUpdatedAt = category.updatedAt;
        }
      }
    }
    this.saveRoot(root);
  }

  async updateMemoryContent(id: string, content: string): Promise<void> {
    const entryPath = path.join(this.entryDir, `${id}.md`);
    if (!fs.existsSync(entryPath)) throw new Error("Memory entry not found");

    // 1. Update full text file
    fs.writeFileSync(entryPath, content);

    // 2. Update summary in index if possible
    const root = this.loadRoot();
    for (const catSum of root.categories) {
      const category = this.loadCategory(catSum.id);
      if (!category) continue;

      const entrySum = category.entries.find(e => e.id === id);
      if (entrySum) {
        // Try to update summary (simple truncation for now, or could call AI)
        entrySum.summary = content.slice(0, 100).replace(/\n/g, ' ');
        entrySum.hash = crypto.createHash('sha256').update(content).digest('hex');
        category.updatedAt = Date.now();
        this.saveCategory(category);
        
        catSum.lastUpdatedAt = category.updatedAt;
        this.saveRoot(root);
        break;
      }
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

    LogService.info(`Merging ${ids.length} memories into a new one...`);

    // 1. 获取所有记忆全文
    const contents: string[] = [];
    for (const id of ids) {
      const content = await this.getMemoryFullText(id);
      if (content !== '记忆内容未找到') {
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
      importance: 3, // 合并后的记忆通常较为重要
      tags: ['merged'],
      metadata: { mergedFrom: ids }
    });

    // 4. 删除旧记忆
    for (const id of ids) {
      await this.deleteMemory(id);
    }

    LogService.info(`Memories merged successfully into new ID: ${newId}`);
    return newId;
  }

  async getMemoryFullText(id: string): Promise<string> {
    const entryPath = path.join(this.entryDir, `${id}.md`);
    if (fs.existsSync(entryPath)) {
      return fs.readFileSync(entryPath, 'utf8');
    }
    return '记忆内容未找到';
  }

  async migrateFromSqlite() {
    LogService.info("Starting memory migration from SQLite to Hierarchical Filesystem...");
    try {
      const sqliteMemories = await (this.store as any).listAllMemories();
      if (!sqliteMemories || sqliteMemories.length === 0) {
        LogService.info("No legacy memories found in SQLite.");
        return;
      }

      LogService.info(`Found ${sqliteMemories.length} legacy memories in SQLite.`);
      let migratedCount = 0;
      let skippedCount = 0;

      for (const mem of sqliteMemories) {
        const hash = crypto.createHash('sha256').update(this.normalizeMemoryContent(mem.content)).digest('hex');
        const existingId = this.findDuplicate(hash);
        
        if (existingId) {
          skippedCount++;
          continue;
        }

        await this.saveMemory(mem.content, {
          agentId: mem.agentId,
          importance: mem.importance,
          tags: mem.tags,
          metadata: { ...mem.metadata, migratedAt: Date.now() }
        });
        migratedCount++;
      }
      
      LogService.info(`Migration completed: ${migratedCount} migrated, ${skippedCount} skipped (duplicates).`);
      await this.reconcileIndex();
      
    } catch (error: any) {
      LogService.error(`Migration failed: ${error.message}`);
    }
  }

  private async reconcileIndex() {
    LogService.info("Starting memory index reconciliation...");
    try {
      const files = fs.readdirSync(this.entryDir).filter(f => f.endsWith('.md'));
      const root = this.loadRoot();
      
      const indexedIds = new Set<string>();
      for (const catSum of root.categories) {
        const category = this.loadCategory(catSum.id);
        if (category) {
          category.entries.forEach(e => indexedIds.add(e.id));
        }
      }

      let reconciledCount = 0;
      for (const file of files) {
        const id = file.replace('.md', '');
        if (!indexedIds.has(id)) {
          const content = fs.readFileSync(path.join(this.entryDir, file), 'utf8');
          const hash = crypto.createHash('sha256').update(this.normalizeMemoryContent(content)).digest('hex');
          
          const entry: MemoryEntry = {
            id,
            content,
            importance: 1,
            tags: ['reconciled'],
            metadata: { hash },
            createdAt: fs.statSync(path.join(this.entryDir, file)).mtimeMs
          };
          
          await this.addToCategory('uncategorized', '未分类', '包含自动对齐找回的记录', entry, content.slice(0, 50) + '...');
          reconciledCount++;
        }
      }
      
      if (reconciledCount > 0) {
        LogService.info(`Index reconciliation completed: ${reconciledCount} files recovered to index.`);
      }
    } catch (err: any) {
      LogService.error(`Index reconciliation failed: ${err.message}`);
    }
  }
}
