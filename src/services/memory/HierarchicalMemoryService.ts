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
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
      tags: options.tags || [],
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
        ? recentEntries.map((item, index) => `${index + 1}. [ID: ${item.id}] [分类: ${item.categoryName}] [日期: ${new Date(item.createdAt).toISOString()}]\n摘要: ${item.summary}`).join('\n\n')
        : '暂无已存在记忆。';
      
      const classifierPrompt = `你是一个记忆管理助手。你的任务是将新的记忆片段分类到现有的层级结构中，或建议创建一个新分类。

现有的分类如下：
${categoriesStr || '目前暂无分类。'}

最近几条已存在记忆（这些内容已经在记忆库中，请将其视为已存在上下文，用于避免重复表达并帮助判断分类）：
${recentEntriesStr}

待分类的内容：
"${content}"

规则：
1. **语义匹配**：基于内容的语义逻辑进行分类，而不是简单的关键词。
2. **多级目录原则**：优先使用现有分类。如果现有分类都不合适，请提供一个新的 [分类ID] (英文小写下划线) 和 [分类名称] (中文)。
3. **精炼摘要**：为这条记忆生成一个 1 句话的精炼摘要（中文），捕捉核心事实、技术细节或偏好。
4. **摘要去重提示**：如果内容主要是对已有事实的重复表述，摘要中应尽量保留能区分本条记录的新信息，避免产出空泛复述。
5. **参考已有内容**：上面的“最近几条已存在记忆”都已经存在，请不要把它们当成待保存的新内容；你需要结合这些已有内容判断当前内容是否只是补充、更新或细化，并在摘要中突出新增信息。

请以 JSON 格式输出：
{
  "categoryId": "分类ID",
  "categoryName": "分类名称 (仅当建议新建时提供)",
  "categoryDescription": "分类描述 (仅当建议新建时提供)",
  "entrySummary": "记忆精炼摘要"
}`;

      const result = await this.agentService.runAgent('memory_assistant', classifierPrompt, undefined, { silent: true, noTools: true, noSkills: true });
      
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
    return new Date(timestamp).toISOString().slice(0, 10);
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
        tags: entry.tags,
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

      const rootNavPrompt = `你是一个精准的记忆检索助手。你的任务是根据用户的查询，从记忆库的顶层分类中选出**真正相关**的分类。

现有分类及其描述如下：
${root.categories.map(c => `- [ID: ${c.id}] ${c.name}: ${c.description}`).join('\n')}

用户查询：
"${query}"

规则：
1. **严格筛选**：仅选出那些与查询语义高度契合的分类。如果分类只是看起来像但内容不符，请不要选择。
2. **宁缺毋滥**：如果没有相关的分类，请直接输出 []。
只需输出 JSON 数组，例如：["category_id_1"]。`;

      const navResult = await this.agentService.runAgent('memory_assistant', rootNavPrompt, undefined, { silent: true, noTools: true, noSkills: true });
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

        const entryChoicePrompt = `你正在查看记忆分类 [${category.name}] 的内容索引。
这个分类包含以下记忆片段的摘要（已提前排除当天写入的记录，并按重要度与时间排序）：
${eligibleEntries.map((e, i) => `${i+1}. [ID: ${e.id}] (重要度: ${e.importance}, 日期: ${new Date(e.createdAt).toISOString().split('T')[0]}) 摘要: ${e.summary}`).join('\n')}

用户查询：
"${query}"

任务：
请选出能**直接帮助回答**此查询的记忆 ID。
**判别标准**：
- 仅选择那些能提供事实证据、具体偏好或直接答案的条目。
- 如果某个条目只是背景信息但与当前问题无关，请忽略。
- 如果没有相关条目，请输出 []。
只需输出 JSON 数组，例如：["mem_1"]。`;

        const choiceResult = await this.agentService.runAgent('memory_assistant', entryChoicePrompt, undefined, { silent: false, noTools: true, noSkills: true });
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
          const extractionPrompt = `你是一个精准的信息过滤器。
原始记忆内容：
"""
${fullContent}
"""

用户查询：
"${query}"

任务：
请从上述内容中，**仅提取**出与用户查询直接相关的原句或核心事实。
**严禁要求**：
- 如果内容不相关，请直接回复“无相关内容”。
- 严禁保留任何与查询主题（如“模型发布”）无关的信息（如硬件、融资、政策等）。
- 保持原意，不要进行总结，只做提取。`;

          const extractionResult = await this.agentService.runAgent('memory_assistant', extractionPrompt, undefined, { silent: false, noTools: true, noSkills: true });
          const cleanedContent = extractionResult.content.trim();
          
          if (cleanedContent && cleanedContent !== "无相关内容") {
            extractedSnippets.push(`[来源记录: ${entrySum.id}]\n${cleanedContent}`);
          }
        }
      }

      if (extractedSnippets.length === 0) return "虽然找到了相关条目，但经精读后发现其中并无直接相关的细节内容。";

      // --- 阶段 4: 最终汇总 ---
      const finalSummaryPrompt = `你是一个专业的记忆总结助手。以下是经过精准过滤后的相关记忆片段：

${extractedSnippets.join('\n\n---\n\n')}

用户查询：
"${query}"

请基于这些**纯净的片段**，为用户提供一个准确、简洁的回答。不要包含任何未提及的信息。`;

      const finalResult = await this.agentService.runAgent('memory_assistant', finalSummaryPrompt, undefined, { silent: false, noTools: true, noSkills: true });
      return finalResult.content;


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
