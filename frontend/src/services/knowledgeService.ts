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

  queryKnowledge: (query: string, categoryIds?: string[], limit: number = 3): Promise<{ answer: string }> => 
    request('/api/kb/query', {
      method: 'POST',
      body: JSON.stringify({ query, categoryIds, limit })
    })
};
