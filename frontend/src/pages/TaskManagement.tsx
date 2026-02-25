import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  getSchedules, 
  saveSchedule, 
  deleteSchedule, 
  getTaskLogs, 
  runTaskNow,
} from '../services/scheduleService';
import type { ScheduleTask, TaskLog } from '../services/scheduleService';
import { getAdapters } from '../services/dashboardService';
import { agentService } from '../services/agentService';
import type { Agent, Workflow } from '../services/agentService';
import { useToast } from '../context/ToastContext';

const TaskManagement: React.FC = () => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [schedules, setSchedules] = useState<ScheduleTask[]>([]);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [currentSchedule, setCurrentSchedule] = useState<Partial<ScheduleTask> | null>(null);
  const [configString, setConfigString] = useState('');
  const [runningTasks, setRunningTasks] = useState<Record<string, boolean>>({});

  // 资源列表
  const [availableAdapters, setAvailableAdapters] = useState<string[]>([]);
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [availableWorkflows, setAvailableWorkflows] = useState<Workflow[]>([]);

  const fetchResources = async () => {
    try {
      const [adapters, agents, workflows] = await Promise.all([
        getAdapters(),
        agentService.getAgents(),
        agentService.getWorkflows()
      ]);
      setAvailableAdapters(Object.keys(adapters));
      setAvailableAgents(agents);
      setAvailableWorkflows(workflows);
    } catch (error) {
      console.error('Failed to fetch resources:', error);
    }
  };

  const fetchData = async () => {
    try {
      const [schedulesData, logsData] = await Promise.all([
        getSchedules(),
        getTaskLogs({ limit: 20 })
      ]);
      setSchedules(schedulesData);
      setLogs(logsData);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toastError('获取数据失败');
    }
  };

  useEffect(() => {
    fetchData();
    fetchResources();
    const timer = setInterval(() => {
        getTaskLogs({ limit: 20 }).then(setLogs);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const handleToggleEnable = async (schedule: ScheduleTask) => {
    try {
      const updated = { ...schedule, enabled: !schedule.enabled };
      await saveSchedule(updated);
      toastSuccess(`${updated.enabled ? '已启用' : '已禁用'}任务`);
      fetchData();
    } catch (error) {
      toastError('操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除此任务吗？')) return;
    try {
      await deleteSchedule(id);
      toastSuccess('已删除任务');
      fetchData();
    } catch (error) {
      toastError('删除失败');
    }
  };

  const handleRunNow = async (id: string) => {
    setRunningTasks(prev => ({ ...prev, [id]: true }));
    try {
      await runTaskNow(id);
      toastSuccess('任务已手动触发');
      // 延迟刷新日志
      setTimeout(fetchData, 2000);
    } catch (error) {
      toastError('触发失败');
    } finally {
      setRunningTasks(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSchedule) return;
    try {
      let configFromEditor = {};
      if (configString.trim()) {
        try {
          configFromEditor = JSON.parse(configString);
        } catch (e) {
          toastError('JSON 格式错误');
          return;
        }
      }
      // 合并配置，确保通过 UI 控件设置的 executorType 等字段得以保留
      const finalConfig = { ...currentSchedule.config, ...configFromEditor };
      let finalSchedule = { ...currentSchedule, config: finalConfig } as ScheduleTask;
      if (finalSchedule.type === 'FULL_INGESTION') {
        finalSchedule.targetId = 'all';
      }
      await saveSchedule(finalSchedule);
      toastSuccess('保存成功');
      setShowModal(false);
      fetchData();
    } catch (error) {
      toastError('保存失败');
    }
  };

  const openEdit = (schedule: ScheduleTask) => {
    setCurrentSchedule(schedule);
    setConfigString(schedule.config ? JSON.stringify(schedule.config, null, 2) : '');
    setShowModal(true);
  };

  const openAdd = () => {
    setCurrentSchedule({
      id: `task_${Date.now()}`,
      name: '',
      cron: '0 8 * * *',
      type: 'ADAPTER',
      targetId: '',
      enabled: true
    });
    setConfigString('');
    setShowModal(true);
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'success': return 'text-accent-success bg-accent-success/10';
      case 'error': return 'text-accent-error bg-accent-error/10';
      case 'running': return 'text-accent-warning bg-accent-warning/10 animate-pulse';
      case 'interrupted': return 'text-slate-500 bg-slate-500/10';
      default: return 'text-slate-500 bg-slate-500/10';
    }
  };

  const getTargetDisplayName = (type: string, targetId: string) => {
    if (!targetId) return '-';
    if (type === 'FULL_INGESTION') return '数据源全量同步';
    
    if (type === 'ADAPTER') {
      return targetId;
    }
    
    if ((type === 'AGENT_SUMMARY' || type === 'AGENT_DEAL') && currentSchedule?.config?.executorType !== 'workflow') {
      const agent = availableAgents.find(a => a.id === targetId);
      return agent ? agent.name : targetId;
    }
    
    if ((type === 'AGENT_SUMMARY' || type === 'AGENT_DEAL') && currentSchedule?.config?.executorType === 'workflow') {
      const workflow = availableWorkflows.find(w => w.id === targetId);
      return workflow ? workflow.name : targetId;
    }
    
    return targetId;
  };

  const formatTime = (time?: string) => {
    if (!time) return '-';
    return new Date(time).toLocaleString('zh-CN', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-slate-900 dark:text-white text-3xl font-bold tracking-tight">任务调度</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">管理自动化数据抓取与智能体工作流</p>
        </div>
        <button 
          onClick={openAdd}
          className="flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg transition-all shadow-md shadow-primary/20 w-full sm:w-auto"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          <span>新增任务</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">schedule</span>
              调度列表
            </h3>
            <button onClick={fetchData} className="text-slate-400 hover:text-primary transition-colors">
              <span className="material-symbols-outlined">refresh</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5 text-xs uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider">
                  <th className="px-6 py-4">任务名称</th>
                  <th className="px-6 py-4 hidden md:table-cell">Cron 表达式</th>
                  <th className="px-6 py-4 hidden sm:table-cell">类型</th>
                  <th className="px-6 py-4 hidden lg:table-cell">上次运行</th>
                  <th className="px-6 py-4">状态</th>
                  <th className="px-6 py-4">开关</th>
                  <th className="px-6 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-sm">
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-500">暂无任务调度</td>
                  </tr>
                ) : (
                  schedules.map(schedule => (
                    <tr key={schedule.id} className="group hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900 dark:text-white">{schedule.name}</span>
                          <span className="text-xs text-slate-400">{getTargetDisplayName(schedule.type, schedule.targetId)}</span>
                          <span className="text-[10px] text-primary md:hidden mt-1">{schedule.cron}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-primary hidden md:table-cell">{schedule.cron}</td>
                      <td className="px-6 py-4 hidden sm:table-cell">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400">
                          {schedule.type === 'ADAPTER' ? '数据源适配器' :
                           schedule.type === 'AGENT_SUMMARY' ? 'AI 总结处理' :
                           schedule.type === 'AGENT_DEAL' ? 'AI 任务执行' :
                           schedule.type === 'FULL_INGESTION' ? '数据源全量同步' : schedule.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-xs hidden lg:table-cell">
                        {formatTime(schedule.lastRun)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusColor(schedule.lastStatus)}`}>
                          <span className={`w-1 h-1 rounded-full ${schedule.lastStatus === 'success' ? 'bg-accent-success' : schedule.lastStatus === 'error' ? 'bg-accent-error' : 'bg-slate-500'}`}></span>
                          {schedule.lastStatus === 'success' ? '成功' : schedule.lastStatus === 'error' ? '失败' : '从未运行'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button 
                          onClick={() => handleToggleEnable(schedule)}
                          className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${schedule.enabled ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-700'}`}
                        >
                          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${schedule.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button 
                          onClick={() => handleRunNow(schedule.id)}
                          disabled={runningTasks[schedule.id]}
                          className="text-slate-400 hover:text-accent-success transition-colors"
                          title="立即执行"
                        >
                          <span className={`material-symbols-outlined text-lg ${runningTasks[schedule.id] ? 'animate-spin' : ''}`}>
                            {runningTasks[schedule.id] ? 'progress_activity' : 'play_arrow'}
                          </span>
                        </button>
                        <button 
                          onClick={() => openEdit(schedule)}
                          className="text-slate-400 hover:text-primary transition-colors"
                          title="编辑"
                        >
                          <span className="material-symbols-outlined text-lg">edit</span>
                        </button>
                        <button 
                          onClick={() => handleDelete(schedule.id)}
                          className="text-slate-400 hover:text-accent-error transition-colors"
                          title="删除"
                        >
                          <span className="material-symbols-outlined text-lg">delete</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">terminal</span>
              运行记录
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5 text-xs uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider">
                  <th className="px-6 py-3">任务</th>
                  <th className="px-6 py-3">开始时间</th>
                  <th className="px-6 py-3">状态</th>
                  <th className="px-6 py-3">进度</th>
                  <th className="px-6 py-3">耗时</th>
                  <th className="px-6 py-3">结果</th>
                  <th className="px-6 py-3">消息</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-xs">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.01]">
                    <td className="px-6 py-3 font-medium text-slate-700 dark:text-slate-300">{log.taskName}</td>
                    <td className="px-6 py-3 text-slate-500">{formatTime(log.startTime)}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${getStatusColor(log.status)}`}>
                        {log.status === 'running' && <span className="material-symbols-outlined text-[10px] animate-spin">progress_activity</span>}
                        {log.status === 'success' ? '成功' : log.status === 'error' ? '失败' : log.status === 'interrupted' ? '已中断' : '执行中'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all duration-500" 
                            style={{ width: `${log.progress || 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-400 w-6">{log.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-slate-500">{log.duration ? `${(log.duration / 1000).toFixed(1)}s` : '-'}</td>
                    <td className="px-6 py-3 text-slate-500">{log.resultCount ?? '-'} 条</td>
                    <td className="px-6 py-3 text-slate-500 truncate max-w-xs" title={log.message}>{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showModal && currentSchedule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-surface-dark w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            >
              <form onSubmit={handleSave}>
                <div className="p-6 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">编辑调度任务</h3>
                  <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
                
                <div className="p-6 space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">任务名称</label>
                    <input 
                      required
                      value={currentSchedule.name}
                      onChange={e => setCurrentSchedule({...currentSchedule, name: e.target.value})}
                      className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                      placeholder="例: GitHubTrending 同步"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">任务类型</label>
                      <select 
                        value={currentSchedule.type}
                        onChange={e => setCurrentSchedule({...currentSchedule, type: e.target.value as any})}
                        className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                      >
                        <option value="FULL_INGESTION">数据源全量同步</option>
                        <option value="ADAPTER">数据源适配器</option>
                        <option value="AGENT_SUMMARY">AI 总结处理</option>
                        <option value="AGENT_DEAL">AI 任务执行</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">Cron 表达式</label>
                      <input 
                        required
                        value={currentSchedule.cron}
                        onChange={e => setCurrentSchedule({...currentSchedule, cron: e.target.value})}
                        className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/10 rounded-lg text-sm font-mono"
                        placeholder="0 8 * * *"
                      />
                    </div>
                  </div>

                  {currentSchedule.type !== 'FULL_INGESTION' && (
                    <div className="space-y-4">
                      {(currentSchedule.type === 'AGENT_SUMMARY' || currentSchedule.type === 'AGENT_DEAL') && (
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 uppercase">执行器类型</label>
                          <select
                            value={currentSchedule.config?.executorType || 'agent'}
                            onChange={e => {
                              const newExecutorType = e.target.value;
                              let newConfig = { ...currentSchedule.config, executorType: newExecutorType };
                              setCurrentSchedule({...currentSchedule, config: newConfig});
                            }}
                            className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                          >
                            <option value="agent">智能体 (Agent)</option>
                            <option value="workflow">工作流 (Workflow)</option>
                          </select>
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">
                          {currentSchedule.type === 'ADAPTER' ? '选择适配器' :
                           ((currentSchedule.type === 'AGENT_SUMMARY' || currentSchedule.type === 'AGENT_DEAL') && currentSchedule.config?.executorType === 'workflow') ? '选择工作流' :
                           ((currentSchedule.type === 'AGENT_SUMMARY' || currentSchedule.type === 'AGENT_DEAL') && currentSchedule.config?.executorType !== 'workflow') ? '选择智能体 (Agent)' : '目标标识 (ID)'}
                        </label>
                        
                        {currentSchedule.type === 'ADAPTER' ? (
                          <select
                            required
                            value={currentSchedule.targetId}
                            onChange={e => setCurrentSchedule({...currentSchedule, targetId: e.target.value})}
                            className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                          >
                            <option value="">请选择适配器</option>
                            {availableAdapters.map(id => (
                              <option key={id} value={id}>{id}</option>
                            ))}
                          </select>
                        ) : ((currentSchedule.type === 'AGENT_SUMMARY' || currentSchedule.type === 'AGENT_DEAL') && currentSchedule.config?.executorType === 'workflow') ? (
                          <select
                            required
                            value={currentSchedule.targetId}
                            onChange={e => setCurrentSchedule({...currentSchedule, targetId: e.target.value})}
                            className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                          >
                            <option value="">请选择工作流</option>
                            {availableWorkflows.map(wf => (
                              <option key={wf.id} value={wf.id}>{wf.name} ({wf.id})</option>
                            ))}
                          </select>
                        ) : ((currentSchedule.type === 'AGENT_SUMMARY' || currentSchedule.type === 'AGENT_DEAL') && currentSchedule.config?.executorType !== 'workflow') ? (
                          <select
                            required
                            value={currentSchedule.targetId}
                            onChange={e => setCurrentSchedule({...currentSchedule, targetId: e.target.value})}
                            className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                          >
                          <option value="">请选择智能体</option>
                          {availableAgents.map(agent => (
                            <option key={agent.id} value={agent.id}>{agent.name} ({agent.id})</option>
                          ))}
                        </select>
                      ) : (
                        <input 
                          required
                          value={currentSchedule.targetId}
                          onChange={e => setCurrentSchedule({...currentSchedule, targetId: e.target.value})}
                          className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                          placeholder="all"
                        />
                      )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2">
                    <input 
                      type="checkbox"
                      id="enabled-check"
                      checked={currentSchedule.enabled}
                      onChange={e => setCurrentSchedule({...currentSchedule, enabled: e.target.checked})}
                      className="w-4 h-4 text-primary rounded border-slate-300"
                    />
                    <label htmlFor="enabled-check" className="text-sm text-slate-700 dark:text-slate-300">启用此任务</label>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">运行时覆盖配置 (JSON)</label>
                    <textarea 
                      rows={4}
                      value={configString}
                      onChange={e => setConfigString(e.target.value)}
                      className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/10 rounded-lg text-xs font-mono"
                      placeholder={currentSchedule.type === 'AGENT_SUMMARY' ? '{ "targetFields": ["ai_summary", "ai_score"] }' : '{ "foloCookie": "...", "fetchPages": 2 }'}
                    />
                    <p className="text-[10px] text-slate-400">
                      {currentSchedule.type === 'AGENT_SUMMARY' 
                        ? '支持 targetFields 定义 AI 输出字段 (如 ai_summary, ai_score, tags)' 
                        : currentSchedule.type === 'AGENT_DEAL'
                        ? '支持 input 定义 AI 输入内容，或在 config 中定义工作流参数。'
                        : '此配置将覆盖系统全局设置，仅在执行此任务时生效。'}
                    </p>
                  </div>
                </div>

                <div className="p-6 bg-slate-50 dark:bg-white/5 flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    className="bg-primary text-white text-sm font-bold px-6 py-2 rounded-lg shadow-lg shadow-primary/20"
                  >
                    保存配置
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TaskManagement;
