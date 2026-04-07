import { LocalStore } from '../LocalStore.js';
import { AgentService } from '../agents/AgentService.js';
import { IKnowledgeBaseService, KBCategory, KBDocument } from '../../types/knowledge.js';
import { HierarchicalKnowledgeService } from './HierarchicalKnowledgeService.js';
import { SqliteKnowledgeService } from './SqliteKnowledgeService.js';
import { LogService } from '../LogService.js';

export class KnowledgeBaseService implements IKnowledgeBaseService {
  private activeService: IKnowledgeBaseService;
  private hierarchicalService: HierarchicalKnowledgeService;
  private sqliteService: SqliteKnowledgeService;

  constructor(store: LocalStore, agentService: AgentService | null) {
    this.hierarchicalService = new HierarchicalKnowledgeService(store, agentService);
    this.sqliteService = new SqliteKnowledgeService(store, agentService);
    
    // 默认初始化为 Hierarchical，稍后在 initServices 中根据配置切换
    this.activeService = this.hierarchicalService;
  }

  /**
   * 根据配置切换活跃的知识库系统
   */
  async switchSystem(type: 'sqlite' | 'hierarchical') {
    if (type === 'hierarchical') {
      this.activeService = this.hierarchicalService;
      LogService.info('Knowledge system switched to: Hierarchical (PageIndex)');
    } else {
      this.activeService = this.sqliteService;
      LogService.info('Knowledge system switched to: SQLite (FTS5)');
    }
  }

  async getCategories(): Promise<KBCategory[]> {
    return this.activeService.getCategories();
  }

  async addCategory(name: string, description?: string): Promise<string> {
    return this.activeService.addCategory(name, description);
  }

  async deleteCategory(id: string): Promise<void> {
    return this.activeService.deleteCategory(id);
  }

  async updateCategory(id: string, name: string, description?: string): Promise<void> {
    return this.activeService.updateCategory(id, name, description);
  }

  async mergeCategories(ids: string[], targetName: string, targetDescription?: string): Promise<string> {
    return this.activeService.mergeCategories(ids, targetName, targetDescription);
  }

  async getDocuments(categoryId: string): Promise<KBDocument[]> {
    return this.activeService.getDocuments(categoryId);
  }

  async addDocument(categoryId: string, file: { name: string; path: string; buffer: Buffer }): Promise<string> {
    return this.activeService.addDocument(categoryId, file);
  }

  async deleteDocument(id: string): Promise<void> {
    return this.activeService.deleteDocument(id);
  }

  async updateDocumentContent(id: string, content: string): Promise<void> {
    return this.activeService.updateDocumentContent(id, content);
  }

  async getDocumentFullText(id: string): Promise<string> {
    return this.activeService.getDocumentFullText(id);
  }

  async queryKnowledge(query: string, options?: { categoryIds?: string[]; limit?: number }): Promise<string> {
    return this.activeService.queryKnowledge(query, options);
  }
}
