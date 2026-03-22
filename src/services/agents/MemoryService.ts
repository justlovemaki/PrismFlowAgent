import { LocalStore } from '../LocalStore.js';
import { AgentService } from './AgentService.js';
import { IMemoryService } from '../../types/memory.js';
import { SqliteMemoryService } from './SqliteMemoryService.js';
import { HierarchicalMemoryService } from './HierarchicalMemoryService.js';
import { LogService } from '../LogService.js';

export class MemoryService implements IMemoryService {
  private activeService: IMemoryService;
  private sqliteService: SqliteMemoryService;
  private hierarchicalService: HierarchicalMemoryService;
  private store: LocalStore;

  constructor(store: LocalStore, agentService: AgentService | null) {
    this.store = store;
    this.sqliteService = new SqliteMemoryService(store, agentService);
    this.hierarchicalService = new HierarchicalMemoryService(store, agentService);
    
    // 默认初始化为 Hierarchical，稍后在 initServices 中根据配置切换
    this.activeService = this.hierarchicalService;
  }

  /**
   * 根据配置切换活跃的记忆系统
   */
  async switchSystem(type: 'sqlite' | 'hierarchical') {
    if (type === 'hierarchical') {
      this.activeService = this.hierarchicalService;
      LogService.info('Memory system switched to: Hierarchical (PageIndex)');
    } else {
      this.activeService = this.sqliteService;
      LogService.info('Memory system switched to: SQLite (FTS5)');
    }
  }

  async saveMemory(content: string, options?: any): Promise<string> {
    return this.activeService.saveMemory(content, options);
  }

  async queryMemory(query: string, options?: any): Promise<string> {
    return this.activeService.queryMemory(query, options);
  }

  async deleteMemory(id: string): Promise<void> {
    return this.activeService.deleteMemory(id);
  }

  async migrateFromSqlite(): Promise<void> {
    if (this.activeService instanceof HierarchicalMemoryService) {
      return this.activeService.migrateFromSqlite();
    }
    LogService.warn('Migration only supported when Hierarchical system is active.');
  }
}
