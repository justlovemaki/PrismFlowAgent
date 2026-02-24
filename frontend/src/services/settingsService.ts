import { request } from './api';

export const getSettings = () => request('/api/settings');
export const saveSettings = (settings: any) => request('/api/settings', { method: 'POST', body: JSON.stringify(settings) });
export const getModels = (config: any) => request('/api/ai/models', { method: 'POST', body: JSON.stringify(config) });
export const testProvider = (config: any) => request('/api/ai/test', { method: 'POST', body: JSON.stringify(config) });
export const getPluginMetadata = () => request('/api/plugins/metadata');
export const importOPML = (opmlContent: string, adapterId?: string) => request('/api/adapters/import-opml', { method: 'POST', body: JSON.stringify({ opmlContent, adapterId }) });
