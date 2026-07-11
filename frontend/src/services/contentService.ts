import { request } from './api';

export const getContent = (date?: string) => request(`/api/content${date ? `?date=${date}` : ''}`);

/** 获取单条完整内容（含 content_html / full_content） */
export const getContentItem = (id: string) => request(`/api/content/item/${encodeURIComponent(id)}`);

export const publishContent = (id: string, data: { content: string, [key: string]: any }) =>
  request(`/api/publish/${id}`, { method: 'POST', body: JSON.stringify(data) });

export const generateCoverImage = (prompt: string, agentId: string, date: string, content?: string) =>
  request(`/api/content/${date}/regenerate`, { method: 'POST', body: JSON.stringify({ prompt, agentId, type: 'cover', content }) });

export const uploadWechatMaterial = (url: string) =>
  request('/api/wechat/upload-material', { method: 'POST', body: JSON.stringify({ url }) });

export const writeData = (date: string) =>
  request('/api/dashboard/ingest', { method: 'POST', body: JSON.stringify({ date }) });

export const deleteContent = (id: string) =>
  request(`/api/content/${id}`, { method: 'DELETE' });

export const regenerateSummary = (id: string, agentId: string) =>
  request(`/api/content/${id}/regenerate`, { method: 'POST', body: JSON.stringify({ agentId }) });
