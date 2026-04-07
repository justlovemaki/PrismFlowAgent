import { request } from './api';

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
  type: string;
  summary: string;
  chunkCount: number;
  metadata: any;
  createdAt: number;
}

export const knowledgeService = {
  getCategories: (): Promise<KBCategory[]> => request('/api/kb/categories'),
  
  addCategory: (name: string, description: string = ''): Promise<{ id: string }> => 
    request('/api/kb/categories', {
      method: 'POST',
      body: JSON.stringify({ name, description })
    }),

  deleteCategory: (id: string): Promise<{ status: string }> =>
    request(`/api/kb/categories/${id}`, {
      method: 'DELETE'
    }),

  updateCategory: (id: string, name: string, description: string): Promise<{ status: string }> =>
    request(`/api/kb/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description })
    }),

  mergeCategories: (ids: string[], targetName: string, targetDescription: string): Promise<{ id: string }> =>
    request('/api/kb/categories/merge', {
      method: 'POST',
      body: JSON.stringify({ ids, targetName, targetDescription })
    }),

  getDocuments: (categoryId: string): Promise<KBDocument[]> => 
    request(`/api/kb/documents?categoryId=${categoryId}`),

  uploadDocument: async (categoryId: string, file: File): Promise<{ id: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('categoryId', categoryId);
    
    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch('/api/kb/documents', {
      method: 'POST',
      headers,
      body: formData,
    });

    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    
    return response.json();
  },

  deleteDocument: (id: string): Promise<{ status: string }> => 
    request(`/api/kb/documents/${id}`, {
      method: 'DELETE'
    }),

  moveDocumentToMemory: (id: string): Promise<{ status: string, memoryId: string }> =>
    request(`/api/kb/documents/${id}/move-to-memory`, {
      method: 'POST'
    }),

  getDocumentContent: (id: string): Promise<{ content: string }> => request(`/api/kb/documents/${id}/content`),

  updateDocumentContent: (id: string, content: string): Promise<{ status: string }> =>
    request(`/api/kb/documents/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    }),

  queryKnowledge: (query: string, categoryIds?: string[], limit: number = 3): Promise<{ answer: string }> => 
    request('/api/kb/query', {
      method: 'POST',
      body: JSON.stringify({ query, categoryIds, limit })
    }),

  // Memory API
  getMemoryCategories: (): Promise<KBCategory[]> => request('/api/memory/categories'),
  
  addMemoryCategory: (name: string, description: string = ''): Promise<{ id: string }> =>
    request('/api/memory/categories', {
      method: 'POST',
      body: JSON.stringify({ name, description })
    }),

  getMemoryCategoryDetails: (id: string): Promise<any> => request(`/api/memory/categories/${id}`),

  deleteMemoryCategory: (id: string): Promise<{ status: string }> => request(`/api/memory/categories/${id}`, {
    method: 'DELETE'
  }),

  updateMemoryCategory: (id: string, name: string, description: string): Promise<{ status: string }> =>
    request(`/api/memory/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description })
    }),

  mergeMemoryCategories: (ids: string[], targetName: string, targetDescription: string): Promise<{ id: string }> =>
    request('/api/memory/categories/merge', {
      method: 'POST',
      body: JSON.stringify({ ids, targetName, targetDescription })
    }),

  moveMemoryToCategory: (id: string, targetCategoryId: string): Promise<{ status: string }> =>
    request(`/api/memory/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetCategoryId })
    }),

  getMemoryContent: (id: string): Promise<{ content: string }> => request(`/api/memory/${id}/content`),

  updateMemoryContent: (id: string, content: string): Promise<{ status: string }> =>
    request(`/api/memory/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    }),

  queryMemory: (query: string, categoryIds?: string[], limit: number = 3): Promise<{ answer: string }> => 
    request('/api/memory/query', {
      method: 'POST',
      body: JSON.stringify({ query, categoryIds, limit })
    }),

  deleteMemory: (id: string): Promise<{ status: string }> => 
    request(`/api/memory/${id}`, {
      method: 'DELETE'
    }),

  mergeMemories: (ids: string[], targetCategoryId?: string): Promise<{ id: string }> =>
    request('/api/memory/merge', {
      method: 'POST',
      body: JSON.stringify({ ids, targetCategoryId })
    })
};

