import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { UnifiedData } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LocalStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    // 优先使用传入的路径，其次使用环境变量，最后使用默认路径
    let finalPath = dbPath || process.env.DATABASE_PATH;
    
    if (!finalPath) {
      // 在打包环境中，尝试在多个位置查找或创建数据目录
      const possibleDataDirs = [
        path.join(process.cwd(), 'data'),
        path.join(__dirname, '..', 'data'),
        path.join(__dirname, '..', '..', 'data'),
      ];

      let dataDir = possibleDataDirs[0]; // 默认使用第一个
      
      // 尝试找到一个可写的目录
      for (const dir of possibleDataDirs) {
        try {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          // 测试是否可写
          const testFile = path.join(dir, '.write-test');
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);
          dataDir = dir;
          console.log(`Using data directory: ${dataDir}`);
          break;
        } catch (err) {
          console.warn(`Cannot use directory ${dir}:`, err);
        }
      }

      finalPath = path.join(dataDir, 'database.sqlite');
    }

    this.dbPath = path.resolve(finalPath);
    console.log(`Database path: ${this.dbPath}`);

    // 确保数据库目录存在
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      try {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log(`Created database directory: ${dbDir}`);
      } catch (err) {
        console.error(`Failed to create database directory: ${dbDir}`, err);
        throw err;
      }
    }
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  async init() {
    try {
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT,
          expires_at INTEGER
        )
      `);

      // 创建历史提交记录表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS commit_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          platform TEXT NOT NULL,
          file_path TEXT NOT NULL,
          commit_message TEXT,
          commit_time INTEGER NOT NULL,
          full_content TEXT
        )
      `);

      // 创建 Agent 相关表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        )
      `);

      // 创建记忆相关表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory_categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          entry_count INTEGER DEFAULT 0,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_memories (
          id TEXT PRIMARY KEY,
          agent_id TEXT,
          category_id TEXT,
          content TEXT NOT NULL,
          importance INTEGER DEFAULT 1,
          tags TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (category_id) REFERENCES memory_categories(id) ON DELETE SET NULL
        )
      `);

      // 创建 FTS5 虚表 (使用 content='agent_memories' 建立内容联动)
      // 注意：FTS5 在某些环境下可能由于外部内容表限制而无法通过 rowid 直接映射
      // 我们这里使用一个简单的虚表并由触发器保持同步
      await this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS agent_memories_fts USING fts5(
          id UNINDEXED,
          content,
          tags,
          tokenize='unicode61'
        )
      `);

      // 保持同步的触发器
      await this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_mem_ai AFTER INSERT ON agent_memories BEGIN
          INSERT INTO agent_memories_fts(id, content, tags) VALUES (new.id, new.content, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_mem_ad AFTER DELETE ON agent_memories BEGIN
          DELETE FROM agent_memories_fts WHERE id = old.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trg_mem_au AFTER UPDATE ON agent_memories BEGIN
          DELETE FROM agent_memories_fts WHERE id = old.id;
          INSERT INTO agent_memories_fts(id, content, tags) VALUES (new.id, new.content, new.tags);
        END;
      `);

      // 创建知识库相关表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS kb_categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          document_count INTEGER DEFAULT 0,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS kb_documents (
          id TEXT PRIMARY KEY,
          category_id TEXT NOT NULL,
          name TEXT NOT NULL,
          file_name TEXT NOT NULL,
          type TEXT NOT NULL,
          summary TEXT,
          chunk_count INTEGER DEFAULT 0,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (category_id) REFERENCES kb_categories(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS kb_chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          content TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          metadata TEXT,
          FOREIGN KEY (document_id) REFERENCES kb_documents(id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
          id UNINDEXED,
          content,
          tokenize='unicode61'
        );
      `);

      // 保持同步的触发器 (知识库)
      await this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
          INSERT INTO kb_chunks_fts(id, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
          DELETE FROM kb_chunks_fts WHERE id = old.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trg_kb_chunks_au AFTER UPDATE ON kb_chunks BEGIN
          DELETE FROM kb_chunks_fts WHERE id = old.id;
          INSERT INTO kb_chunks_fts(id, content) VALUES (new.id, new.content);
        END;
      `);

      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        )
      `);

      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        )
      `);

      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS mcp_configs (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        )
      `);

      // 创建调度配置表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at INTEGER
        )
      `);

      // 创建执行日志记录表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS task_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          task_name TEXT,
          start_time TEXT NOT NULL,
          end_time TEXT,
          duration INTEGER,
          status TEXT NOT NULL,
          progress INTEGER DEFAULT 0,
          message TEXT,
          result_count INTEGER
        )
      `);

      // 创建数据源数据存储表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS source_data (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          url TEXT,
          description TEXT,
          published_date TEXT,
          source TEXT NOT NULL,
          category TEXT,
          author TEXT,
          metadata TEXT,
          fetched_at INTEGER NOT NULL,
          ingestion_date TEXT,
          adapter_name TEXT,
          status TEXT DEFAULT 'unread'
        )
      `);

      // 创建索引
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source_data_source ON source_data(source)`);
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source_data_fetched_at ON source_data(fetched_at)`);
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source_data_status ON source_data(status)`);
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source_data_ingestion_date ON source_data(ingestion_date)`);
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source_data_published_date ON source_data(published_date)`);
      
      // --- 升级：资讯数据全文搜索 (FTS5) ---
      await this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS source_data_fts USING fts5(
          id UNINDEXED,
          title,
          description,
          ai_summary,
          tokenize='unicode61'
        );
      `);

      // 保持同步的触发器 (资讯数据)
      await this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_source_data_ai AFTER INSERT ON source_data BEGIN
          INSERT INTO source_data_fts(id, title, description, ai_summary) 
          VALUES (new.id, new.title, new.description, json_extract(new.metadata, '$.ai_summary'));
        END;
        CREATE TRIGGER IF NOT EXISTS trg_source_data_ad AFTER DELETE ON source_data BEGIN
          DELETE FROM source_data_fts WHERE id = old.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trg_source_data_au AFTER UPDATE ON source_data BEGIN
          DELETE FROM source_data_fts WHERE id = old.id;
          INSERT INTO source_data_fts(id, title, description, ai_summary) 
          VALUES (new.id, new.title, new.description, json_extract(new.metadata, '$.ai_summary'));
        END;
      `);

      // 初始化同步：如果 FTS 表为空但主表有数据，进行一次全量同步
      const ftsCount = await this.db.get('SELECT COUNT(*) as count FROM source_data_fts');
      if (ftsCount?.count === 0) {
        console.log('Initializing source_data_fts index...');
        await this.db.exec(`
          INSERT INTO source_data_fts(id, title, description, ai_summary)
          SELECT id, title, description, json_extract(metadata, '$.ai_summary') FROM source_data
        `);
      }

      // 系统启动时，将所有运行中的任务状态设置为中断
      await this.db.exec(`UPDATE task_logs SET status = 'interrupted', message = '系统重启导致任务中断' WHERE status = 'running'`);

      // 创建 API Key 表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          key_hash TEXT NOT NULL,
          prefix TEXT NOT NULL,
          source_fingerprint TEXT,
          verification_token TEXT,
          status TEXT DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          last_used_at INTEGER
        )
      `);

      console.log('Database initialized successfully');

    } catch (err) {
      console.error('Failed to initialize database:', err);
      throw err;
    }
  }

  async get(key: string): Promise<any> {
    const row = await this.db?.get('SELECT value, expires_at FROM kv WHERE key = ?', key);
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

  async put(key: string, value: any, expirationTtl?: number): Promise<void> {
    const valStr = typeof value === 'string' ? value : JSON.stringify(value);
    const expiresAt = expirationTtl ? Date.now() + expirationTtl * 1000 : null;
    await this.db?.run(
      'INSERT OR REPLACE INTO kv (key, value, expires_at) VALUES (?, ?, ?)',
      key, valStr, expiresAt
    );
  }

  async delete(key: string): Promise<void> {
    await this.db?.run('DELETE FROM kv WHERE key = ?', key);
  }

  async getAllKeys(): Promise<string[]> {
    const rows = await this.db?.all('SELECT key FROM kv');
    return (rows || []).map(row => row.key);
  }

  /**
   * 保存提交历史记录
   */
  async saveCommitHistory(record: {
    date: string;
    platform: string;
    filePath: string;
    commitMessage?: string;
    fullContent?: string;
  }): Promise<void> {
    await this.db?.run(
      `INSERT INTO commit_history (date, platform, file_path, commit_message, commit_time, full_content)
       VALUES (?, ?, ?, ?, ?, ?)`,
      record.date,
      record.platform,
      record.filePath,
      record.commitMessage || '',
      Date.now(),
      record.fullContent || ''
    );
  }

  /**
   * 根据 ID 获取单条提交历史记录
   */
  async getCommitHistoryById(id: number): Promise<{
    id: number;
    date: string;
    platform: string;
    filePath: string;
    commitMessage: string;
    commitTime: number;
    fullContent: string;
  } | null> {
    const row = await this.db?.get('SELECT * FROM commit_history WHERE id = ?', id);
    if (!row) return null;
    return {
      id: row.id,
      date: row.date,
      platform: row.platform,
      filePath: row.file_path,
      commitMessage: row.commit_message,
      commitTime: row.commit_time,
      fullContent: row.full_content || ''
    };
  }

  /**
   * 查询提交历史记录
   */
  async getCommitHistory(options?: {
    date?: string;
    dates?: string[];
    platform?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<{
    records: Array<{
      id: number;
      date: string;
      platform: string;
      filePath: string;
      commitMessage: string;
      commitTime: number;
      fullContent: string;
    }>;
    total: number;
  }> {
    let query = 'SELECT * FROM commit_history WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM commit_history WHERE 1=1';
    const params: any[] = [];
    const countParams: any[] = [];

    if (options?.date) {
      query += ' AND date = ?';
      countQuery += ' AND date = ?';
      params.push(options.date);
      countParams.push(options.date);
    }

    if (options?.dates && options.dates.length > 0) {
      const placeholders = options.dates.map(() => '?').join(',');
      query += ` AND date IN (${placeholders})`;
      countQuery += ` AND date IN (${placeholders})`;
      params.push(...options.dates);
      countParams.push(...options.dates);
    }

    if (options?.platform) {
      query += ' AND platform = ?';
      countQuery += ' AND platform = ?';
      params.push(options.platform);
      countParams.push(options.platform);
    }

    if (options?.search) {
      const searchPattern = `%${options.search}%`;
      query += ' AND (date LIKE ? OR platform LIKE ? OR file_path LIKE ? OR commit_message LIKE ?)';
      countQuery += ' AND (date LIKE ? OR platform LIKE ? OR file_path LIKE ? OR commit_message LIKE ?)';
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += ' ORDER BY commit_time DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const [rows, countResult] = await Promise.all([
      this.db?.all(query, ...params),
      this.db?.get(countQuery, ...countParams)
    ]);

    return {
      records: (rows || []).map(row => ({
        id: row.id,
        date: row.date,
        platform: row.platform,
        filePath: row.file_path,
        commitMessage: row.commit_message,
        commitTime: row.commit_time,
        fullContent: row.full_content || ''
      })),
      total: countResult?.total || 0
    };
  }

  /**
   * 获取所有已提交的日期列表（去重）
   */
  async getCommittedDates(): Promise<string[]> {
    const rows = await this.db?.all(
      'SELECT DISTINCT date FROM commit_history ORDER BY date DESC'
    );
    return (rows || []).map(row => row.date);
  }

  /**
   * 删除提交历史记录
   */
  async deleteCommitHistory(id: number): Promise<void> {
    await this.db?.run('DELETE FROM commit_history WHERE id = ?', id);
  }

  // --- Agent Metadata CRUD ---

  async saveAgent(agent: any): Promise<void> {
    await this.db?.run('INSERT OR REPLACE INTO agents (id, data) VALUES (?, ?)', agent.id, JSON.stringify(agent));
  }

  async getAgent(id: string): Promise<any> {
    const row = await this.db?.get('SELECT data FROM agents WHERE id = ?', id);
    return row ? JSON.parse(row.data) : null;
  }

  async listAgents(): Promise<any[]> {
    const rows = await this.db?.all('SELECT data FROM agents ORDER BY rowid DESC');
    return (rows || []).map(row => JSON.parse(row.data));
  }

  async deleteAgent(id: string): Promise<void> {
    await this.db?.run('DELETE FROM agents WHERE id = ?', id);
  }

  // --- Memory System CRUD ---

  async listMemoryCategories(): Promise<any[]> {
    const rows = await this.db?.all('SELECT * FROM memory_categories ORDER BY updated_at DESC');
    return (rows || []).map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      entryCount: row.entry_count,
      updatedAt: row.updated_at
    }));
  }

  async getMemoryCategory(id: string): Promise<any | null> {
    const row = await this.db?.get('SELECT * FROM memory_categories WHERE id = ?', id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      entryCount: row.entry_count,
      updatedAt: row.updated_at
    };
  }

  async saveMemoryCategory(category: any): Promise<void> {
    await this.db?.run(
      'INSERT OR REPLACE INTO memory_categories (id, name, description, entry_count, updated_at) VALUES (?, ?, ?, ?, ?)',
      category.id, category.name, category.description || '', category.entryCount || 0, category.updatedAt || Date.now()
    );
  }

  async deleteMemoryCategory(id: string): Promise<void> {
    await this.db?.run('DELETE FROM memory_categories WHERE id = ?', id);
  }

  async listMemoriesByCategory(categoryId: string): Promise<any[]> {
    const rows = await this.db?.all('SELECT * FROM agent_memories WHERE category_id = ? ORDER BY created_at DESC', categoryId);
    return (rows || []).map(row => ({
      id: row.id,
      agentId: row.agent_id,
      categoryId: row.category_id,
      content: row.content,
      importance: row.importance,
      tags: row.tags ? JSON.parse(row.tags) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at
    }));
  }

  async getMemory(id: string): Promise<any | null> {
    const row = await this.db?.get('SELECT * FROM agent_memories WHERE id = ?', id);
    if (!row) return null;
    return {
      id: row.id,
      agentId: row.agent_id,
      categoryId: row.category_id,
      content: row.content,
      importance: row.importance,
      tags: row.tags ? JSON.parse(row.tags) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at
    };
  }

  async saveMemory(memory: any): Promise<void> {
    const val = {
      id: memory.id,
      agent_id: memory.agentId || null,
      category_id: memory.categoryId || null,
      content: memory.content,
      importance: memory.importance || 1,
      tags: memory.tags ? JSON.stringify(memory.tags) : null,
      metadata: memory.metadata ? JSON.stringify(memory.metadata) : null,
      created_at: memory.createdAt || Date.now()
    };
    
    await this.db?.run(
      `INSERT OR REPLACE INTO agent_memories (id, agent_id, category_id, content, importance, tags, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      val.id, val.agent_id, val.category_id, val.content, val.importance, val.tags, val.metadata, val.created_at
    );
  }

  async searchMemories(query: string, options: {
    agentId?: string;
    tags?: string[];
    limit?: number;
    minImportance?: number;
  } = {}): Promise<any[]> {
    // 构造 FTS5 查询，支持前缀匹配
    const ftsQuery = query.split(/\s+/).filter(Boolean).map(t => `${t}*`).join(' AND ');
    
    let sql = `
      SELECT 
        m.*, 
        bm25(agent_memories_fts) as search_rank,
        snippet(agent_memories_fts, 1, '【', '】', '...', 20) as snippet
      FROM agent_memories m
      JOIN agent_memories_fts ON m.id = agent_memories_fts.id
      WHERE agent_memories_fts MATCH ?
    `;
    
    const params: any[] = [ftsQuery];
    
    if (options.agentId) {
      sql += ' AND m.agent_id = ?';
      params.push(options.agentId);
    }
    
    if (options.minImportance) {
      sql += ' AND m.importance >= ?';
      params.push(options.minImportance);
    }
    
    // 排序逻辑：相关性 + 重要度 + 时间
    sql += ` ORDER BY (
      (m.importance * 2.0) + 
      (1.0 / (bm25(agent_memories_fts) + 10)) + 
      (m.created_at / 1e12)
    ) DESC`;
    
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    } else {
      sql += ' LIMIT 20';
    }

    const rows = await this.db?.all(sql, ...params);
    return (rows || []).map(row => ({
      id: row.id,
      agentId: row.agent_id,
      content: row.content,
      importance: row.importance,
      tags: row.tags ? JSON.parse(row.tags) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at,
      rank: row.search_rank,
      snippet: row.snippet
    }));
  }

  async deleteMemory(id: string): Promise<void> {
    await this.db?.run('DELETE FROM agent_memories WHERE id = ?', id);
  }

  /**
   * 获取所有原始记忆记录 (用于迁移)
   */
  async listAllMemories(): Promise<any[]> {
    const rows = await this.db?.all('SELECT * FROM agent_memories ORDER BY created_at DESC');
    return (rows || []).map(row => ({
      id: row.id,
      agentId: row.agent_id,
      content: row.content,
      importance: row.importance,
      tags: row.tags ? JSON.parse(row.tags) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at
    }));
  }

  // --- Knowledge Base System CRUD ---

  async listKBCategories(): Promise<any[]> {
    const rows = await this.db?.all('SELECT * FROM kb_categories ORDER BY updated_at DESC');
    return (rows || []).map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      documentCount: row.document_count,
      updatedAt: row.updated_at
    }));
  }

  async getKBCategory(id: string): Promise<any | null> {
    const row = await this.db?.get('SELECT * FROM kb_categories WHERE id = ?', id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      documentCount: row.document_count,
      updatedAt: row.updated_at
    };
  }

  async saveKBCategory(category: any): Promise<void> {
    await this.db?.run(
      'INSERT OR REPLACE INTO kb_categories (id, name, description, document_count, updated_at) VALUES (?, ?, ?, ?, ?)',
      category.id, category.name, category.description || '', category.documentCount || 0, category.updatedAt || Date.now()
    );
  }

  async deleteKBCategory(id: string): Promise<void> {
    await this.db?.run('DELETE FROM kb_categories WHERE id = ?', id);
  }

  async listKBDocuments(categoryId: string): Promise<any[]> {
    const rows = await this.db?.all('SELECT * FROM kb_documents WHERE category_id = ? ORDER BY created_at DESC', categoryId);
    return (rows || []).map(row => ({
      id: row.id,
      categoryId: row.category_id,
      name: row.name,
      fileName: row.file_name,
      type: row.type,
      summary: row.summary,
      chunkCount: row.chunk_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async getKBDocument(id: string): Promise<any | null> {
    const row = await this.db?.get('SELECT * FROM kb_documents WHERE id = ?', id);
    if (!row) return null;
    return {
      id: row.id,
      categoryId: row.category_id,
      name: row.name,
      fileName: row.file_name,
      type: row.type,
      summary: row.summary,
      chunkCount: row.chunk_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async saveKBDocument(doc: any): Promise<void> {
    await this.db?.run(
      `INSERT OR REPLACE INTO kb_documents (
        id, category_id, name, file_name, type, summary, chunk_count, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      doc.id, doc.categoryId, doc.name, doc.fileName, doc.type, doc.summary, 
      doc.chunkCount, JSON.stringify(doc.metadata || {}), doc.createdAt, doc.updatedAt
    );
  }

  async deleteKBDocument(id: string): Promise<void> {
    await this.db?.run('DELETE FROM kb_documents WHERE id = ?', id);
  }

  async saveKBChunk(chunk: any): Promise<void> {
    await this.db?.run(
      'INSERT OR REPLACE INTO kb_chunks (id, document_id, content, chunk_index, metadata) VALUES (?, ?, ?, ?, ?)',
      chunk.id, chunk.documentId, chunk.content, chunk.index, JSON.stringify(chunk.metadata || {})
    );
  }

  async listKBChunks(documentId: string): Promise<any[]> {
    const rows = await this.db?.all(
      'SELECT id, content, chunk_index FROM kb_chunks WHERE document_id = ? ORDER BY chunk_index ASC',
      documentId
    );
    return (rows || []).map(row => ({
      id: row.id,
      content: row.content,
      index: row.chunk_index
    }));
  }

  async searchKBChunks(query: string, options: { categoryIds?: string[]; limit?: number } = {}): Promise<any[]> {
    const ftsQuery = query.split(/\s+/).filter(Boolean).map(t => `${t}*`).join(' AND ');
    
    let sql = `
      SELECT 
        c.*, 
        d.name as doc_name,
        d.category_id,
        bm25(kb_chunks_fts) as search_rank,
        snippet(kb_chunks_fts, 1, '【', '】', '...', 30) as snippet
      FROM kb_chunks c
      JOIN kb_chunks_fts ON c.id = kb_chunks_fts.id
      JOIN kb_documents d ON c.document_id = d.id
      WHERE kb_chunks_fts MATCH ?
    `;
    
    const params: any[] = [ftsQuery];
    
    if (options.categoryIds && options.categoryIds.length > 0) {
      const placeholders = options.categoryIds.map(() => '?').join(',');
      sql += ` AND d.category_id IN (${placeholders})`;
      params.push(...options.categoryIds);
    }
    
    sql += ` ORDER BY search_rank ASC LIMIT ?`;
    params.push(options.limit || 10);

    const rows = await this.db?.all(sql, ...params);
    return (rows || []).map(row => ({
      id: row.id,
      documentId: row.document_id,
      content: row.content,
      index: row.chunk_index,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      docName: row.doc_name,
      categoryId: row.category_id,
      rank: row.search_rank,
      snippet: row.snippet
    }));
  }

  getSkillsDir(): string {
    const dataDir = path.dirname(this.dbPath);
    const skillsDir = path.join(dataDir, 'skills');
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }
    return skillsDir;
  }

  async saveSkill(skill: any): Promise<void> {
    await this.db?.run('INSERT OR REPLACE INTO skills (id, data) VALUES (?, ?)', skill.id, JSON.stringify(skill));
  }

  async getSkill(id: string): Promise<any> {
    const row = await this.db?.get('SELECT data FROM skills WHERE id = ?', id);
    return row ? JSON.parse(row.data) : null;
  }

  async listSkills(): Promise<any[]> {
    const rows = await this.db?.all('SELECT data FROM skills ORDER BY rowid DESC');
    return (rows || []).map(row => JSON.parse(row.data));
  }

  async deleteSkill(id: string): Promise<void> {
    await this.db?.run('DELETE FROM skills WHERE id = ?', id);
  }

  async saveWorkflow(workflow: any): Promise<void> {
    await this.db?.run('INSERT OR REPLACE INTO workflows (id, data) VALUES (?, ?)', workflow.id, JSON.stringify(workflow));
  }

  async getWorkflow(id: string): Promise<any> {
    const row = await this.db?.get('SELECT data FROM workflows WHERE id = ?', id);
    return row ? JSON.parse(row.data) : null;
  }

  async listWorkflows(): Promise<any[]> {
    const rows = await this.db?.all('SELECT data FROM workflows ORDER BY rowid DESC');
    return (rows || []).map(row => JSON.parse(row.data));
  }

  async deleteWorkflow(id: string): Promise<void> {
    await this.db?.run('DELETE FROM workflows WHERE id = ?', id);
  }

  // --- MCP Config CRUD ---

  async saveMCPConfig(config: any): Promise<void> {
    await this.db?.run('INSERT OR REPLACE INTO mcp_configs (id, data) VALUES (?, ?)', config.id, JSON.stringify(config));
  }

  async getMCPConfig(id: string): Promise<any> {
    const row = await this.db?.get('SELECT data FROM mcp_configs WHERE id = ?', id);
    return row ? JSON.parse(row.data) : null;
  }

  async listMCPConfigs(): Promise<any[]> {
    const rows = await this.db?.all('SELECT data FROM mcp_configs ORDER BY rowid DESC');
    return (rows || []).map(row => JSON.parse(row.data));
  }

  async deleteMCPConfig(id: string): Promise<void> {
    await this.db?.run('DELETE FROM mcp_configs WHERE id = ?', id);
  }

  // --- Schedule CRUD ---

  async saveSchedule(schedule: any): Promise<void> {
    const now = Date.now();
    schedule.updatedAt = now;
    await this.db?.run(
      'INSERT OR REPLACE INTO schedules (id, data, updated_at) VALUES (?, ?, ?)',
      schedule.id, JSON.stringify(schedule), now
    );
  }

  async getSchedule(id: string): Promise<any> {
    const row = await this.db?.get('SELECT data FROM schedules WHERE id = ?', id);
    return row ? JSON.parse(row.data) : null;
  }

  async listSchedules(): Promise<any[]> {
    const rows = await this.db?.all('SELECT data FROM schedules ORDER BY updated_at DESC');
    return (rows || []).map(row => JSON.parse(row.data));
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.db?.run('DELETE FROM schedules WHERE id = ?', id);
  }

  // --- Task Log CRUD ---

  async saveTaskLog(log: any): Promise<number> {
    const result = await this.db?.run(
      `INSERT INTO task_logs (task_id, task_name, start_time, end_time, duration, status, progress, message, result_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      log.taskId,
      log.taskName,
      log.startTime,
      log.endTime,
      log.duration,
      log.status,
      log.progress || 0,
      log.message,
      log.resultCount
    );
    return result?.lastID || 0;
  }

  async updateTaskLog(log: any): Promise<void> {
    await this.db?.run(
      `UPDATE task_logs SET end_time = ?, duration = ?, status = ?, progress = ?, message = ?, result_count = ? WHERE id = ?`,
      log.endTime,
      log.duration,
      log.status,
      log.progress,
      log.message,
      log.resultCount,
      log.id
    );
  }

  async listTaskLogs(options?: { limit?: number; offset?: number; taskId?: string }): Promise<any[]> {
    let query = 'SELECT * FROM task_logs';
    const params: any[] = [];
    
    if (options?.taskId) {
      query += ' WHERE task_id = ?';
      params.push(options.taskId);
    }
    
    query += ' ORDER BY start_time DESC';
    
    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }
    
    const rows = await this.db?.all(query, ...params);
    return (rows || []).map(row => ({
      id: row.id,
      taskId: row.task_id,
      taskName: row.task_name,
      startTime: row.start_time,
      endTime: row.end_time,
      duration: row.duration,
      status: row.status,
      progress: row.progress,
      message: row.message,
      resultCount: row.result_count
    }));
  }

  // --- Source Data CRUD ---

  /**
   * 保存或更新单条原始数据
   * @param item 数据条目
   * @param ingestionDate 抓取日期
   * @param adapterName 适配器名称
   * @param overwrite 是否覆盖已存在的数据（默认为 false，即已存在就不写入）
   * @returns 返回是否成功插入了新数据（如果已存在且未覆盖则返回 false）
   */
  async saveSourceData(item: UnifiedData, ingestionDate?: string, adapterName?: string, overwrite: boolean = false): Promise<boolean> {
    if (!overwrite) {
      const existing = await this.db?.get('SELECT id FROM source_data WHERE id = ?', item.id);
      if (existing) {
        return false;
      }
    }

    const sql = overwrite 
      ? `INSERT OR REPLACE INTO source_data (
          id, title, url, description, published_date, source, category, 
          author, metadata, fetched_at, ingestion_date, adapter_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      : `INSERT OR IGNORE INTO source_data (
          id, title, url, description, published_date, source, category, 
          author, metadata, fetched_at, ingestion_date, adapter_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const result = await this.db?.run(
      sql,
      item.id,
      item.title,
      item.url,
      item.description,
      item.published_date,
      item.source,
      item.category,
      item.author || null,
      item.metadata ? JSON.stringify(item.metadata) : null,
      Date.now(),
      ingestionDate || null,
      adapterName || null
    );

    // 对于 INSERT OR IGNORE, changes 为 1 表示插入成功，0 表示忽略
    // 对于 INSERT OR REPLACE, changes 为 1 表示插入或替换成功
    return (result?.changes || 0) > 0;
  }

  /**
   * 批量保存原始数据
   * @returns 返回本次批量操作中实际新增的条目数
   */
  async saveSourceDataBatch(items: UnifiedData[], ingestionDate?: string, adapterName?: string, overwrite: boolean = false): Promise<number> {
    if (!items.length) return 0;
    
    let addedCount = 0;
    // 使用事务提高性能
    await this.db?.run('BEGIN TRANSACTION');
    try {
      for (const item of items) {
        const inserted = await this.saveSourceData(item, ingestionDate, adapterName, overwrite);
        if (inserted) addedCount++;
      }
      await this.db?.run('COMMIT');
      return addedCount;
    } catch (err) {
      await this.db?.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * 获取原始数据列表
   */
  async listSourceData(options?: {
    source?: string;
    category?: string;
    status?: string;
    ingestionDate?: string;
    ingestionDates?: string[];
    minScore?: number;
    publishedDates?: string[];
    adapterName?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<{ items: UnifiedData[]; total: number }> {
    let query = 'SELECT s.* FROM source_data s';
    let countQuery = 'SELECT COUNT(*) as total FROM source_data s';
    const params: any[] = [];
    const countParams: any[] = [];

    if (options?.search) {
      // 构造 FTS5 查询，支持多关键词分词和前缀匹配
      const ftsQuery = options.search.split(/\s+/).filter(Boolean).map(t => `${t}*`).join(' AND ');
      
      query += ' JOIN source_data_fts f ON s.id = f.id';
      countQuery += ' JOIN source_data_fts f ON s.id = f.id';
      
      query += " WHERE source_data_fts MATCH ?";
      countQuery += " WHERE source_data_fts MATCH ?";
      params.push(ftsQuery);
      countParams.push(ftsQuery);
    } else {
      query += ' WHERE 1=1';
      countQuery += ' WHERE 1=1';
    }

    if (options?.source) {
      query += ' AND s.source = ?';
      countQuery += ' AND s.source = ?';
      params.push(options.source);
      countParams.push(options.source);
    }

    if (options?.category) {
      query += ' AND s.category = ?';
      countQuery += ' AND s.category = ?';
      params.push(options.category);
      countParams.push(options.category);
    }

    if (options?.status) {
      query += ' AND s.status = ?';
      countQuery += ' AND s.status = ?';
      params.push(options.status);
      countParams.push(options.status);
    }

    if (options?.ingestionDate) {
      query += ' AND s.ingestion_date = ?';
      countQuery += ' AND s.ingestion_date = ?';
      params.push(options.ingestionDate);
      countParams.push(options.ingestionDate);
    }

    if (options?.ingestionDates && options.ingestionDates.length > 0) {
      const placeholders = options.ingestionDates.map(() => '?').join(',');
      query += ` AND s.ingestion_date IN (${placeholders})`;
      countQuery += ` AND s.ingestion_date IN (${placeholders})`;
      params.push(...options.ingestionDates);
      countParams.push(...options.ingestionDates);
    }

    if (options?.minScore !== undefined) {
      query += " AND CAST(json_extract(s.metadata, '$.ai_score') AS REAL) >= ?";
      countQuery += " AND CAST(json_extract(s.metadata, '$.ai_score') AS REAL) >= ?";
      params.push(options.minScore);
      countParams.push(options.minScore);
    }

    if (options?.publishedDates && options.publishedDates.length > 0) {
      const clauses = options.publishedDates.map(() => 's.published_date LIKE ?').join(' OR ');
      query += ` AND (${clauses})`;
      countQuery += ` AND (${clauses})`;
      params.push(...options.publishedDates.map(d => `${d}%`));
      countParams.push(...options.publishedDates.map(d => `${d}%`));
    }

    if (options?.adapterName) {
      query += ' AND s.adapter_name = ?';
      countQuery += ' AND s.adapter_name = ?';
      params.push(options.adapterName);
      countParams.push(options.adapterName);
    }

    query += ' ORDER BY s.fetched_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const [rows, countResult] = await Promise.all([
      this.db?.all(query, ...params),
      this.db?.get(countQuery, ...countParams)
    ]);

    return {
      items: (rows || []).map(row => ({
        id: row.id,
        title: row.title,
        url: row.url,
        description: row.description,
        published_date: row.published_date,
        source: row.source,
        category: row.category,
        author: row.author,
        ingestion_date: row.ingestion_date,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        status: row.status
      })),
      total: countResult?.total || 0
    };
  }

  /**
   * 获取单条原始数据
   */
  async getSourceData(id: string): Promise<UnifiedData | null> {
    const row = await this.db?.get('SELECT * FROM source_data WHERE id = ?', id);
    if (!row) return null;
    
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      description: row.description,
      published_date: row.published_date,
      source: row.source,
      category: row.category,
      author: row.author,
      ingestion_date: row.ingestion_date,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      status: row.status
    };
  }

  /**
   * 更新数据状态
   */
  async updateSourceDataStatus(id: string, status: string): Promise<void> {
    await this.db?.run('UPDATE source_data SET status = ? WHERE id = ?', status, id);
  }

  /**
   * 更新数据的元数据
   */
  async updateSourceDataMetadata(id: string, metadata: any): Promise<void> {
    await this.db?.run(
      'UPDATE source_data SET metadata = ? WHERE id = ?',
      JSON.stringify(metadata),
      id
    );
  }

  /**
   * 删除原始数据
   */
  async deleteSourceData(id: string): Promise<void> {
    await this.db?.run('DELETE FROM source_data WHERE id = ?', id);
  }

  /**
   * 根据筛选条件删除原始数据
   */
  async deleteSourceDataByFilter(options: {
    source?: string;
    category?: string;
    ingestionDate?: string;
    adapterName?: string;
  }): Promise<void> {
    let query = 'DELETE FROM source_data WHERE 1=1';
    const params: any[] = [];

    if (options.source) {
      query += ' AND source = ?';
      params.push(options.source);
    }

    if (options.category) {
      query += ' AND category = ?';
      params.push(options.category);
    }

    if (options.ingestionDate) {
      query += ' AND ingestion_date = ?';
      params.push(options.ingestionDate);
    }

    if (options.adapterName) {
      query += ' AND adapter_name = ?';
      params.push(options.adapterName);
    }

    if (params.length === 0) {
      throw new Error('Must provide at least one filter to delete source data');
    }

    await this.db?.run(query, ...params);
  }

  // --- API Key CRUD ---

  async listApiKeys(): Promise<any[]> {
    const rows = await this.db?.all('SELECT * FROM api_keys ORDER BY created_at DESC');
    return (rows || []).map(row => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      sourceFingerprint: row.source_fingerprint,
      status: row.status,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at
    }));
  }

  async saveApiKey(apiKey: { 
    id: string; 
    name: string; 
    keyHash: string; 
    prefix: string; 
    sourceFingerprint?: string;
    verificationToken?: string;
    status?: string;
    createdAt?: number 
  }): Promise<void> {
    await this.db?.run(
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

  async getApiKeyByVerificationToken(token: string): Promise<any | null> {
    return await this.db?.get('SELECT * FROM api_keys WHERE verification_token = ?', token) || null;
  }

  async updateApiKeyStatus(id: string, status: string): Promise<void> {
    await this.db?.run('UPDATE api_keys SET status = ? WHERE id = ?', status, id);
  }

  async updateApiKeyName(id: string, name: string): Promise<void> {
    await this.db?.run('UPDATE api_keys SET name = ? WHERE id = ?', name, id);
  }

  async getApiKeyByFingerprint(fingerprint: string): Promise<any | null> {
    return await this.db?.get('SELECT * FROM api_keys WHERE source_fingerprint = ?', fingerprint) || null;
  }

  async deleteApiKey(id: string): Promise<void> {
    await this.db?.run('DELETE FROM api_keys WHERE id = ?', id);
  }

  async getApiKeysByPrefix(prefix: string): Promise<any[]> {
    const rows = await this.db?.all('SELECT * FROM api_keys WHERE prefix = ?', prefix);
    return (rows || []);
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await this.db?.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', Date.now(), id);
  }
}

