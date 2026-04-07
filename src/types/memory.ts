export interface MemoryEntry {
  id: string;
  agentId?: string;
  content: string;
  importance: number; // 1-5
  tags: string[];
  metadata?: any;
  createdAt: number;
}

export interface MemorySearchOptions {
  agentId?: string;
  tags?: string[];
  limit?: number;
  minImportance?: number;
}

export interface MemorySearchResult extends MemoryEntry {
  rank: number;
  snippet?: string;
}

/**
 * 记忆服务接口
 */
export interface IMemoryService {
  saveMemory(content: string, options?: { 
    agentId?: string; 
    importance?: number; 
    tags?: string[];
    metadata?: any;
  }): Promise<string>;

  queryMemory(query: string, options?: {
    agentId?: string;
    limit?: number;
    minImportance?: number;
  }): Promise<string>;

  deleteMemory(id: string): Promise<void>;
  updateMemoryContent(id: string, content: string): Promise<void>;
  getMemoryFullText(id: string): Promise<string>;
  
  getCategories(): Promise<MemoryCategorySummary[]>;
  getCategoryDetails(id: string): Promise<MemoryCategoryIndex | null>;
  deleteCategory(id: string): Promise<void>;
  updateCategory(id: string, name: string, description?: string): Promise<void>;
  addCategory(name: string, description?: string): Promise<string>;
  moveMemoryToCategory(memoryId: string, targetCategoryId: string): Promise<void>;

  /**
   * 合并多条记忆
   */
  mergeMemories(ids: string[], options?: { 
    agentId?: string;
    targetCategoryId?: string;
  }): Promise<string>;

  /**
   * 合并多个记忆主题
   */
  mergeCategories(ids: string[], targetName: string, targetDescription?: string): Promise<string>;

  // 用于迁移
  migrateFromSqlite?(): Promise<void>;
}

/**
 * 记忆索引：顶层根节点 (root.json)
 */
export interface MemoryRootIndex {
  version: string;
  categories: MemoryCategorySummary[];
  updatedAt: number;
}

/**
 * 分类摘要：保存在根索引中
 */
export interface MemoryCategorySummary {
  id: string;
  name: string;
  description: string; // 由 LLM 生成的该分类下所有记忆的语义摘要
  entryCount: number;
  lastUpdatedAt: number;
}

/**
 * 分类详情索引：(categories/<id>.json)
 */
export interface MemoryCategoryIndex {
  id: string;
  name: string;
  description: string;
  entries: MemoryEntrySummary[];
  updatedAt: number;
}

/**
 * 条目摘要：保存在分类索引中
 */
export interface MemoryEntrySummary {
  id: string;
  summary: string; // 1-2 句话的简炼摘要
  importance: number;
  tags: string[];
  hash?: string; // 用于内容去重
  createdAt: number;
}
