import cron, { ScheduledTask } from 'node-cron';
import { LocalStore } from './LocalStore.js';
import { TaskService } from './TaskService.js';
import { WorkflowEngine } from './agents/WorkflowEngine.js';
import { AgentService } from './agents/AgentService.js';
import { AIService } from './AIService.js';
import { LogService } from './LogService.js';
import { ScheduleTask, TaskLog } from '../types/schedule.js';
import { getISODate, removeMarkdownCodeBlock, sleep } from '../utils/helpers.js';

export class SchedulerService {
  private store: LocalStore;
  private taskService: TaskService;
  private agentService: AgentService | null;
  private workflowEngine: WorkflowEngine | null;
  private aiService: AIService | null;
  private cronTasks: Map<string, ScheduledTask> = new Map();

  constructor(
    store: LocalStore,
    taskService: TaskService,
    agentService: AgentService | null,
    workflowEngine: WorkflowEngine | null,
    aiService: AIService | null
  ) {
    this.store = store;
    this.taskService = taskService;
    this.agentService = agentService;
    this.workflowEngine = workflowEngine;
    this.aiService = aiService;
  }

  /**
   * Initialize and start all enabled schedules from the database
   */
  async init() {
    const schedules = await this.store.listSchedules();
    LogService.info(`Initializing scheduler... Found ${schedules.length} total tasks in database.`);

    for (const schedule of schedules) {
      if (schedule.enabled) {
        LogService.info(`Loading enabled task: ${schedule.name} [${schedule.id}] with cron: ${schedule.cron}`);
        this.startSchedule(schedule);
      } else {
        LogService.info(`Skipping disabled task: ${schedule.name} [${schedule.id}]`);
      }
    }
    
    LogService.info(`Scheduler initialized. Active cron tasks: ${this.cronTasks.size}`);
  }

  /**
   * Start or restart a specific schedule
   */
  startSchedule(schedule: ScheduleTask) {
    // Stop existing task if any
    this.stopSchedule(schedule.id);

    if (!cron.validate(schedule.cron)) {
      LogService.error(`Invalid cron expression for task ${schedule.name}: ${schedule.cron}`);
      return;
    }

    try {
      const task = cron.schedule(schedule.cron, async () => {
        LogService.info(`Cron trigger fired for task: ${schedule.name}`);
        try {
          await this.executeTask(schedule);
        } catch (err) {
          LogService.error(`Error in executed task ${schedule.name}: ${err}`);
        }
      }, {
        timezone: 'Asia/Shanghai'
      });

      this.cronTasks.set(schedule.id, task);
      LogService.info(`Scheduled task started: ${schedule.name} (${schedule.cron})`);
    } catch (error) {
      LogService.error(`Failed to start schedule ${schedule.name}: ${error}`);
    }
  }

  /**
   * Stop a specific schedule
   */
  stopSchedule(id: string) {
    const task = this.cronTasks.get(id);
    if (task) {
      task.stop();
      this.cronTasks.delete(id);
      LogService.info(`Scheduled task stopped: ${id}`);
    }
  }

  /**
   * Stop all active schedules
   */
  stopAll() {
    LogService.info(`Stopping all ${this.cronTasks.size} scheduled tasks...`);
    for (const [id, task] of this.cronTasks.entries()) {
      task.stop();
    }
    this.cronTasks.clear();
  }

