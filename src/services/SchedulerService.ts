import cron, { ScheduledTask } from 'node-cron';
import { LocalStore } from './LocalStore.js';
import { TaskService } from './TaskService.js';
import { WorkflowEngine } from './agents/WorkflowEngine.js';
import { AgentService } from './agents/AgentService.js';
import { AIService } from './AIService.js';
import { LogService } from './LogService.js';
import { ScheduleTask, TaskLog } from '../types/schedule.js';
import { getISODate } from '../utils/helpers.js';

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
    processor: (item: any, date: string) => Promise<string>
  ) {
    const today = getISODate();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().split('T')[0];
    
    const dates = [yesterday, today];
    let processedTotal = 0;

    // 1. 收集所有待处理的条目
    const itemsToProcess: { item: any, date: string, storageKey: string }[] = [];
    const storageMap = new Map<string, any[]>();

    for (const date of dates) {
      for (const adapter of this.taskService.getAdapters()) {
        const storageKey = `${date}-${adapter.category}-${adapter.name}`;
        const items: any[] = await this.store.get(storageKey) || [];
        
        if (items.length === 0) continue;
        storageMap.set(storageKey, items);

        for (const item of items) {
          // 只处理没有 AI 摘要的条目
          if (!item.ai_summary) {
            itemsToProcess.push({ item, date, storageKey });
          }
        }
      }
    }

    if (itemsToProcess.length === 0) return 0;

    // 2. 并行处理，最大 5 个线程 (并发限制)
    const CONCURRENCY_LIMIT = 5;
    const updatedKeys = new Set<string>();
    let nextIndex = 0;

    const workers = Array(Math.min(CONCURRENCY_LIMIT, itemsToProcess.length)).fill(null).map(async () => {
      while (nextIndex < itemsToProcess.length) {
        const task = itemsToProcess[nextIndex++];
        if (!task) break;

        const { item, date, storageKey } = task;
        LogService.info(`Processing item [${schedule.type}]: ${item.title}`);
        try {
          const result = await processor(item, date);
          item.ai_summary = result;
          updatedKeys.add(storageKey);
          processedTotal++;
        } catch (err) {
          LogService.error(`Failed to process item ${item.id} in ${schedule.name}: ${err}`);
        }
      }
    });

    await Promise.all(workers);

    // 3. 批量保存更新后的数据
    for (const storageKey of updatedKeys) {
      const items = storageMap.get(storageKey);
      if (items) {
        await this.store.put(storageKey, items);
      }
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
      status: 'running'
    });

    try {
      let resultCount = 0;
      let message = '';

      switch (schedule.type) {
        
        case 'FULL_INGESTION':
          await this.taskService.runDailyIngestion(undefined, schedule.config);
          break;

        case 'ADAPTER':
          await this.taskService.runSingleAdapterIngestion(schedule.targetId, undefined, schedule.config);
          const status = this.taskService.getAdapterStatus();
          resultCount = status[schedule.targetId]?.count || 0;
          break;

        case 'WORKFLOW':
          if (this.workflowEngine) {
            resultCount = await this.processItemsIteratively(schedule, async (item, date) => {
              const itemContent = this.formatItemForPrompt(item);
              const workflowInput = {
                content: itemContent, // 注入统一格式化的文本输入
                date
              };
              const result = await this.workflowEngine!.runWorkflow(schedule.targetId, workflowInput, date);
              // 如果工作流返回的是对象，尝试提取内容
              return result;
            });
            message = `Workflow executed iteratively for ${resultCount} items`;
          } else {
            throw new Error('Workflow Engine not initialized');
          }
          break;

        case 'AGENT_DEAL':
          if (this.agentService) {
            resultCount = await this.processItemsIteratively(schedule, async (item, date) => {
              const itemContent = this.formatItemForPrompt(item);
              const input = `${itemContent}`;
              const agentId = schedule.targetId || 'default_summarizer';
              const result = await this.agentService!.runAgent(agentId, input, date, { silent: true });
              return result.content;
            });
            message = `AI Processing completed for ${resultCount} items`;
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
