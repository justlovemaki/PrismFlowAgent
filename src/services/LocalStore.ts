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

      // 检查并添加 full_content 字段（如果不存在，用于向后兼容）
      const tableInfo = await this.db.all("PRAGMA table_info(commit_history)");
      const hasFullContent = tableInfo.some(column => column.name === "full_content");
      if (!hasFullContent) {
        await this.db.exec("ALTER TABLE commit_history ADD COLUMN full_content TEXT");
        console.log("Added full_content column to commit_history table");
      }

      // 创建 Agent 相关表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        )
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

      // 检查并添加 updated_at 字段（如果不存在）
      const schedulesTableInfo = await this.db.all("PRAGMA table_info(schedules)");
      const hasUpdatedAt = schedulesTableInfo.some(column => column.name === "updated_at");
      if (!hasUpdatedAt) {
        await this.db.exec("ALTER TABLE schedules ADD COLUMN updated_at INTEGER");
        // 初始化已有数据的 updated_at 为当前时间
        await this.db.exec(`UPDATE schedules SET updated_at = ${Date.now()}`);
        console.log("Added updated_at column to schedules table and initialized values");
      }

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

      // 检查并添加 progress 字段（如果不存在）
      const taskLogsTableInfo = await this.db.all("PRAGMA table_info(task_logs)");
      const hasProgress = taskLogsTableInfo.some(column => column.name === "progress");
      if (!hasProgress) {
        await this.db.exec("ALTER TABLE task_logs ADD COLUMN progress INTEGER DEFAULT 0");
        console.log("Added progress column to task_logs table");
      }

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

      // 检查并添加 ingestion_date 字段（如果不存在）
      const sourceDataTableInfo = await this.db.all("PRAGMA table_info(source_data)");
      const hasIngestionDate = sourceDataTableInfo.some(column => column.name === "ingestion_date");
      if (!hasIngestionDate) {
        await this.db.exec("ALTER TABLE source_data ADD COLUMN ingestion_date TEXT");
        console.log("Added ingestion_date column to source_data table");
      }

      // 检查并添加 adapter_name 字段（如果不存在）
      const hasAdapterName = sourceDataTableInfo.some(column => column.name === "adapter_name");
      if (!hasAdapterName) {
        await this.db.exec("ALTER TABLE source_data ADD COLUMN adapter_name TEXT");
        console.log("Added adapter_name column to source_data table");
      }

      // 创建索引
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source_data_source ON source_data(source)`);
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source_data_fetched_at ON source_data(fetched_at)`);
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source_data_status ON source_data(status)`);
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source_data_ingestion_date ON source_data(ingestion_date)`);
      
      // 系统启动时，将所有运行中的任务状态设置为中断
      await this.db.exec(`UPDATE task_logs SET status = 'interrupted', message = '系统重启导致任务中断' WHERE status = 'running'`);

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
   * 查询提交历史记录
   */
  async getCommitHistory(options?: {
    date?: string;
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
    adapterName?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<{ items: UnifiedData[]; total: number }> {
    let query = 'SELECT * FROM source_data WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM source_data WHERE 1=1';
    const params: any[] = [];
    const countParams: any[] = [];

    if (options?.source) {
      query += ' AND source = ?';
      countQuery += ' AND source = ?';
      params.push(options.source);
      countParams.push(options.source);
    }

    if (options?.category) {
      query += ' AND category = ?';
      countQuery += ' AND category = ?';
      params.push(options.category);
      countParams.push(options.category);
    }

    if (options?.status) {
      query += ' AND status = ?';
      countQuery += ' AND status = ?';
      params.push(options.status);
      countParams.push(options.status);
    }

    if (options?.ingestionDate) {
      query += ' AND ingestion_date = ?';
      countQuery += ' AND ingestion_date = ?';
      params.push(options.ingestionDate);
      countParams.push(options.ingestionDate);
    }

    if (options?.ingestionDates && options.ingestionDates.length > 0) {
      const placeholders = options.ingestionDates.map(() => '?').join(',');
      query += ` AND ingestion_date IN (${placeholders})`;
      countQuery += ` AND ingestion_date IN (${placeholders})`;
      params.push(...options.ingestionDates);
      countParams.push(...options.ingestionDates);
    }

    if (options?.adapterName) {
      query += ' AND adapter_name = ?';
      countQuery += ' AND adapter_name = ?';
      params.push(options.adapterName);
      countParams.push(options.adapterName);
    }

    if (options?.search) {
      const pattern = `%${options.search}%`;
      query += ' AND (title LIKE ? OR description LIKE ?)';
      countQuery += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(pattern, pattern);
      countParams.push(pattern, pattern);
    }

    query += ' ORDER BY fetched_at DESC';

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
}