  /**
   * Run a schedule immediately
   */
  async runNow(scheduleId: string) {
    const schedule = await this.store.getSchedule(scheduleId);
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);
    return this.executeTask(schedule);
  }

  /**
   * 统一格式化单个条目用于 AI 输入
   */
  private formatItemForPrompt(item: any): string {
    return `标题: ${item.title}\n描述: ${item.metadata?.content_html || item.description || '无'}\n链接: ${item.url}`;
  }

  /**
   * 封装通用的条目迭代处理逻辑
   */
  private async processItemsIteratively(
    schedule: ScheduleTask,
    logId: number,
    processor: (item: any, date: string) => Promise<string>
  ) {
    const today = getISODate();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().split('T')[0];
    
    const dates = [yesterday, today];
    let processedTotal = 0;

    // 获取需要更新的目标字段列表
    const targetFields: string[] = schedule.config?.targetFields || 
      [schedule.config?.targetField || 'ai_summary'];

    // 1. 收集所有待处理的条目
    const itemsToProcess: { item: any, date: string, adapterName: string }[] = [];

    for (const date of dates) {
      for (const adapter of this.taskService.getAdapters()) {
        const { items } = await this.store.listSourceData({
          adapterName: adapter.name,
          category: adapter.category,
          ingestionDate: date,
          limit: 1000
        });
        
        if (items.length === 0) continue;

        for (const item of items) {
          // 检查是否有任何一个目标字段缺失
          const needsProcessing = targetFields.some(field => !(item.metadata as any)?.[field]);
          
          if (needsProcessing) {
            itemsToProcess.push({ item, date, adapterName: adapter.name });
          }
        }
      }
    }

    if (itemsToProcess.length === 0) {
      await this.store.updateTaskLog({ id: logId, progress: 100, status: 'running' });
      return 0;
    }

    // 2. 并行处理，最大 CONCURRENCY_LIMIT 个线程 (并发限制)
    // 从配置中获取并发数和延迟，默认 3 线程，500ms 延迟
    const CONCURRENCY_LIMIT = schedule.config?.concurrency || 3;
    const REQUEST_DELAY = schedule.config?.delay || 500;

    const updatedItemsByGroup = new Map<string, any[]>();
    let nextIndex = 0;
    const totalItems = itemsToProcess.length;

    const workers = Array(Math.min(CONCURRENCY_LIMIT, itemsToProcess.length)).fill(null).map(async (_, i) => {
      // 错开启动时间，避免瞬间高并发
      if (i > 0) await sleep(i * 200);

      while (nextIndex < itemsToProcess.length) {
        const idx = nextIndex++;
        const task = itemsToProcess[idx];
        if (!task) break;

        const { item, date, adapterName } = task;
        LogService.info(`[${idx + 1}/${totalItems}] Processing item [${schedule.type} -> ${targetFields.join(',')}]: ${item.title}`);
        try {
          const result = await processor(item, date);
          
          try {
            // 尝试提取并解析 JSON
            const cleanedResult = removeMarkdownCodeBlock(result);
            const jsonStr = cleanedResult.match(/\{[\s\S]*\}/)?.[0];
            if (!jsonStr) throw new Error('AI 返回内容不包含有效的 JSON 对象');
            
            const parsed = JSON.parse(jsonStr);
            
            // 确保 metadata 存在
            if (!item.metadata) item.metadata = {};

            // 映射已知字段
            const summary = parsed.ai_summary || parsed.ai_summary;
            if (summary) {
              item.metadata.ai_summary = summary;
            }

            const score = parsed.ai_score ?? parsed.score;
            if (typeof score === 'number') {
              item.metadata.ai_score = score;
            }

            const reason = parsed.ai_score_reason || parsed.reason;
            if (reason) {
              item.metadata.ai_score_reason = reason;
            }

            const tags = parsed.tags;
            if (Array.isArray(tags)) {
              item.metadata.tags = tags;
            }

            // 处理其他自定义字段
            for (const field of targetFields) {
              if (!['ai_summary', 'ai_score', 'tags'].includes(field) && parsed[field] !== undefined) {
                (item.metadata as any)[field] = parsed[field];
              }
            }

          } catch (e: any) {
            LogService.warn(`[SchedulerService] 解析 AI 响应失败 (ID: ${item.id}): ${e.message}`);
          }

          const groupKey = `${date}|${adapterName}`;
          if (!updatedItemsByGroup.has(groupKey)) {
            updatedItemsByGroup.set(groupKey, []);
          }
          updatedItemsByGroup.get(groupKey)!.push(item);
          processedTotal++;
          
          // 更新进度
          const progress = Math.round((processedTotal / totalItems) * 100);
          await this.store.updateTaskLog({ id: logId, progress, status: 'running' });
          
          // 迭代延迟，避免频率过高导致 429
          if (REQUEST_DELAY > 0 && nextIndex < itemsToProcess.length) {
            await sleep(REQUEST_DELAY);
          }

        } catch (err) {
          LogService.error(`Failed to process item ${item.id} in ${schedule.name}: ${err}`);
        }
      }
    });

    await Promise.all(workers);

    // 3. 批量保存更新后的数据
    for (const [groupKey, items] of updatedItemsByGroup.entries()) {
      const [date, adapterName] = groupKey.split('|');
      await this.store.saveSourceDataBatch(items, date, adapterName);
    }

    return processedTotal;
  }

  /**
   * Execute a task and log the result
   */
  private async executeTask(schedule: ScheduleTask) {
    LogService.info(`Executing scheduled task: ${schedule.name} (${schedule.type})`);
    
    const startTime = new Date().toISOString();
    const logId = await this.store.saveTaskLog({
      taskId: schedule.id,
      taskName: schedule.name,
      startTime,
      status: 'running',
      progress: 0
    });

    try {
      let resultCount = 0;
      let message = '';
      const targetFields: string[] = schedule.config?.targetFields || 
        [schedule.config?.targetField || 'ai_summary'];

      const onProgress = async (p: number) => {
        await this.store.updateTaskLog({ id: logId, progress: p, status: 'running' });
      };

      switch (schedule.type) {
        
        case 'FULL_INGESTION':
          await this.taskService.runDailyIngestion(undefined, schedule.config, onProgress);
          break;

        case 'ADAPTER':
          await this.taskService.runSingleAdapterIngestion(schedule.targetId, undefined, schedule.config, onProgress);
          const status = this.taskService.getAdapterStatus();
          resultCount = status[schedule.targetId]?.count || 0;
          break;

        case 'WORKFLOW':
          if (this.workflowEngine) {
            resultCount = await this.processItemsIteratively(schedule, logId, async (item, date) => {
              const itemContent = this.formatItemForPrompt(item);
              const workflowInput = {
                content: itemContent, // 注入统一格式化的文本输入
                date
              };
              const result = await this.workflowEngine!.runWorkflow(schedule.targetId, workflowInput, date);
              return result;
            });
            message = `Workflow executed iteratively for ${resultCount} items (Fields: ${targetFields.join(',')})`;
          } else {
            throw new Error('Workflow Engine not initialized');
          }
          break;

        case 'AGENT_DEAL':
          if (this.agentService) {
            resultCount = await this.processItemsIteratively(schedule, logId, async (item, date) => {
              const itemContent = this.formatItemForPrompt(item);
              const input = itemContent;
              const agentId = schedule.targetId || 'default_summarizer';
              const result = await this.agentService!.runAgent(agentId, input, date, { silent: true });
              return result.content;
            });
            message = `AI Processing completed for ${resultCount} items (Fields: ${targetFields.join(',')})`;
          } else {
            throw new Error('Agent Service not initialized');
          }
          break;

        default:
          throw new Error(`Unknown task type: ${schedule.type}`);
      }

      const endTime = new Date().toISOString();
      const duration = new Date(endTime).getTime() - new Date(startTime).getTime();


      await this.store.updateTaskLog({
        id: logId,
        endTime,
        duration,
        status: 'success',
        progress: 100,
        message: message || 'Completed successfully',
        resultCount
      });

      // Update last run info in schedule
      schedule.lastRun = startTime;
      schedule.lastStatus = 'success';
      await this.store.saveSchedule(schedule);

    } catch (error: any) {
      LogService.error(`Scheduled task ${schedule.name} failed: ${error.message}`);
      
      const endTime = new Date().toISOString();
      const duration = new Date(endTime).getTime() - new Date(startTime).getTime();

      await this.store.updateTaskLog({
        id: logId,
        endTime,
        duration,
        status: 'error',
        message: error.message
      });

      schedule.lastRun = startTime;
      schedule.lastStatus = 'error';
      schedule.lastError = error.message;
      await this.store.saveSchedule(schedule);
    }
  }

  /**
   * Get list of all registered tasks in memory
   */
  getActiveTasks() {
    return Array.from(this.cronTasks.keys());
  }
}
