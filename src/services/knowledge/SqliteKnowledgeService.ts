import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { 
  IKnowledgeBaseService, 
  KBCategory, 
  KBDocument, 
  KBChunk 
} from '../../types/knowledge.js';
import { typeid } from 'typeid-js';
import { LogService } from '../LogService.js';
import { DocumentProcessor } from './DocumentProcessor.js';
import crypto from 'crypto';

export class SqliteKnowledgeService implements IKnowledgeBaseService {
  private store: LocalStore;
  private agentService: AgentService | null;
  private processor: DocumentProcessor;

  constructor(store: LocalStore, agentService: AgentService | null) {
    this.store = store;
    this.agentService = agentService;
    this.processor = new DocumentProcessor();
  }

  async getCategories(): Promise<KBCategory[]> {
    return await this.store.listKBCategories();
  }

  async addCategory(name: string, description: string = ''): Promise<string> {
    const id = name.toLowerCase().replace(/\s+/g, '_');
    const existing = await this.store.getKBCategory(id);
    if (existing) return id;

    await this.store.saveKBCategory({
      id,
      name,
      description,
      documentCount: 0,
      updatedAt: Date.now()
    });
    return id;
  }

  async deleteCategory(id: string): Promise<void> {
    const documents = await this.store.listKBDocuments(id);
    for (const document of documents) {
      await this.deleteDocument(document.id);
    }
    await this.store.deleteKBCategory(id);
  }

  async getDocuments(categoryId: string): Promise<KBDocument[]> {
    return await this.store.listKBDocuments(categoryId);
  }

  async addDocument(categoryId: string, file: { name: string; path: string; buffer: Buffer }): Promise<string> {
    // 1. Parse Document
    const processed = await this.processor.parse(file.name, file.buffer);
    
    // 2. Chunk Document
    const chunks = this.processor.chunk(processed.text);
    
    // 3. Generate Summary
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
    const docId = typeid('kb').toString();
    const doc: KBDocument = {
      id: docId,
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

    // 5. Save Document to SQLite
    await this.store.saveKBDocument(doc);
    
    // 6. Save Chunks to SQLite
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = typeid('chunk').toString();
      await this.store.saveKBChunk({
        id: chunkId,
        documentId: docId,
        content: chunks[i],
        index: i,
        metadata: {}
      });
    }

    // 7. Update Category count
    const category = await this.store.getKBCategory(categoryId);
    if (category) {
      category.documentCount = (await this.store.listKBDocuments(categoryId)).length;
      category.updatedAt = Date.now();
      await this.store.saveKBCategory(category);
    }

    return docId;
  }

  async deleteDocument(id: string): Promise<void> {
    const doc = await this.store.getKBDocument(id);
    if (!doc) return;

    await this.store.deleteKBDocument(id);

    // Update Category count
    const category = await this.store.getKBCategory(doc.categoryId);
    if (category) {
      category.documentCount = (await this.store.listKBDocuments(doc.categoryId)).length;
      category.updatedAt = Date.now();
      await this.store.saveKBCategory(category);
    }
  }

  async getDocumentFullText(id: string): Promise<string> {
    const chunks = await this.store.listKBChunks(id);
    if (chunks.length === 0) return '文档内容未找到';
    return chunks.map(c => c.content).join('\n');
  }

  async queryKnowledge(query: string, options: { categoryIds?: string[]; limit?: number } = {}): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    
    // 1. Search relevant chunks from SQLite FTS5
    const searchResults = await this.store.searchKBChunks(query, {
      categoryIds: options.categoryIds,
      limit: options.limit || 5
    });

    if (searchResults.length === 0) {
      return "抱歉，知识库中暂时没有找到与您查询相关的内容。";
    }

    // 2. Prepare context for AI
    const fullContents = searchResults.map((res, i) => {
      return `[结果 ${i+1}] 来自文档: ${res.docName}\n${res.content}`;
    });

    if (!this.agentService) {
      return "AgentService 不可用，以下为检索到的原始片段：\n\n" + fullContents.join('\n\n---\n\n');
    }

    const finalPrompt = `你是一个严谨的知识库专家。请根据以下提供的文档内容片段，回答用户的查询。
当前日期：${today}

文档内容片段：
${fullContents.join('\n\n---\n\n')}

用户查询：
"${query}"

注意（必须严格遵守）：
1. **完全基于文档**：仅根据提供的文档内容进行回答。
2. **禁止回退到自身知识**：如果文档中没有包含查询所需的答案，你必须诚实地回答：“抱歉，提供的文档中没有关于此问题的相关信息。”，**严禁**使用你自己的预训练知识来补全。
3. **时间校验**：注意查询中的时间范围（如“上周”）。如果检索到的文档日期不匹配，请明确指出。
4. **结构化**：使用列表或清晰的段落进行回答，并注明信息来源。`;

    try {
      const finalResult = await this.agentService.runAgent('knowledge_assistant', finalPrompt, undefined, { silent: true, noTools: true });
      return finalResult.content;
    } catch (error: any) {
      LogService.error(`Sqlite Knowledge query AI synthesis failed: ${error.message}`);
      return "知识库检索汇总失败，以下为相关文档片段：\n\n" + fullContents.join('\n\n---\n\n');
    }
  }
}
