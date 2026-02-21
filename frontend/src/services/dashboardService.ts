import { request } from './api';

export const getStats = () => request('/api/dashboard/stats');
export const getAdapters = () => request('/api/dashboard/adapters');
export const syncAdapter = (name: string, config: any = {}) => 
  request(`/api/dashboard/adapters/${encodeURIComponent(name)}/sync`, { 
    method: 'POST', 
    body: JSON.stringify(config) 
  });
export const clearAdapterData = (name: string, date?: string) => 
  request(`/api/dashboard/adapters/${encodeURIComponent(name)}/clear`, { 
    method: 'POST', 
    body: JSON.stringify({ date }) 
  });
export const getLogs = () => request('/api/dashboard/logs');
export const triggerIngestion = () => request('/writeData', { method: 'POST', body: JSON.stringify({}) });
export const testAI = () => request('/api/dashboard/test-ai', { method: 'POST', body: JSON.stringify({}) });
