/**
 * Domain-oriented SQLite repositories for LocalStore.
 * LocalStore remains the public facade used across the app.
 */
import type { Database } from 'sqlite';

export type Db = Database;

export function requireDb(db: Db | null): Db {
  if (!db) throw new Error('Database not initialized');
  return db;
}
