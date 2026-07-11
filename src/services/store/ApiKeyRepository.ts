import type { Db } from './db.js';
import { requireDb } from './db.js';

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;
  sourceFingerprint?: string;
  verificationToken?: string;
  status?: string;
  createdAt?: number;
}

export class ApiKeyRepository {
  constructor(private getDb: () => Db | null) {}

  async list(): Promise<Array<{
    id: string;
    name: string;
    prefix: string;
    sourceFingerprint: string | null;
    status: string;
    createdAt: number;
    lastUsedAt: number | null;
  }>> {
    const db = requireDb(this.getDb());
    const rows = await db.all('SELECT * FROM api_keys ORDER BY created_at DESC');
    return (rows || []).map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      sourceFingerprint: row.source_fingerprint,
      status: row.status,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  async save(apiKey: ApiKeyRecord): Promise<void> {
    const db = requireDb(this.getDb());
    await db.run(
      `INSERT OR REPLACE INTO api_keys (
        id, name, key_hash, prefix, source_fingerprint, verification_token, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      apiKey.id,
      apiKey.name,
      apiKey.keyHash,
      apiKey.prefix,
      apiKey.sourceFingerprint || null,
      apiKey.verificationToken || null,
      apiKey.status || 'pending',
      apiKey.createdAt || Date.now()
    );
  }

  async getByVerificationToken(token: string): Promise<any | null> {
    const db = requireDb(this.getDb());
    return (await db.get('SELECT * FROM api_keys WHERE verification_token = ?', token)) || null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const db = requireDb(this.getDb());
    await db.run('UPDATE api_keys SET status = ? WHERE id = ?', status, id);
  }

  async updateName(id: string, name: string): Promise<void> {
    const db = requireDb(this.getDb());
    await db.run('UPDATE api_keys SET name = ? WHERE id = ?', name, id);
  }

  async getByFingerprint(fingerprint: string): Promise<any | null> {
    const db = requireDb(this.getDb());
    return (await db.get('SELECT * FROM api_keys WHERE source_fingerprint = ?', fingerprint)) || null;
  }

  async delete(id: string): Promise<void> {
    const db = requireDb(this.getDb());
    await db.run('DELETE FROM api_keys WHERE id = ?', id);
  }

  async getByPrefix(prefix: string): Promise<any[]> {
    const db = requireDb(this.getDb());
    return (await db.all('SELECT * FROM api_keys WHERE prefix = ?', prefix)) || [];
  }

  async updateLastUsed(id: string): Promise<void> {
    const db = requireDb(this.getDb());
    await db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', Date.now(), id);
  }
}
