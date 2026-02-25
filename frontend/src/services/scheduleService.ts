import { request } from './api';

export interface ScheduleTask {
  id: string;
  name: string;
  cron: string;
  type: 'ADAPTER' | 'AGENT_SUMMARY' | 'AGENT_DEAL' | 'FULL_INGESTION';
  targetId: string;
  config?: any;
  enabled: boolean;
  lastRun?: string;
  lastStatus?: 'success' | 'error';
  lastError?: string;
  updatedAt?: number;
}

export interface TaskLog {
  id: number;
  taskId: string;
  taskName: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  status: 'running' | 'success' | 'error' | 'interrupted';
  progress?: number;
  message?: string;
  resultCount?: number;
}

export const getSchedules = (): Promise<ScheduleTask[]> => 
  request('/api/schedules');

export const saveSchedule = (schedule: ScheduleTask): Promise<void> => 
  request('/api/schedules', { 
    method: 'POST', 
    body: JSON.stringify(schedule) 
  });

export const deleteSchedule = (id: string): Promise<void> => 
  request(`/api/schedules/${encodeURIComponent(id)}`, { 
    method: 'DELETE' 
  });

export const getTaskLogs = (params?: { limit?: number; offset?: number; taskId?: string }): Promise<TaskLog[]> => {
  const query = new URLSearchParams();
  if (params?.limit) query.append('limit', params.limit.toString());
  if (params?.offset) query.append('offset', params.offset.toString());
  if (params?.taskId) query.append('taskId', params.taskId);
  
  const queryString = query.toString();
  return request(`/api/schedules/logs${queryString ? `?${queryString}` : ''}`);
};

export const runTaskNow = (id: string): Promise<void> => 
  request(`/api/schedules/${encodeURIComponent(id)}/run`, { 
    method: 'POST' 
  });
