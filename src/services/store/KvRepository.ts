import type { Db } from './db.js';
import { requireDb } from './db.js';

export class KvRepository {
  constructor(private getDb: () => Db | null) {}

  async get(key: string): Promise<unknown> {
    const db = requireDb(this.getDb());
    const row = await db.get('SELECT value, expires_at FROM kv WHERE key = ?', key);
    if (!row) return null;
    if (row.expires_at && row.expires_at < Date.now()) {
      await this.delete(key);
      return null;
    }
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  async put(key: string, value: unknown, expirationTtl?: number): Promise<void> {
    const db = requireDb(this.getDb());
    const valStr = typeof value === 'string' ? value : JSON.stringify(value);
    const expiresAt = expirationTtl ? Date.now() + expirationTtl * 1000 : null;
    await db.run(
      'INSERT OR REPLACE INTO kv (key, value, expires_at) VALUES (?, ?, ?)',
      key,
      valStr,
      expiresAt
    );
  }

  async delete(key: string): Promise<void> {
    const db = requireDb(this.getDb());
    await db.run('DELETE FROM kv WHERE key = ?', key);
  }

  async getAllKeys(): Promise<string[]> {
    const db = requireDb(this.getDb());
    const rows = await db.all('SELECT key FROM kv');
    return (rows || []).map((row) => row.key as string);
  }
}
