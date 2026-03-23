import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { typeid } from 'typeid-js';
import { LogService } from '../LogService.js';
import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { DocumentProcessor } from './DocumentProcessor.js';
import { 
  IKnowledgeBaseService, 
  KBCategory, 
  KBDocument, 
  KBIndex, 
  KBCategoryIndex, 
  KBDocumentSummary 
} from '../../types/knowledge.js';

export class HierarchicalKnowledgeService implements IKnowledgeBaseService {
  private store: LocalStore;
  private agentService: AgentService | null;
  private processor: DocumentProcessor;
  private kbDir: string;
  private categoryDir: string;
  private documentDir: string;
  private chunkDir: string;
  private rootPath: string;

  constructor(store: LocalStore, agentService: AgentService | null) {
    this.store = store;
    this.agentService = agentService;
    this.processor = new DocumentProcessor();
    
    const dataDir = path.dirname(store.getDbPath());
    this.kbDir = path.join(dataDir, 'knowledge');
    this.categoryDir = path.join(this.kbDir, 'categories');
    this.documentDir = path.join(this.kbDir, 'documents');
    this.chunkDir = path.join(this.kbDir, 'chunks');
    this.rootPath = path.join(this.kbDir, 'root.json');

    this.initDirs();
  }

  private initDirs() {
    [this.kbDir, this.categoryDir, this.documentDir, this.chunkDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    if (!fs.existsSync(this.rootPath)) {
      const initialRoot: KBIndex = {
        version: '1.0',
        categories: [],
        updatedAt: Date.now()
      };
      fs.writeFileSync(this.rootPath, JSON.stringify(initialRoot, null, 2));
    }
  }

  private loadRoot(): KBIndex {
    return JSON.parse(fs.readFileSync(this.rootPath, 'utf8'));
  }

  private saveRoot(root: KBIndex) {
    fs.writeFileSync(this.rootPath, JSON.stringify(root, null, 2));
  }

  private loadCategory(id: string): KBCategoryIndex | null {
    const filePath = path.join(this.categoryDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  private saveCategory(category: KBCategoryIndex) {
    const filePath = path.join(this.categoryDir, `${category.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(category, null, 2));
  }

  async getCategories(): Promise<KBCategory[]> {
    return this.loadRoot().categories;
  }

  async addCategory(name: string, description: string = ''): Promise<string> {
    const id = name.toLowerCase().replace(/\s+/g, '_');
    const root = this.loadRoot();
    
    if (root.categories.find(c => c.id === id)) return id;

    const newCat: KBCategory = {
      id,
      name,
      description,
      documentCount: 0,
      lastUpdatedAt: Date.now()
    };
    
    root.categories.push(newCat);
    this.saveRoot(root);

    const catIndex: KBCategoryIndex = {
      id,
      name,
      description,
      documents: [],
      updatedAt: Date.now()
    };
    this.saveCategory(catIndex);
    
    return id;
  }

  async deleteCategory(id: string): Promise<void> {
    const category = this.loadCategory(id);
    if (!category) {
      return;
    }

    for (const document of category.documents) {
      await this.deleteDocument(document.id);
    }

    const categoryPath = path.join(this.categoryDir, `${id}.json`);
    if (fs.existsSync(categoryPath)) {
      fs.unlinkSync(categoryPath);
    }

    const root = this.loadRoot();
    const nextCategories = root.categories.filter(categoryItem => categoryItem.id !== id);
    if (nextCategories.length !== root.categories.length) {
      this.saveRoot({
        ...root,
        categories: nextCategories,
        updatedAt: Date.now()
      });
    }
  }

  async getDocuments(categoryId: string): Promise<KBDocument[]> {
    const category = this.loadCategory(categoryId);
    if (!category) return [];

    const documents: KBDocument[] = [];
    for (const docSum of category.documents) {
      const docPath = path.join(this.documentDir, `${docSum.id}.json`);
      if (fs.existsSync(docPath)) {
        documents.push(JSON.parse(fs.readFileSync(docPath, 'utf8')));
      }
    }
    return documents;
  }

  async addDocument(categoryId: string, file: { name: string; path: string; buffer: Buffer }): Promise<string> {
    // 1. Parse Document
    const processed = await this.processor.parse(file.name, file.buffer);
    
    // 2. Chunk Document
    const chunks = this.processor.chunk(processed.text);
    
    // 3. Generate Summary (Optional, use LLM if available)
    let summary = processed.text.slice(0, 500) + '...';
    if (this.agentService) {
      try {
        const summaryPrompt = `你是一个专业的文档分析助手。请对以下文档进行精炼总结，提取其核心内容、主题和关键结论。
文档名称: "${file.name}"
文档完整内容:
"${processed.text}"

请直接输出 2-3 句话的中文总结。`;
        const result = await this.agentService.runAgent('knowledge_assistant', summaryPrompt, undefined, { silent: true, noTools: true });
        summary = result.content.trim();
      } catch (err) {
        LogService.warn(`Document summarization failed for ${file.name}: ${err}`);
      }
    }

    // 4. Create Document Entity
    const id = typeid('kb').toString();
    const doc: KBDocument = {
      id,
      categoryId,
      name: file.name,
      fileName: file.name,
      type: processed.type,
      summary,
      chunkCount: chunks.length,
      metadata: { ...processed.metadata, hash: crypto.createHash('sha256').update(processed.text).digest('hex') },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // 5. Save Document and Chunks
    fs.writeFileSync(path.join(this.documentDir, `${id}.json`), JSON.stringify(doc, null, 2));
    
    const docChunkDir = path.join(this.chunkDir, id);
    if (!fs.existsSync(docChunkDir)) fs.mkdirSync(docChunkDir, { recursive: true });
    
    chunks.forEach((content, index) => {
      fs.writeFileSync(path.join(docChunkDir, `${index}.md`), content);
    });

    // 6. Update Category Index
    const category = this.loadCategory(categoryId);
    if (category) {
      category.documents.push({
        id,
        name: doc.name,
        type: doc.type,
        summary: doc.summary,
        chunkCount: doc.chunkCount,
        createdAt: doc.createdAt
      });
      category.updatedAt = Date.now();
      this.saveCategory(category);
      
      const root = this.loadRoot();
      const rootCat = root.categories.find(c => c.id === categoryId);
      if (rootCat) {
        rootCat.documentCount = category.documents.length;
        rootCat.lastUpdatedAt = category.updatedAt;
        this.saveRoot(root);
      }
    }

    return id;
  }

  async deleteDocument(id: string): Promise<void> {
    const docPath = path.join(this.documentDir, `${id}.json`);
    if (!fs.existsSync(docPath)) return;

    const doc: KBDocument = JSON.parse(fs.readFileSync(docPath, 'utf8'));
    fs.unlinkSync(docPath);

    // Delete chunks
    const docChunkDir = path.join(this.chunkDir, id);
    if (fs.existsSync(docChunkDir)) {
      const files = fs.readdirSync(docChunkDir);
      files.forEach(f => fs.unlinkSync(path.join(docChunkDir, f)));
      fs.rmdirSync(docChunkDir);
    }

    // Update Category
    const category = this.loadCategory(doc.categoryId);
    if (category) {
      category.documents = category.documents.filter(d => d.id !== id);
      category.updatedAt = Date.now();
      this.saveCategory(category);

      const root = this.loadRoot();
      const rootCat = root.categories.find(c => c.id === doc.categoryId);
      if (rootCat) {
        rootCat.documentCount = category.documents.length;
        rootCat.lastUpdatedAt = category.updatedAt;
        this.saveRoot(root);
      }
    }
  }

  async getDocumentFullText(id: string): Promise<string> {
    const docChunkDir = path.join(this.chunkDir, id);
    if (!fs.existsSync(docChunkDir)) return '文档内容未找到';

    const chunkFiles = fs.readdirSync(docChunkDir).sort((a, b) => {
      return parseInt(a.split('.')[0]) - parseInt(b.split('.')[0]);
    });

    return chunkFiles.map(f => {
      return fs.readFileSync(path.join(docChunkDir, f), 'utf8');
    }).join('\n');
  }

  async queryKnowledge(query: string, options: { categoryIds?: string[]; limit?: number } = {}): Promise<string> {
    if (!this.agentService) return "AgentService 不可用，无法进行语义检索。";

    const root = this.loadRoot();
    if (root.categories.length === 0) return "[]";

    const today = new Date().toISOString().split('T')[0];

    try {
      // --- 阶段 1: 顶层导航 (Root Navigation) ---
      const availableCategories = options.categoryIds 
        ? root.categories.filter(c => options.categoryIds?.includes(c.id))
        : root.categories;

      if (availableCategories.length === 0) return "未找到指定的知识库分类。";

      const rootNavPrompt = `你是一个精准的知识库检索助手。你的任务是根据用户的查询，从知识库的分类中选出**最相关**的分类。
当前日期：${today}

现有分类及其描述如下：
${availableCategories.map(c => `- [ID: ${c.id}] ${c.name}: ${c.description}`).join('\n')}

用户查询：
"${query}"

规则：
1. **精准匹配**：仅选出可能包含答案的分类。
2. **宁缺毋滥**：如果没有相关的分类，请直接输出 [].
只需输出 JSON 数组，例如：["category_id_1"]。`;

      const navResult = await this.agentService.runAgent('knowledge_assistant', rootNavPrompt, undefined, { silent: true, noTools: true });
      let selectedCatIds: string[] = [];
      try {
        const jsonMatch = navResult.content.match(/\[[\s\S]*\]/);
        selectedCatIds = JSON.parse(jsonMatch ? jsonMatch[0] : navResult.content);
      } catch {
        selectedCatIds = [];
      }

      if (selectedCatIds.length === 0) return "未检索到与查询相关的知识类别。";

      // --- 阶段 2: 文档筛选 (Document Selection) ---
      const selectedDocIds: string[] = [];
      for (const catId of selectedCatIds.slice(0, 3)) {
        const category = this.loadCategory(catId);
        if (!category || category.documents.length === 0) continue;

        const docChoicePrompt = `你正在查看知识库分类 [${category.name}] 的内容索引。
当前日期：${today}

这个分类包含以下文档的摘要：
${category.documents.map((d, i) => `${i+1}. [ID: ${d.id}] 名称: ${d.name} \n   摘要: ${d.summary}`).join('\n')}

用户查询：
"${query}"

任务：
请选出最可能包含查询答案的文档 ID。
1. **严格相关性**：仅选择内容与查询直接相关的文档。
2. **时间匹配**：注意用户查询中的时间词（如“上周”、“昨天”）。如果文档日期与查询时间不符，请不要选择。
只需输出 JSON 数组，例如：["doc_id_1"]。如果没有相关文档，输出 []。`;

        const choiceResult = await this.agentService.runAgent('knowledge_assistant', docChoicePrompt, undefined, { silent: true, noTools: true });
        let chosenIds: string[] = [];
        try {
          const jsonMatch = choiceResult.content.match(/\[[\s\S]*\]/);
          chosenIds = JSON.parse(jsonMatch ? jsonMatch[0] : choiceResult.content);
        } catch {
          chosenIds = [];
        }
        selectedDocIds.push(...chosenIds);
      }

      if (selectedDocIds.length === 0) return "抱歉，知识库中暂时没有与您的查询（特别是涉及的时间范围）相匹配的文档。";

      // --- 阶段 3: 深度读取与精准汇总 (Deep Read & Synthesis) ---
      const fullContents: string[] = [];
      for (const docId of Array.from(new Set(selectedDocIds)).slice(0, 3)) {
        const docPath = path.join(this.documentDir, `${docId}.json`);
        if (!fs.existsSync(docPath)) continue;
        const doc: KBDocument = JSON.parse(fs.readFileSync(docPath, 'utf8'));
        
        const docChunkDir = path.join(this.chunkDir, docId);
        if (!fs.existsSync(docChunkDir)) continue;

        const chunkFiles = fs.readdirSync(docChunkDir).sort((a, b) => {
          return parseInt(a.split('.')[0]) - parseInt(b.split('.')[0]);
        });

        const docFullText = chunkFiles.map(f => {
          return fs.readFileSync(path.join(docChunkDir, f), 'utf8');
        }).join('\n');

        fullContents.push(`[文档名称: ${doc.name}]\n[上传时间: ${new Date(doc.createdAt).toISOString()}]\n${docFullText}`);
      }

      if (fullContents.length === 0) return "内容读取失败，请检查文档是否存在。";

      const finalPrompt = `你是一个严谨的知识库专家。请根据以下提供的文档内容，回答用户的查询。
当前日期：${today}

文档内容：
${fullContents.join('\n\n---\n\n')}

用户查询：
"${query}"

注意（必须严格遵守）：
1. **完全基于文档**：仅根据提供的文档内容进行回答。
2. **禁止回退到自身知识**：如果文档中没有包含查询所需的答案，你必须诚实地回答：“抱歉，提供的文档中没有关于此问题的相关信息。”，**严禁**使用你自己的预训练知识来补全。
3. **时间校验**：如果用户询问“上周”而文档只包含“本周”内容，请明确告知用户文档中不包含上周的信息。
4. **结构化**：使用列表或清晰的段落进行回答，并注明信息来源。`;

      const finalResult = await this.agentService.runAgent('knowledge_assistant', finalPrompt, undefined, { silent: true, noTools: true });
      return finalResult.content;

    } catch (error: any) {
      LogService.error(`Knowledge progressive query failed: ${error.message}`);
      return `知识库检索失败: ${error.message}`;
    }
  }
}
