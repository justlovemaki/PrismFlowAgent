import type { Db } from './db.js';
import { requireDb } from './db.js';

export class EntityJsonRepository {
  constructor(
    private getDb: () => Db | null,
    private table: string
  ) {}

  async save(entity: { id: string } & Record<string, unknown>): Promise<void> {
    const db = requireDb(this.getDb());
    await db.run(
      `INSERT OR REPLACE INTO ${this.table} (id, data) VALUES (?, ?)`,
      entity.id,
      JSON.stringify(entity)
    );
  }

  async get(id: string): Promise<any | null> {
    const db = requireDb(this.getDb());
    const row = await db.get(`SELECT data FROM ${this.table} WHERE id = ?`, id);
    return row ? JSON.parse(row.data) : null;
  }

  async list(orderBy = 'rowid DESC'): Promise<any[]> {
    const db = requireDb(this.getDb());
    const rows = await db.all(`SELECT data FROM ${this.table} ORDER BY ${orderBy}`);
    return (rows || []).map((row) => JSON.parse(row.data));
  }

  async delete(id: string): Promise<void> {
    const db = requireDb(this.getDb());
    await db.run(`DELETE FROM ${this.table} WHERE id = ?`, id);
  }
}
