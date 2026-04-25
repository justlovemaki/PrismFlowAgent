import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { typeid } from 'typeid-js';
import { LogService } from '../LogService.js';
import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { PromptService } from '../PromptService.js';
import { DocumentProcessor } from './DocumentProcessor.js';
import { getISODate } from '../../utils/helpers.js';
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
    const root = this.loadRoot();
    const existing = root.categories.find(c => c.name === name);
    if (existing) return existing.id;

    const id = typeid('kbcat').toString();

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

  async mergeCategories(ids: string[], targetName: string, targetDescription?: string): Promise<string> {
    if (ids.length < 2) throw new Error("At least two categories are required for merge");

    LogService.info(`Merging ${ids.length} knowledge categories into ${targetName}...`);
    
    // 1. Always generate a new unique ID for the merge result
    const targetId = typeid('kbcat').toString();
    const root = this.loadRoot();
    
    // Find if a category with the same name already exists
    const existing = root.categories.find(c => c.name === targetName);
    const allSourceIds = [...new Set([...ids, ...(existing ? [existing.id] : [])])];
    
    let targetCategory: KBCategoryIndex = {
      id: targetId,
      name: targetName,
      description: targetDescription || `${ids.length} 个知识库分类合并后的记录`,
      documents: [],
      updatedAt: Date.now()
    };
    
    root.categories.push({
      id: targetId,
      name: targetCategory.name,
      description: targetCategory.description,
      documentCount: 0,
      lastUpdatedAt: Date.now()
    });

    // 2. Move documents from source categories to target
    for (const id of allSourceIds) {
      if (id === targetId) continue;
      const sourceCategory = this.loadCategory(id);
      if (!sourceCategory) continue;

      for (const docSum of sourceCategory.documents) {
        if (!targetCategory.documents.find(d => d.id === docSum.id)) {
          targetCategory.documents.push(docSum);
          
          // Update the document file itself to point to the new categoryId
          const docPath = path.join(this.documentDir, `${docSum.id}.json`);
          if (fs.existsSync(docPath)) {
            const doc: KBDocument = JSON.parse(fs.readFileSync(docPath, 'utf8'));
            doc.categoryId = targetId;
            doc.updatedAt = Date.now();
            fs.writeFileSync(docPath, JSON.stringify(doc, null, 2));
          }
        }
      }

      // Physical deletion of source category index file
      const categoryPath = path.join(this.categoryDir, `${id}.json`);
      if (fs.existsSync(categoryPath)) fs.unlinkSync(categoryPath);
      
      root.categories = root.categories.filter(c => c.id !== id);
    }

    // 3. Save final state
    targetCategory.updatedAt = Date.now();
    const targetRootCat = root.categories.find(c => c.id === targetId);
    if (targetRootCat) {
      targetRootCat.documentCount = targetCategory.documents.length;
      targetRootCat.lastUpdatedAt = targetCategory.updatedAt;
    }
    
    root.updatedAt = Date.now();
    this.saveCategory(targetCategory);
    this.saveRoot(root);

    LogService.info(`Knowledge categories merged into: ${targetId}`);
    return targetId;
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
        const summaryPrompt = PromptService.getInstance().getPrompt('knowledge_summary', {
          fileName: file.name,
          text: processed.text
        });
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

  async updateDocumentContent(id: string, content: string): Promise<void> {
    const docPath = path.join(this.documentDir, `${id}.json`);
    if (!fs.existsSync(docPath)) throw new Error("Document not found");

    const doc: KBDocument = JSON.parse(fs.readFileSync(docPath, 'utf8'));
    
    // 1. Re-chunk the new content
    const chunks = this.processor.chunk(content);
    
    // 2. Clear old chunks
    const docChunkDir = path.join(this.chunkDir, id);
    if (fs.existsSync(docChunkDir)) {
      const files = fs.readdirSync(docChunkDir);
      files.forEach(f => fs.unlinkSync(path.join(docChunkDir, f)));
    } else {
      fs.mkdirSync(docChunkDir, { recursive: true });
    }

    // 3. Save new chunks
    chunks.forEach((chunk, index) => {
      fs.writeFileSync(path.join(docChunkDir, `${index}.md`), chunk);
    });

    // 4. Update doc metadata
    doc.chunkCount = chunks.length;
    doc.updatedAt = Date.now();
    doc.metadata.hash = crypto.createHash('sha256').update(content).digest('hex');
    fs.writeFileSync(docPath, JSON.stringify(doc, null, 2));

    // 5. Update Category Index
    const category = this.loadCategory(doc.categoryId);
    if (category) {
      const docSum = category.documents.find(d => d.id === id);
      if (docSum) {
        docSum.chunkCount = doc.chunkCount;
      }
      category.updatedAt = Date.now();
      this.saveCategory(category);
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

    const today = getISODate();

    try {
      // --- 阶段 1: 顶层导航 (Root Navigation) ---
      const availableCategories = options.categoryIds 
        ? root.categories.filter(c => options.categoryIds?.includes(c.id))
        : root.categories;

      if (availableCategories.length === 0) return "未找到指定的知识库分类。";

      const rootNavPrompt = PromptService.getInstance().getPrompt('knowledge_root_nav', {
        today,
        categoriesStr: availableCategories.map(c => `- [ID: ${c.id}] ${c.name}: ${c.description}`).join('\n'),
        query
      });

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

        const docChoicePrompt = PromptService.getInstance().getPrompt('knowledge_doc_choice', {
          categoryName: category.name,
          today,
          docsStr: category.documents.map((d, i) => `${i+1}. [ID: ${d.id}] 名称: ${d.name} \n   摘要: ${d.summary}`).join('\n'),
          query
        });

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

      const finalPrompt = PromptService.getInstance().getPrompt('knowledge_final', {
        today,
        context: fullContents.join('\n\n---\n\n'),
        query
      });

      const finalResult = await this.agentService.runAgent('knowledge_assistant', finalPrompt, undefined, { silent: true, noTools: true });
      return finalResult.content;

    } catch (error: any) {
      LogService.error(`Knowledge progressive query failed: ${error.message}`);
      return `知识库检索失败: ${error.message}`;
    }
  }
}
