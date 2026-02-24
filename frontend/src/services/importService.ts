import { request } from './api';

export interface ImportPayload {
  url?: string;
  title?: string;
  content?: string;
  json?: string;
}

export type ImportMode = 'URL' | 'TEXT' | 'JSON';

export const genericImport = (mode: ImportMode, categoryId: string, payload: ImportPayload) => {
  return request('/api/import', {
    method: 'POST',
    body: JSON.stringify({
      mode,
      categoryId,
      payload
    })
  });
};
