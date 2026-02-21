import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
          data TEXT NOT NULL
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
          message TEXT,
          result_count INTEGER
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
    const rows = await this.db?.all('SELECT data FROM skills');
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
    const rows = await this.db?.all('SELECT data FROM workflows');
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
    await this.db?.run('INSERT OR REPLACE INTO schedules (id, data) VALUES (?, ?)', schedule.id, JSON.stringify(schedule));
  }

  async getSchedule(id: string): Promise<any> {
    const row = await this.db?.get('SELECT data FROM schedules WHERE id = ?', id);
    return row ? JSON.parse(row.data) : null;
  }

  async listSchedules(): Promise<any[]> {
    const rows = await this.db?.all('SELECT data FROM schedules');
    return (rows || []).map(row => JSON.parse(row.data));
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.db?.run('DELETE FROM schedules WHERE id = ?', id);
  }

  // --- Task Log CRUD ---

  async saveTaskLog(log: any): Promise<number> {
    const result = await this.db?.run(
      `INSERT INTO task_logs (task_id, task_name, start_time, end_time, duration, status, message, result_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      log.taskId,
      log.taskName,
      log.startTime,
      log.endTime,
      log.duration,
      log.status,
      log.message,
      log.resultCount
    );
    return result?.lastID || 0;
  }

  async updateTaskLog(log: any): Promise<void> {
    await this.db?.run(
      `UPDATE task_logs SET end_time = ?, duration = ?, status = ?, message = ?, result_count = ? WHERE id = ?`,
      log.endTime,
      log.duration,
      log.status,
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
    return rows || [];
  }
}

