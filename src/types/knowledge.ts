export interface KBCategory {
  id: string;
  name: string;
  description: string;
  documentCount: number;
  lastUpdatedAt: number;
}

export interface KBDocument {
  id: string;
  categoryId: string;
  name: string;
  fileName: string;
  type: string; // 'pdf' | 'md' | 'txt' | 'docx'
  summary: string;
  chunkCount: number;
  metadata: {
    originalPath?: string;
    sourceUrl?: string;
    fileSize?: number;
    [key: string]: any;
  };
  createdAt: number;
  updatedAt: number;
}

export interface KBChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
  metadata?: any;
}

export interface KBIndex {
  version: string;
  categories: KBCategory[];
  updatedAt: number;
}

export interface KBCategoryIndex {
  id: string;
  name: string;
  description: string;
  documents: KBDocumentSummary[];
  updatedAt: number;
}

export interface KBDocumentSummary {
  id: string;
  name: string;
  type: string;
  summary: string;
  chunkCount: number;
  createdAt: number;
}

export interface IKnowledgeBaseService {
  getCategories(): Promise<KBCategory[]>;
  addCategory(name: string, description?: string): Promise<string>;
  deleteCategory(id: string): Promise<void>;
  updateCategory(id: string, name: string, description?: string): Promise<void>;
  mergeCategories(ids: string[], targetName: string, targetDescription?: string): Promise<string>;
  getDocuments(categoryId: string): Promise<KBDocument[]>;
  addDocument(categoryId: string, file: { name: string; path: string; buffer: Buffer }): Promise<string>;
  deleteDocument(id: string): Promise<void>;
  updateDocumentContent(id: string, content: string): Promise<void>;
  getDocumentFullText(id: string): Promise<string>;
  queryKnowledge(query: string, options?: { categoryIds?: string[]; limit?: number }): Promise<string>;
}
