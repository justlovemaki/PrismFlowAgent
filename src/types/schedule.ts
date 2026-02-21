export interface ScheduleTask {
  id: string;           // Unique ID (UUID or generated)
  name: string;         // Human readable name
  cron: string;         // Cron expression (e.g., "0 9 * * *")
  type: 'ADAPTER' | 'WORKFLOW' | 'FULL_INGESTION' | 'AGENT_DEAL';
  targetId: string;     // ID of the adapter or workflow
  config?: any;         // Optional runtime config overrides
  enabled: boolean;     // Whether the task is active
  lastRun?: string;     // Last execution time (ISO string)
  lastStatus?: 'success' | 'error';
  lastError?: string;   // Error message if failed
}

export interface TaskLog {
  id: number;
  taskId: string;
  taskName: string;
  startTime: string;
  endTime?: string;
  duration?: number;    // In milliseconds
  status: 'running' | 'success' | 'error';
  message?: string;
  resultCount?: number; // Number of items ingested (if applicable)
}
