import { request } from './api';

export interface HistoryResponse {
  dates: string[];
}

export interface CommitRecord {
  id: number;
  date: string;
  platform: string;
  filePath: string;
  commitMessage: string;
  commitTime: number;
  fullContent?: string;
  viewUrl?: string;
}

export interface CommitHistoryResponse {
  commits: CommitRecord[];
  total: number;
}

export interface CommittedDatesResponse {
  dates: string[];
}

export const getHistory = (): Promise<HistoryResponse> => request('/api/history');

export const getCommitHistory = (params?: {
  date?: string;
  platform?: string;
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<CommitHistoryResponse> => {
  const queryParams = new URLSearchParams();
  if (params?.date) queryParams.append('date', params.date);
  if (params?.platform) queryParams.append('platform', params.platform);
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.offset) queryParams.append('offset', params.offset.toString());
  if (params?.search) queryParams.append('search', params.search);
  
  const queryString = queryParams.toString();
  return request(`/api/history/commits${queryString ? `?${queryString}` : ''}`);
};

export const getCommittedDates = (): Promise<CommittedDatesResponse> => request('/api/history/dates');

export const deleteCommitHistory = (id: number): Promise<{ status: string }> => 
  request(`/api/history/commits/${id}`, { method: 'DELETE' });

export const republishCommitHistory = (id: number): Promise<{ status: string, data?: any }> => 
  request(`/api/history/republish/${id}`, { method: 'POST' });
