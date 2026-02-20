import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getStats, getAdapters, getLogs, triggerIngestion, syncAdapter, testAI } from '../services/dashboardService';
import { getSettings } from '../services/settingsService';
import { getTodayShanghai } from '../utils/dateUtils';
import { clearCache, CACHE_KEYS } from '../utils/cacheUtils';
import { useToast } from '../context/ToastContext.js';



interface Stats {
  todayCount: number;
  yesterdayCount: number;
  aiStatus: string;
  lastCommit: string | null;
  lastCommitPlatform: string | null;
}

interface Adapter {
  lastActive: string;
  status: string;
  count: number;
  category: string;
  type: string;
  configFields: Array<{
    key: string;
    label: string;
    type: string;
    default: any;
    options?: string[];
  }>;
  currentConfig?: Record<string, any>;
}


interface Log {
  timestamp: string;
  level: string;
  message: string;
}

const Dashboard: React.FC = () => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [statsData, setStatsData] = useState<Stats | null>(null);
  const [adaptersData, setAdaptersData] = useState<Record<string, Adapter>>({});
  const [logsData, setLogsData] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingAdapters, setSyncingAdapters] = useState<Record<string, boolean>>({});
  const [syncForm, setSyncForm] = useState<Record<string, any>>({});
  const [syncDate, setSyncDate] = useState<string>(getTodayShanghai());
  const [showSyncModal, setShowSyncModal] = useState<string | null>(null);
  const [testingAI, setTestingAI] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);

  const openSyncModal = (name: string) => {

    const adapter = adaptersData[name];
    const initialForm: Record<string, any> = {};
    if (adapter?.configFields) {
      adapter.configFields.forEach(field => {
        // 优先使用当前已配置的值 (currentConfig)，如果没有则使用默认值
        initialForm[field.key] = adapter.currentConfig?.[field.key] ?? field.default;
      });
    }
    setSyncForm(initialForm);

    setSyncDate(getTodayShanghai());
    setShowSyncModal(name);
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const [stats, adapters, logs] = await Promise.all([
        getStats(),
        getAdapters(),
        getLogs()
      ]);
      setStatsData(stats);
      setAdaptersData(adapters);
      setLogsData(logs);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAdapter = async (name: string, params: any = {}) => {
    if (syncingAdapters[name]) return;
    setSyncingAdapters(prev => ({ ...prev, [name]: true }));
    try {
      await syncAdapter(name, params);
      // 抓取成功后立即清理内容筛选页面的缓存，确保用户看到最新数据
      clearCache(CACHE_KEYS.SELECTION_ITEMS);
      await fetchData();
      toastSuccess(`同步成功: ${name}`);
    } catch (error) {

      console.error(`Sync failed for ${name}:`, error);
      toastError(`同步失败: ${error}`);
    } finally {
      setSyncingAdapters(prev => ({ ...prev, [name]: false }));
    }
  };

  const loadCategories = async () => {
    try {
      const settings = await getSettings();
      if (settings?.CATEGORIES) {
        setCategories(settings.CATEGORIES);
      }
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  };

  useEffect(() => {
    loadCategories();
    fetchData();
    // 自动刷新

    const timer = setInterval(fetchData, 60000);
    return () => clearInterval(timer);
  }, []);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await triggerIngestion();
      // 抓取成功后立即清理内容筛选页面的缓存
      clearCache(CACHE_KEYS.SELECTION_ITEMS);
      await fetchData();
      toastSuccess('抓取任务已启动');
    } catch (error) {

      console.error('Sync failed:', error);
      toastError('抓取任务启动失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleTestAI = async () => {
    if (testingAI) return;
    setTestingAI(true);
    try {
      const result = await testAI();
      if (result.status === 'healthy') {
        toastSuccess('✅ AI 服务连接正常');
      } else {
        toastError(`❌ AI 服务连接失败: ${result.message}`);
      }
      await fetchData();
    } catch (error: any) {
      console.error('AI test failed:', error);
      toastError(`❌ AI 服务测试失败: ${error.message || '未知错误'}`);
    } finally {
      setTestingAI(false);
    }
  };

  const formatLastActive = (dateStr: string) => {
    if (dateStr === '从未运行') return dateStr;
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return '刚刚';
      if (diffMins < 60) return `${diffMins} 分钟前`;
      
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} 小时前`;
      
      return dateStr.split('T')[0];
    } catch (e) {
      return dateStr;
    }
  };

  const formatLastCommit = (dateStr: string | null) => {
    if (!dateStr) return '暂无提交';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '暂无提交';
      
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return '刚刚';
      if (diffMins < 60) return `${diffMins} 分钟前`;
      
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} 小时前`;
      
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays} 天前`;
      
      return dateStr.split('T')[0];
    } catch (e) {
      return '暂无提交';
    }
  };

  const stats = [
    { 
      label: '今日聚合条目', 
      value: statsData?.todayCount.toString() || '0', 
      subValue: `昨日: ${statsData?.yesterdayCount || 0}`, 
      trend: statsData && statsData.yesterdayCount > 0 
        ? `${Math.round(((statsData.todayCount - statsData.yesterdayCount) / statsData.yesterdayCount) * 100)}%` 
        : '0%', 
      icon: 'article', 
      textColor: 'text-primary' 
    },
    { 
      label: 'AI 服务状态', 
      value: statsData?.aiStatus === 'healthy' ? '正常' : statsData?.aiStatus === 'error' ? '异常' : '未知', 
      subValue: statsData?.aiStatus === 'healthy' ? '所有模型 API 响应正常' : '检查 API 状态', 
      trend: statsData?.aiStatus === 'healthy' ? '在线' : '警告', 
      icon: 'bolt', 
      textColor: statsData?.aiStatus === 'healthy' ? 'text-accent-success' : 'text-accent-error' 
    },
    { 
      label: '上次提交', 
      value: formatLastCommit(statsData?.lastCommit || null), 
      subValue: statsData?.lastCommit 
        ? `已推送至 ${statsData.lastCommitPlatform || '平台'}` 
        : '等待首次提交', 
      trend: statsData?.lastCommitPlatform || 'Platform', 
      icon: 'schedule', 
      textColor: 'text-purple-500' 
    },
  ];

  // 适配器分类和图标映射
  const categoryMeta: Record<string, { type: string, icon: string }> = {
    'githubTrending': { type: '代码项目', icon: 'code' },
    'news': { type: '科技新闻', icon: 'newspaper' },
    'paper': { type: '学术论文', icon: 'school' },
    'socialMedia': { type: '社交媒体', icon: 'public' },
    'default': { type: '其它来源', icon: 'hub' }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-slate-900 dark:text-white text-3xl font-bold tracking-tight mb-1">仪表盘概览</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">实时监控 AI 趋势聚合与处理状态</p>
        </div>
        <button 
          onClick={fetchData}
          className="group flex items-center gap-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-slate-700 dark:text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
        >
          <span className="material-symbols-outlined text-[20px] group-hover:rotate-180 transition-transform duration-500">refresh</span>
          <span>刷新状态</span>
        </button>
      </div>

      {loading && !statsData ? (
        <div className="flex items-center justify-center py-20">
          <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {stats.map((stat, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="relative overflow-hidden rounded-xl bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 p-6 hover:border-primary/30 transition-colors group shadow-sm"
              >
                {/* 增加 z-0 并确保不响应鼠标事件 */}
                <div className="absolute right-0 top-0 p-3 opacity-20 group-hover:opacity-40 transition-opacity z-0 pointer-events-none select-none">
                  <span className={`material-symbols-outlined text-6xl ${stat.textColor}`}>{stat.icon}</span>
                </div>
                {/* 增加 z-10 确保文字和趋势标签在最上层 */}
                <div className="flex flex-col gap-4 relative z-10">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">{stat.label}</p>
                  
                  <div className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-slate-900 dark:text-white text-3xl font-bold tabular-nums">{stat.value}</p>
                      {/* AI 服务状态卡片添加测试图标 */}
                      {idx === 1 && (
                        <button
                          onClick={handleTestAI}
                          disabled={testingAI}
                          title={testingAI ? '测试中...' : '测试 AI 连接'}
                          className={`flex items-center justify-center w-5 h-5 rounded transition-all ${
                            testingAI 
                              ? 'text-primary cursor-not-allowed' 
                              : 'text-slate-400 hover:text-primary hover:bg-slate-100 dark:hover:bg-white/10'
                          }`}
                        >
                          <span className={`material-symbols-outlined text-[16px] ${testingAI ? 'animate-spin' : ''}`}>
                            {testingAI ? 'progress_activity' : 'play_circle'}
                          </span>
                        </button>
                      )}
                      {stat.trend.includes('%') && (
                        <span className={`flex items-center gap-0.5 text-xs font-bold ${
                          parseFloat(stat.trend) < 0 ? 'text-accent-error' : 
                          parseFloat(stat.trend) > 0 ? 'text-accent-success' : 'text-slate-400'
                        }`}>
                          {parseFloat(stat.trend) !== 0 && (
                            <span className="material-symbols-outlined text-[14px]">
                              {parseFloat(stat.trend) < 0 ? 'trending_down' : 'trending_up'}
                            </span>
                          )}
                          {stat.trend}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-400 dark:text-slate-500 text-xs">{stat.subValue}</p>
                  </div>
                </div>
                <div className={`absolute bottom-0 left-0 h-1 bg-gradient-to-r from-primary to-transparent w-full opacity-50`}></div>
              </motion.div>
            ))}
          </div>

          {/* Adapters Table */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-slate-900 dark:text-white text-lg font-bold tracking-tight flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">hub</span>
                数据源适配器状态
              </h3>
              <button 
                onClick={handleSync}
                disabled={syncing}
                className={`group flex items-center gap-2 bg-primary hover:bg-primary/90 active:scale-95 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all shadow-md shadow-primary/20 ${syncing ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                <span className={`material-symbols-outlined text-[16px] ${syncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`}>sync</span>
                <span>{syncing ? '抓取中...' : '立即抓取'}</span>
              </button>
            </div>
            
            <div className="w-full overflow-hidden rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-surface-dark shadow-xl shadow-black/5 dark:shadow-black/20">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5 text-xs uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider">
                      <th className="px-6 py-4 whitespace-nowrap">适配器名称</th>
                      <th className="px-6 py-4 whitespace-nowrap hidden sm:table-cell">来源类型</th>
                      <th className="px-6 py-4 whitespace-nowrap hidden md:table-cell">上次活跃</th>
                      <th className="px-6 py-4 whitespace-nowrap">状态</th>
                      <th className="px-6 py-4 whitespace-nowrap text-right">条目数</th>
                      <th className="px-6 py-4 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-sm">
                    {Object.entries(adaptersData).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-10 text-center text-slate-500">暂无数据源</td>
                      </tr>
                    ) : (
                      Object.entries(adaptersData).map(([id, adapter]) => {
                        // 查找对应的分类配置，忽略 ID 大小写差异
                        const dynamicCat = categories.find(c => 
                          c.id.toLowerCase() === adapter.category.toLowerCase() ||
                          c.label.toLowerCase() === adapter.category.toLowerCase() 
                        );
                        
                        const meta = dynamicCat 
                          ? { type: dynamicCat.label, icon: dynamicCat.icon || 'hub' }
                          : (categoryMeta[adapter.category] || categoryMeta[adapter.category.toLowerCase()] || categoryMeta.default);
                        
                        return (

                          <tr key={id} className="group hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">

                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/10 flex items-center justify-center text-slate-700 dark:text-white">
                                  <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
                                </div>
                                <span className="font-medium text-slate-900 dark:text-white">{id}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20">
                                {meta.type}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-slate-500 dark:text-slate-400 hidden md:table-cell">{formatLastActive(adapter.lastActive)}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                adapter.status === 'success' || adapter.status === '成功' ? 'bg-accent-success/10 text-accent-success' :
                                adapter.status === 'processing' || adapter.status === '处理中' || adapter.status === 'running' ? 'bg-accent-warning/10 text-accent-warning animate-pulse' :
                                adapter.status === 'idle' ? 'bg-slate-500/10 text-slate-500' :
                                'bg-accent-error/10 text-accent-error'
                              } ring-1 ring-inset ${
                                adapter.status === 'success' || adapter.status === '成功' ? 'ring-accent-success/20' :
                                adapter.status === 'processing' || adapter.status === '处理中' || adapter.status === 'running' ? 'ring-accent-warning/20' :
                                adapter.status === 'idle' ? 'ring-slate-500/20' :
                                'ring-accent-error/20'
                              }`}>
                                {(adapter.status === 'processing' || adapter.status === '处理中' || adapter.status === 'running') ? (
                                  <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                ) : (
                                  <span className={`w-1.5 h-1.5 rounded-full ${
                                    (adapter.status === 'success' || adapter.status === '成功') ? 'bg-accent-success' : 
                                    adapter.status === 'idle' ? 'bg-slate-500' : 'bg-accent-error'
                                  }`}></span>
                                )}
                                {adapter.status === 'idle' ? '未运行' :
                                 adapter.status === 'running' ? '运行中' :
                                 adapter.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-slate-900 dark:text-white font-medium tabular-nums">{adapter.count}</td>
                            <td className="px-6 py-4 text-center">
                              <button 
                                onClick={() => openSyncModal(id)}
                                disabled={syncingAdapters[id]}
                                title="手动刷新/配置抓取"
                                className={`flex items-center justify-center w-8 h-8 rounded-full transition-all ${
                                  syncingAdapters[id] 
                                    ? 'bg-primary/10 text-primary cursor-not-allowed' 
                                    : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-primary'
                                }`}
                              >
                                <span className={`material-symbols-outlined text-lg ${syncingAdapters[id] ? 'animate-spin' : ''}`}>
                                  {syncingAdapters[id] ? 'progress_activity' : 'refresh'}
                                </span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Logs Section */}
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-slate-500 text-sm">terminal</span>
              <h4 className="text-slate-500 dark:text-slate-400 text-sm font-medium">最近系统日志</h4>
            </div>
            <div className="w-full bg-slate-900 dark:bg-surface-darker border border-slate-700 dark:border-white/5 rounded-lg p-4 font-mono text-xs text-slate-300 dark:text-slate-400 h-48 overflow-y-auto relative scrollbar-thin scrollbar-thumb-slate-700">
              {logsData.length === 0 ? (
                <p className="text-slate-600">等待日志输入...</p>
              ) : (
                logsData.map((log, i) => (
                  <p key={i} className="mb-1">
                    <span className="text-blue-400">[{log.timestamp}]</span>{' '}
                    <span className={
                      log.level === 'ERROR' ? 'text-accent-error' : 
                      log.level === 'WARN' ? 'text-accent-warning' : 
                      'text-accent-success'
                    }>{log.level}</span>: {log.message}
                  </p>
                ))
              )}
            </div>
          </div>
        </>
      )}
      {/* Sync Parameters Modal */}
      <AnimatePresence>
        {showSyncModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-surface-dark w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">sync_saved_locally</span>
                  抓取设置: {showSyncModal}
                </h3>
                <button 
                  onClick={() => setShowSyncModal(null)}
                  className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">抓取日期 (默认今日)</label>
                  <input
                    type="date"
                    value={syncDate}
                    onChange={(e) => setSyncDate(e.target.value)}
                    className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/5 rounded-lg text-sm text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-primary/30 outline-none transition-all"
                  />
                </div>

                {adaptersData[showSyncModal]?.configFields?.length > 0 && (
                  <div className="space-y-4">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest border-t border-slate-100 dark:border-white/5 pt-4">可选抓取参数</p>
                    {adaptersData[showSyncModal].configFields.map(field => (
                      <div key={field.key} className="space-y-2">
                        <label className="text-xs text-slate-400">{field.label}</label>
                        {field.type === 'select' ? (
                          <select
                            value={syncForm[field.key]}
                            onChange={(e) => setSyncForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                            className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/5 rounded-lg text-sm text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-primary/30 outline-none transition-all"
                          >
                            {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            value={syncForm[field.key]}
                            onChange={(e) => setSyncForm(prev => ({ ...prev, [field.key]: field.type === 'number' ? parseInt(e.target.value) : e.target.value }))}
                            className="w-full p-2 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-white/5 rounded-lg text-sm text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-primary/30 outline-none transition-all"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-6 bg-slate-50 dark:bg-white/[0.02] flex justify-end gap-3">
                <button 
                  onClick={() => setShowSyncModal(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={() => {
                    handleSyncAdapter(showSyncModal, { date: syncDate, ...syncForm });
                    setShowSyncModal(null);
                  }}
                  className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-6 py-2 rounded-lg transition-all shadow-md shadow-primary/20 flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                  开始抓取
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dashboard;
