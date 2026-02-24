import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { publishContent, generateCoverImage, uploadWechatMaterial } from '../services/contentService';
import { agentService } from '../services/agentService';
import type { Agent, Workflow, Tool } from '../services/agentService';
import { saveToCache, loadFromCache, CACHE_KEYS, clearExpiredCache, clearCache, clearAllCache } from '../utils/cacheUtils';
import { getSettings } from '../services/settingsService';
import ContentRenderer from '../components/UI/ContentRenderer';
import { request } from '../services/api';
import { useToast } from '../context/ToastContext.js';
import { copyToClipboard as copyToClipboardUtil } from '../utils/clipboardUtils';

const Generation: React.FC = () => {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const location = useLocation();
  const { date: initialDate, result: initialResult, selectedIds: initialSelectedIds, selectedItems: initialSelectedItems } = (location.state as any) || {};
  
  const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
  const [result, setResult] = useState(initialResult || null);
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds || null);
  const [selectedItems, setSelectedItems] = useState(initialSelectedItems || null);
  const [committing, setCommitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState(initialResult ? '草稿已生成' : '');
  const [previewMode, setPreviewMode] = useState<'markdown' | 'preview'>('preview');
  const [imageProxy, setImageProxy] = useState('');

  // Publishers Metadata
  const [publishers, setPublishers] = useState<any[]>([]);

  // Commit media picker
  const [showCommitPicker, setShowCommitPicker] = useState(false);

  // WeChat Publish Modal
  const [showWechatModal, setShowWechatModal] = useState(false);
  const [wechatTitle, setWechatTitle] = useState('');
  const [wechatAuthor, setWechatAuthor] = useState('');
  const [wechatDigest, setWechatDigest] = useState('');
  const [wechatCoverMainTitle, setWechatCoverMainTitle] = useState('');
  const [wechatCoverSubtitle, setWechatCoverSubtitle] = useState('');
  const [wechatCoverCustom, setWechatCoverCustom] = useState('');
  const [selectedCoverAgentId, setSelectedCoverAgentId] = useState('');

  // 保存封面生成执行器的选择
  useEffect(() => {
    if (selectedCoverAgentId) {
      localStorage.setItem('wechat_cover_executor', selectedCoverAgentId);
    }
  }, [selectedCoverAgentId]);

  const [wechatCoverUrl, setWechatCoverUrl] = useState('');
  const [wechatThumbMediaId, setWechatThumbMediaId] = useState('');
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);

  // Item Preview
  const [previewItem, setPreviewItem] = useState<any | null>(null);

  // AI Execution Picker
  const [showAIPicker, setShowAIPicker] = useState(false);
  const [aiPickerTab, setAiPickerTab] = useState<'recent' | 'workflow' | 'agent' | 'tool'>('recent');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [aiPickerLoading, setAiPickerLoading] = useState(false);

  // Tool execution state
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [toolArguments, setToolArguments] = useState<Record<string, any>>({});

  // Mobile layout state
  const [mobileTab, setMobileTab] = useState<'source' | 'preview'>('preview');

  // 移除单条素材
  const handleRemoveItem = (idx: number) => {
    if (!selectedItems) return;
    const newItems = [...selectedItems];
    const removedItem = newItems.splice(idx, 1)[0];
    setSelectedItems(newItems.length > 0 ? newItems : null);
    
    // 同时更新 selectedIds
    if (selectedIds) {
      const newIds = selectedIds.filter((id: string) => id !== (removedItem.id || removedItem.link || removedItem.url));
      setSelectedIds(newIds.length > 0 ? newIds : null);
    }
  };

  // 历史记录状态 (保留5条)
  const [historyState, setHistoryState] = useState<{
    list: any[];
    index: number;
  }>({ list: [], index: -1 });

  // Recent AI selections (persisted in localStorage, max 6 unique)
  type RecentAISelection = { type: 'workflow' | 'agent'; id: string; name: string };
  const RECENT_KEY = 'ai_picker_recent';
  const loadRecent = (): RecentAISelection[] => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  };
  const saveRecentSelection = (item: RecentAISelection) => {
    const prev = loadRecent().filter(r => !(r.type === item.type && r.id === item.id));
    const next = [item, ...prev].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  // 加载缓存数据
  useEffect(() => {
    clearExpiredCache();
    
    // 如果没有从路由传递数据，尝试从缓存加载
    if (!initialResult) {
      const cachedResult = loadFromCache(CACHE_KEYS.GENERATION_RESULT, date);
      if (cachedResult) {
        setResult(cachedResult);
        setStatus('草稿已生成（从缓存恢复）');
      }
    }
    
    if (!initialSelectedIds) {
      const cachedSelectedIds = loadFromCache(CACHE_KEYS.GENERATION_SELECTED_IDS, date);
      if (cachedSelectedIds) {
        setSelectedIds(cachedSelectedIds);
      }
    }
    
    if (!initialSelectedItems) {
      const cachedSelectedItems = loadFromCache(CACHE_KEYS.GENERATION_SELECTED_ITEMS, date);
      if (cachedSelectedItems) {
        setSelectedItems(cachedSelectedItems);
      }
    }
  }, [date]);

  // 保存数据到缓存
  useEffect(() => {
    if (result) {
      saveToCache(CACHE_KEYS.GENERATION_RESULT, result, date);
    }
  }, [result, date]);

  // 历史记录逻辑
  useEffect(() => {
    if (!result) return;
    
    const timer = setTimeout(() => {
      setHistoryState(prev => {
        const { list, index } = prev;
        // 只有在内容真正变化且不是由历史导航引起时，才添加新记录
        if (list.length > 0 && index >= 0 && list[index]?.daily_summary_markdown === result.daily_summary_markdown) {
          return prev;
        }
        const newList = list.slice(0, index + 1);
        newList.push(JSON.parse(JSON.stringify(result)));
        const finalList = newList.slice(-5);
        return {
          list: finalList,
          index: finalList.length - 1
        };
      });
    }, 500); // 500ms 防抖

    return () => clearTimeout(timer);
  }, [result]);

  const handleUndo = () => {
    const { list, index } = historyState;
    if (index > 0) {
      const nextIndex = index - 1;
      setHistoryState({ ...historyState, index: nextIndex });
      setResult(list[nextIndex]);
    }
  };

  const handleRedo = () => {
    const { list, index } = historyState;
    if (index < list.length - 1) {
      const nextIndex = index + 1;
      setHistoryState({ ...historyState, index: nextIndex });
      setResult(list[nextIndex]);
    }
  };

  useEffect(() => {
    if (selectedIds) {
      saveToCache(CACHE_KEYS.GENERATION_SELECTED_IDS, selectedIds, date);
    }
  }, [selectedIds, date]);

  useEffect(() => {
    if (selectedItems) {
      saveToCache(CACHE_KEYS.GENERATION_SELECTED_ITEMS, selectedItems, date);
    }
  }, [selectedItems, date]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [settings, metadata] = await Promise.all([
          getSettings(),
          request('/api/plugins/metadata')
        ]);

        if (settings?.IMAGE_PROXY) {
          setImageProxy(settings.IMAGE_PROXY);
        }

        if (metadata && metadata.publishers) {
          const closedPlugins = settings?.CLOSED_PLUGINS || [];
          const filteredPublishers = metadata.publishers.filter((p: any) => !closedPlugins.includes(p.id));
          setPublishers(filteredPublishers);
        }
      } catch (e) {
        console.error('Failed to load initial data:', e);
      }
    };
    loadInitialData();
  }, []);

  const commitTargets = publishers.length > 0 ? publishers.map(p => ({
    key: p.id,
    label: p.name,
    icon: p.icon || 'publish',
    desc: p.description || `发布到 ${p.name}`
  })) : [
    { key: 'github', label: 'GitHub', icon: 'code', desc: '提交到 GitHub 仓库' },
    { key: 'wechat', label: '微信公众号', icon: 'chat', desc: '发布到微信公众号草稿箱' },
  ];

  const openCommitPicker = () => {
    if (!result) {
      toastInfo('没有可提交的内容');
      return;
    }
    setShowCommitPicker(true);
  };

  const handleSelectCommitTarget = async (target: string) => {
    if (target === 'wechat') {
      // 初始化微信发布弹窗的数据
      const displayDate = date.replace(/-/g, '/');
      // 尝试获取设置中的作者和标题
      try {
        const settings = await getSettings();
        // 从 PUBLISHERS 数组中找到微信发布器的配置
        const wechatPublisher = settings?.PUBLISHERS?.find((p: any) => p.id === 'wechat');
        const wechatConfig = wechatPublisher?.config || {};
        
        setWechatAuthor(wechatConfig.author || '');
        const title = `${wechatConfig.title || ''} ${displayDate}`.trim();
        setWechatTitle(title);
      } catch (e) {
        setWechatAuthor('');
        setWechatTitle(displayDate);
      }
      
      // 初始化封面提示词
      setWechatCoverMainTitle('Main Title');
      setWechatCoverSubtitle('Sub Title');
      setWechatCoverCustom('比例: 16:9,  优化文案后输出.');
      
      // 摘要默认为空
      setWechatDigest('');

      // 加载 Agent、工作流列表以供封面生成使用
      try {
        const [ags, wfs] = await Promise.all([
          agentService.getAgents(),
          agentService.getWorkflows(),
        ]);
        setAgents(ags || []);
        setWorkflows(wfs || []);
        
        // 尝试加载上次选中的执行器 (仅限智能体或工作流)
        const savedExecutorId = localStorage.getItem('wechat_cover_executor');
        if (savedExecutorId) {
          const [type, id] = savedExecutorId.split(':');
          if (type === 'tool') {
            // 如果上次选中的是已弃用的工具执行器，则重置为第一个智能体
            if (ags && ags.length > 0) setSelectedCoverAgentId(`agent:${ags[0].id}`);
            else if (wfs && wfs.length > 0) setSelectedCoverAgentId(`workflow:${wfs[0].id}`);
          } else {
            let exists = false;
            if (type === 'agent') exists = ags?.some((a: Agent) => a.id === id);
            else if (type === 'workflow') exists = wfs?.some((w: Workflow) => w.id === id);
            
            if (exists) {
              setSelectedCoverAgentId(savedExecutorId);
            } else {
              if (ags && ags.length > 0) setSelectedCoverAgentId(`agent:${ags[0].id}`);
              else if (wfs && wfs.length > 0) setSelectedCoverAgentId(`workflow:${wfs[0].id}`);
            }
          }
        } else {
          // 优先选择第一个 Agent 作为默认值
          if (ags && ags.length > 0) {
            setSelectedCoverAgentId(`agent:${ags[0].id}`);
          } else if (wfs && wfs.length > 0) {
            setSelectedCoverAgentId(`workflow:${wfs[0].id}`);
          }
        }
      } catch (e) {
        console.error('Failed to load agents/workflows/tools for cover generation:', e);
      }

      setShowCommitPicker(false);
      setShowWechatModal(true);
    } else {
      setShowCommitPicker(false);
      await handleCommit(target);
    }
  };

  const handleCommit = async (target: string, options: any = {}) => {
    if (!result) {
      toastInfo('没有可提交的内容');
      return;
    }
    setCommitting(true);
    const targetLabel = commitTargets.find(t => t.key === target)?.label || target;
    setStatus(`正在提交到 ${targetLabel}...`);
    try {
      let payload: any = {
        content: result.daily_summary_markdown,
        date: date,
        ...options
      };

      const res = await publishContent(target, payload);
      
      setStatus(`已成功提交到 ${targetLabel} (${date})`);
      if (res.data?.media_id) {
        toastSuccess(`已成功提交到 ${targetLabel} (${date})\nMedia ID: ${res.data.media_id}`);
      } else {
        toastSuccess(`已成功提交到 ${targetLabel} (${date})`);
      }

      if (target === 'wechat') {
        setShowWechatModal(false);
      }
    } catch (error: any) {
      console.error('Commit failed:', error);
      const errorMsg = error.response?.data?.error || error.message || '未知错误';
      setStatus(`提交失败: ${errorMsg}`);
      toastError(`提交失败: ${errorMsg}`);
    } finally {
      setCommitting(false);
    }
  };

  const handleGenerateCover = async () => {
    // 构造最终提示词
    const combinedPrompt = `${wechatCoverMainTitle} - ${wechatCoverSubtitle}. ${wechatCoverCustom}`.trim();
    if (!combinedPrompt) return;
    
    setIsGeneratingCover(true);
    try {
      // 统一通过 generateCoverImage 调用，后端现在支持 tool: 前缀
      const res = await generateCoverImage(combinedPrompt, selectedCoverAgentId, date);
      
      if (res && res.url) {
        setWechatCoverUrl(res.url);
        // 上传到微信素材库
        const materialRes = await uploadWechatMaterial(res.url);
        if (materialRes.media_id) {
          setWechatThumbMediaId(materialRes.media_id);
          setStatus('封面图生成并上传成功');
          toastSuccess('封面图生成并上传成功');
        }
      }
    } catch (error: any) {
      console.error('Generate cover failed:', error);
      toastError('生成封面失败: ' + error.message);
    } finally {
      setIsGeneratingCover(false);
    }
  };

  const openAIPicker = async () => {
    if (!selectedIds || selectedIds.length === 0) {
      toastInfo('没有选择任何内容，请返回筛选页面');
      return;
    }
    setShowAIPicker(true);
    setAiPickerTab(loadRecent().length > 0 ? 'recent' : 'workflow');
    setAiPickerLoading(true);
    try {
      const [wfs, ags, tls] = await Promise.all([
        agentService.getWorkflows(),
        agentService.getAgents(),
        agentService.getTools(),
      ]);
      setWorkflows(wfs || []);
      setAgents(ags || []);
      setTools(tls || []);
    } catch (e) {
      console.error('Failed to load AI resources:', e);
    } finally {
      setAiPickerLoading(false);
    }
  };

  const handleRunTool = async (tool: Tool, input: string | Record<string, any>) => {
    saveRecentSelection({ type: 'tool' as any, id: tool.id, name: tool.name });
    setShowAIPicker(false);
    setGenerating(true);
    setStatus(`正在执行工具 "${tool.name}"...`);
    try {
      let args: any;
      if (typeof input === 'string') {
        // 尝试解析输入为 JSON，如果失败则作为普通字符串包装在主参数中
        try {
          args = JSON.parse(input);
          if (args && typeof args === 'object' && !Array.isArray(args)) {
            args.date = date;
          }
        } catch {
          // 启发式：根据工具参数寻找最合适的参数名
          const props = tool.parameters?.properties || {};
          const required = tool.parameters?.required || [];
          const firstParam = required[0] || Object.keys(props)[0] || 'input';
          args = { [firstParam]: input, date: date };
        }
      } else {
        // 可视化填写的参数
        args = { ...input, date: date };
      }

      const res = await agentService.runTool(tool.id, args);
      if (res.success) {
        if (res.content) {
          setResult({ daily_summary_markdown: res.content });
        } else if (res.data) {
          setResult({ daily_summary_markdown: typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2) });
        }
        setStatus(`工具 "${tool.name}" 执行成功`);
      } else {
        throw new Error(res.error || '执行失败');
      }
    } catch (error: any) {
      console.error('Tool run failed:', error);
      setStatus(`工具执行失败: ${error.message}`);
      toastError(`工具执行失败: ${error.message}`);
    } finally {
      setGenerating(false);
      setSelectedTool(null);
    }
  };

  const handleRunWithWorkflow = async (wf: Workflow) => {
    saveRecentSelection({ type: 'workflow', id: wf.id, name: wf.name });
    setShowAIPicker(false);
    setGenerating(true);
    setStatus(`正在通过工作流 "${wf.name}" 生成内容...`);
    try {
      const inputPayload = selectedItems
        ? JSON.stringify(selectedItems.map(({ selected, id, ...rest }: any) => {
            if (rest.metadata?.ai_summary) {
              const { content_html, ...restMetadata } = rest.metadata;
              return { ...rest, metadata: restMetadata };
            }
            return rest;
          }))
        : JSON.stringify(selectedIds);
      const res = await agentService.runWorkflow(wf.id, inputPayload, date);
      const content = res?.content || (typeof res === 'string' ? res : JSON.stringify(res, null, 2));
      setResult({ daily_summary_markdown: content });
      setStatus(`工作流 "${wf.name}" 生成成功`);
    } catch (error: any) {
      console.error('Workflow run failed:', error);
      setStatus(`工作流执行失败: ${error.message}`);
      toastError(`工作流执行失败: ${error.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleRunWithAgent = async (agent: Agent) => {
    saveRecentSelection({ type: 'agent', id: agent.id, name: agent.name });
    setShowAIPicker(false);
    setGenerating(true);
    setStatus(`正在通过 Agent "${agent.name}" 生成内容...`);
    try {
      const inputText = selectedItems
        ? JSON.stringify(selectedItems.map(({ selected, id, ...rest }: any) => {
            if (rest.metadata?.ai_summary) {
              const { content_html, ...restMetadata } = rest.metadata;
              return { ...rest, metadata: restMetadata };
            }
            return rest;
          }))
        : JSON.stringify(selectedIds);
      const res = await agentService.runAgent(agent.id, inputText, date);
      const content = res?.content || (typeof res === 'string' ? res : JSON.stringify(res, null, 2));
      setResult({ daily_summary_markdown: content });
      setStatus(`Agent "${agent.name}" 生成成功`);
    } catch (error: any) {
      console.error('Agent run failed:', error);
      setStatus(`Agent 执行失败: ${error.message}`);
      toastError(`Agent 执行失败: ${error.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    const success = await copyToClipboardUtil(text);
    if (success) {
      toastSuccess('已复制到剪贴板');
    } else {
      toastError('复制失败');
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-slate-900 dark:text-white text-2xl font-bold tracking-tight">生成与预览</h1>
          <p className="text-slate-500 dark:text-text-secondary text-sm">管理每日趋势聚合与内容生成。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 bg-white dark:bg-surface-dark p-1.5 rounded-lg border border-slate-200 dark:border-border-dark shadow-sm w-full sm:w-auto">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-text-secondary">
              <span className="material-symbols-outlined text-[20px]">calendar_today</span>
            </div>
            <input 
              className="bg-slate-50 dark:bg-surface-darker text-slate-900 dark:text-white text-sm rounded border-none focus:ring-1 focus:ring-primary pl-10 pr-3 py-1.5 min-w-[140px] sm:min-w-[160px] cursor-pointer" 
              type="date" 
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onClick={(e) => (e.target as any).showPicker?.()}
            />
          </div>
          <div className="h-6 w-px bg-slate-200 dark:bg-border-dark"></div>
          <button 
            onClick={openAIPicker}
            disabled={generating || !selectedIds}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded bg-primary hover:bg-cyan-400 disabled:bg-slate-400 transition-colors text-white dark:text-surface-darker text-sm font-bold px-4 py-1.5 shadow-lg shadow-primary/20"
          >
            {generating ? (
              <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            ) : (
              <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            )}
            <span>{generating ? '正在生成...' : '生成AI内容'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-background-dark shadow-sm">
        {/* Left: Selected Content */}
        <div className={`w-full md:w-80 md:flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-slate-200 dark:border-border-dark bg-slate-50 dark:bg-surface-darker/50 ${mobileTab === 'source' ? 'flex flex-1' : 'hidden'} md:h-auto shrink-0`}>
          <div className="flex items-center justify-between px-4 py-2 h-12 border-b border-slate-200 dark:border-border-dark bg-slate-100 dark:bg-surface-darker shrink-0">
            <div className="flex items-center gap-2 text-slate-500 dark:text-text-secondary">
              <span className="material-symbols-outlined text-[16px]">list_alt</span>
              <span className="text-sm font-mono font-medium uppercase tracking-wider">待处理内容 ({selectedItems?.length || 0})</span>
            </div>
            {selectedItems && selectedItems.length > 0 && (
              <button 
                onClick={() => {
                  const cleanedItems = selectedItems.map(({ selected, id, ...rest }: any) => {
                    if (rest.metadata?.ai_summary) {
                      const { content_html, ...restMetadata } = rest.metadata;
                      return { ...rest, metadata: restMetadata };
                    }
                    return rest;
                  });
                  copyToClipboard(JSON.stringify(cleanedItems, null, 2));
                }}
                className="text-slate-400 hover:text-primary p-1 rounded hover:bg-slate-200 dark:hover:bg-surface-dark transition"
                title="复制素材 JSON"
              >
                <span className="material-symbols-outlined text-[14px]">content_copy</span>
              </button>
            )}
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-3 no-scrollbar">
            {selectedItems && selectedItems.length > 0 ? (
              selectedItems.map((item: any, idx: number) => (
                <div 
                  key={idx} 
                  onClick={() => setPreviewItem(item)}
                  className="bg-white dark:bg-surface-dark p-2.5 rounded-lg border border-slate-200 dark:border-border-dark shadow-sm group relative cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveItem(idx);
                    }}
                    className="absolute top-1.5 right-1.5 p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-md opacity-0 group-hover:opacity-100 transition-all z-10"
                    title="移除"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      {item.category.toUpperCase()}
                    </span>
                    {item.source && (
                      <span className="ml-auto text-[9px] text-slate-400 dark:text-text-secondary truncate max-w-[100px]">
                        {item.source}
                      </span>
                    )}
                  </div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-0.5 line-clamp-1">{item.metadata?.translated_title || item.title}</h3>
                  <p className="text-[10px] text-slate-500 dark:text-text-secondary line-clamp-1">{item.metadata?.translated_description || item.description}</p>
                </div>
              ))
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 italic text-center px-4 text-xs">
                暂无选择内容
              </div>
            )}
          </div>
        </div>

        {/* Right: Markdown Preview */}
        <div className={`flex-1 flex-col min-w-0 min-h-0 ${mobileTab === 'preview' ? 'flex' : 'hidden md:flex'}`}>
          <div className="flex items-center justify-between px-3 sm:px-4 py-2 h-12 border-b border-slate-200 dark:border-border-dark bg-slate-100 dark:bg-surface-darker shrink-0 overflow-x-auto no-scrollbar">
            {/* Left Section: Title and History */}
            <div className="flex items-center gap-1 text-slate-500 dark:text-text-secondary">
              <span className="material-symbols-outlined text-[18px] shrink-0 hidden sm:block">markdown</span>
              <span className="text-xs sm:text-sm font-mono font-medium uppercase tracking-wider whitespace-nowrap shrink-0">生成预览</span>
              
              {/* 撤回/重做按钮 */}
              <div className="flex items-center gap-0.5 ml-0.5 sm:ml-1 pl-0.5 sm:pl-1 border-l border-slate-200 dark:border-border-dark shrink-0">
                <button 
                  onClick={handleUndo}
                  disabled={historyState.index <= 0}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-surface-dark disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="撤回"
                >
                  <span className="material-symbols-outlined text-[16px]">undo</span>
                </button>
                <button 
                  onClick={handleRedo}
                  disabled={historyState.index >= historyState.list.length - 1}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-surface-dark disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="重做"
                >
                  <span className="material-symbols-outlined text-[16px]">redo</span>
                </button>
              </div>
            </div>
            
            {/* Center Section: View Mode Tabs */}
            <div className="flex justify-center px-1 sm:px-2">
              <div className="flex bg-slate-100 dark:bg-surface-dark rounded p-0.5 border border-slate-200 dark:border-border-dark shrink-0">
                <button 
                  onClick={() => setPreviewMode('preview')}
                  className={`px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-medium rounded-sm transition-colors ${previewMode === 'preview' ? 'bg-primary text-white' : 'text-slate-500 hover:text-slate-700 dark:text-text-secondary dark:hover:text-white'}`}
                >
                  预览
                </button>
                <button 
                  onClick={() => setPreviewMode('markdown')}
                  className={`px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-medium rounded-sm transition-colors ${previewMode === 'markdown' ? 'bg-primary text-white' : 'text-slate-500 hover:text-slate-700 dark:text-text-secondary dark:hover:text-white'}`}
                >
                  编辑
                </button>
              </div>
            </div>

            {/* Right Section: Stats and Actions */}
            <div className="flex items-center justify-end gap-1 sm:gap-1.5">
              {result && (
                <button 
                  onClick={() => copyToClipboard(result.daily_summary_markdown)}
                  className="text-slate-400 hover:text-primary p-1 rounded hover:bg-slate-200 dark:hover:bg-surface-dark transition shrink-0"
                  title="复制"
                >
                  <span className="material-symbols-outlined text-[16px]">content_copy</span>
                </button>
              )}
              {result && (
                <button 
                  onClick={() => {
                    if (confirm('确定要清除生成的预览内容吗？')) {
                      setResult(null);
                      setHistoryState({ list: [], index: -1 });
                      setStatus('内容已清除');
                      clearCache(CACHE_KEYS.GENERATION_RESULT, date);
                    }
                  }}
                  className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-slate-200 dark:hover:bg-surface-dark transition shrink-0"
                  title="清除"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              )}
            </div>
          </div>
          <div className={`flex-1 overflow-auto no-scrollbar ${previewMode === 'preview' ? 'p-3 sm:p-4 md:p-8 max-w-3xl mx-auto w-full' : 'p-2 sm:p-3 flex flex-col'}`}>
            {result ? (
              previewMode === 'preview' ? (
                <ContentRenderer 
                  content={result.daily_summary_markdown} 
                  imageProxy={imageProxy}
                  className="font-sans text-slate-700 dark:text-slate-300"
                />
              ) : (
                <div className="flex-1 flex flex-col relative">
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded bg-slate-200/50 dark:bg-white/5 backdrop-blur-sm pointer-events-none">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="text-[9px] text-slate-500 dark:text-text-secondary font-medium uppercase tracking-wider">编辑模式</span>
                  </div>
                  <textarea 
                    value={result.daily_summary_markdown}
                    onChange={(e) => setResult({ ...result, daily_summary_markdown: e.target.value })}
                    className="flex-1 w-full font-mono text-[11px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-surface-darker/30 p-3 rounded-lg border border-slate-100 dark:border-white/5 focus:ring-1 focus:ring-primary outline-none resize-none leading-relaxed"
                    spellCheck={false}
                  />
                </div>
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
                <span className="material-symbols-outlined text-3xl mb-2">auto_awesome_mosaic</span>
                <p className="text-sm">{generating ? 'AI 正在努力生成中...' : '待生成预览内容'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Footer Actions */}
      <div className="mt-4 flex flex-col sm:flex-row items-center justify-between bg-white dark:bg-surface-darker p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-border-dark shadow-sm gap-3 sm:gap-0">
        {/* Mobile Tab Switcher */}
        <div className="flex md:hidden w-full bg-slate-100 dark:bg-surface-dark rounded-lg p-1 border border-slate-200 dark:border-border-dark">
          <button 
            onClick={() => setMobileTab('source')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition-all ${mobileTab === 'source' ? 'bg-white dark:bg-surface-darker text-primary shadow-sm' : 'text-slate-500'}`}
          >
            <span className="material-symbols-outlined text-[18px]">list_alt</span>
            素材列表
          </button>
          <button 
            onClick={() => setMobileTab('preview')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition-all ${mobileTab === 'preview' ? 'bg-white dark:bg-surface-darker text-primary shadow-sm' : 'text-slate-500'}`}
          >
            <span className="material-symbols-outlined text-[18px]">markdown</span>
            生成预览
          </button>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className={`h-2 w-2 rounded-full ${status.includes('成功') ? 'bg-accent-success' : status.includes('失败') ? 'bg-red-500' : 'bg-primary'}`}></div>
          <span className="text-xs text-slate-500 dark:text-text-secondary font-mono truncate">
            状态: {status || '待命'}
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <button 
            onClick={() => { 
              if (confirm('确定要清除所有缓存吗？这将清除所有日期的缓存数据。')) {
                clearAllCache();
                setResult(null);
                setHistoryState({ list: [], index: -1 });
                setSelectedIds(null);
                setSelectedItems(null);
                setStatus('已清除所有缓存');
                toastSuccess('已清除所有缓存');
              }
            }}
            className="flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-500 dark:text-text-secondary hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors border border-transparent flex items-center justify-center gap-1.5"
            title="清除所有缓存数据"
          >
            <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
            <span>清除缓存</span>
          </button>
          <button 
            onClick={openCommitPicker}
            disabled={committing || !result}
            className="flex-[1.5] sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-2 rounded-lg bg-primary hover:bg-cyan-400 disabled:bg-slate-400 text-white font-bold transition-all shadow-lg shadow-primary/20 text-sm sm:text-base"
          >
            {committing ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            ) : (
              <span className="material-symbols-outlined text-[18px]">publish</span>
            )}
            <span>{committing ? '正在提交...' : '提交'}</span>
          </button>
        </div>
      </div>

      {/* Item Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setPreviewItem(null)}>
          <div className="bg-white dark:bg-surface-dark w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-border-dark overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-border-dark flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <span className="text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
                  {previewItem.category?.toUpperCase()}
                </span>
                <h3 className="text-sm sm:text-lg font-bold text-slate-900 dark:text-white truncate">{previewItem.metadata?.translated_title || previewItem.title}</h3>
              </div>
              <button onClick={() => setPreviewItem(null)} className="w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all shrink-0 ml-2">
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 sm:p-6">
              <div className="space-y-4">
                {previewItem.url && (
                  <div>
                    <h4 className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">链接</h4>
                    <a href={previewItem.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all text-xs sm:text-sm flex items-center gap-1">
                      {previewItem.url}
                      <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    </a>
                  </div>
                )}
                {previewItem.author && (
                  <div>
                    <h4 className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">作者</h4>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">{previewItem.author}</p>
                  </div>
                )}
                {(previewItem.published_date) && (
                  <div>
                    <h4 className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">发布日期</h4>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">{previewItem.published_date}</p>
                  </div>
                )}
                {previewItem.source && (
                  <div>
                    <h4 className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">来源</h4>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">{previewItem.source}</p>
                  </div>
                )}
                {previewItem.metadata?.content_html && (
                  <div>
                    <h4 className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">HTML 内容</h4>
                    <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-surface-darker/50 p-3 sm:p-4 rounded-xl border border-slate-100 dark:border-white/5 overflow-wrap-anywhere">
                      <ContentRenderer 
                        content={previewItem.metadata.content_html} 
                        imageProxy={imageProxy}
                      />
                    </div>
                  </div>
                )}
                {previewItem.metadata?.full_content && (
                  <div>
                    <h4 className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">全文内容</h4>
                    <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-surface-darker/50 p-3 sm:p-4 rounded-xl border border-slate-100 dark:border-white/5 overflow-wrap-anywhere">
                      <ContentRenderer 
                        content={previewItem.metadata.full_content} 
                        imageProxy={imageProxy}
                      />
                    </div>
                  </div>
                )}
                {(previewItem.metadata?.ai_summary || previewItem.metadata?.translated_description || previewItem.description) && (
                  <div>
                    <h4 className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">基本描述</h4>
                    <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-surface-darker/50 p-3 sm:p-4 rounded-xl border border-slate-100 dark:border-white/5">
                      <ContentRenderer content={previewItem.metadata?.ai_summary || previewItem.metadata?.translated_description || previewItem.description} imageProxy={imageProxy} />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 dark:border-border-dark flex justify-end bg-slate-50/50 dark:bg-surface-darker/30">
              <button 
                onClick={() => setPreviewItem(null)}
                className="w-full sm:w-auto px-6 py-2 rounded-xl text-sm font-bold bg-primary hover:bg-cyan-400 text-white shadow-lg shadow-primary/20 transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WeChat Publish Modal */}
      {showWechatModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm" >
          <div className="bg-white dark:bg-surface-dark w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-border-dark overflow-hidden flex flex-col max-h-[95vh] sm:max-h-none" onClick={e => e.stopPropagation()}>
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-border-dark flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                  <span className="material-symbols-outlined text-lg sm:text-xl">chat</span>
                </div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">发布到微信公众号</h3>
              </div>
              <button onClick={() => setShowWechatModal(false)} className="w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>
            
            <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-auto max-h-[70vh]">
              {/* Title Section */}
              <div className="space-y-1.5 sm:space-y-2">
                <label className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">文章标题</label>
                <input 
                  type="text"
                  value={wechatTitle}
                  onChange={(e) => setWechatTitle(e.target.value)}
                  className="w-full px-4 py-2.5 sm:py-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="请输入文章标题"
                />
              </div>

              {/* Author Section */}
              <div className="space-y-1.5 sm:space-y-2">
                <label className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">作者</label>
                <input 
                  type="text"
                  value={wechatAuthor}
                  onChange={(e) => setWechatAuthor(e.target.value)}
                  className="w-full px-4 py-2.5 sm:py-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="请输入作者名称"
                />
              </div>

              {/* Digest Section */}
              <div className="space-y-1.5 sm:space-y-2">
                <label className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">文章摘要 (选填)</label>
                <textarea 
                  value={wechatDigest}
                  onChange={(e) => setWechatDigest(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2.5 sm:py-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"
                  placeholder="请输入文章摘要，不填则自动从正文提取"
                />
              </div>

              {/* Cover Image Section */}
              <div className="space-y-3 sm:space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0 ml-1">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">封面图</label>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase whitespace-nowrap">执行器:</span>
                      <select 
                        value={selectedCoverAgentId}
                        onChange={(e) => setSelectedCoverAgentId(e.target.value)}
                        className="text-[10px] bg-slate-100 dark:bg-white/5 border-none rounded px-2 py-1 text-primary focus:ring-1 focus:ring-primary/30 cursor-pointer max-w-[120px]"
                      >
                        <optgroup label="智能体 (Agents)">
                          {agents.map(agent => (
                            <option key={agent.id} value={`agent:${agent.id}`}>{agent.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="工作流 (Workflows)">
                          {workflows.map(wf => (
                            <option key={wf.id} value={`workflow:${wf.id}`}>{wf.name}</option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                    <button 
                      disabled={isGeneratingCover || !selectedCoverAgentId }
                      onClick={handleGenerateCover}
                      className="flex items-center gap-1.5 px-3 py-1 bg-primary/10 hover:bg-primary text-primary hover:text-white rounded-lg transition-all text-[10px] font-bold border border-primary/20"
                    >
                      {isGeneratingCover ? (
                        <div className="w-3 h-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      ) : (
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>magic_button</span>
                      )}
                      <span>{wechatCoverUrl ? '重新生成' : 'AI 生成封面'}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">主标题</label>
                    <input 
                      type="text"
                      value={wechatCoverMainTitle}
                      onChange={(e) => setWechatCoverMainTitle(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                      placeholder="主标题"
                    />
                  </div>
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">副标题</label>
                    <input 
                      type="text"
                      value={wechatCoverSubtitle}
                      onChange={(e) => setWechatCoverSubtitle(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                      placeholder="副标题"
                    />
                  </div>
                </div>
                <div className="space-y-1.5 sm:space-y-2">
                  <label className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">自定义提示词</label>
                  <textarea 
                    value={wechatCoverCustom}
                    onChange={(e) => setWechatCoverCustom(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"
                    placeholder="请输入封面图生成提示词"
                  />
                </div>
                
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden border-2 border-dashed border-slate-200 dark:border-white/10 aspect-[2.35/1] bg-slate-50 dark:bg-black/20 flex items-center justify-center">
                    {wechatCoverUrl ? (
                      <img src={wechatCoverUrl} className="w-full h-full object-cover" alt="Cover" />
                    ) : (
                      <div className="text-center p-4">
                        <span className="material-symbols-outlined text-2xl sm:text-3xl text-slate-300 dark:text-slate-600 mb-2">image</span>
                        <p className="text-[10px] sm:text-xs text-slate-400 font-medium">微信将默认使用正文第一张图作为封面</p>
                      </div>
                    )}
                  </div>

                  {wechatCoverUrl && !wechatThumbMediaId && !isGeneratingCover && (
                    <div className="flex justify-center">
                      <button 
                        onClick={async () => {
                          setIsGeneratingCover(true);
                          try {
                            const materialRes = await uploadWechatMaterial(wechatCoverUrl);
                            if (materialRes.media_id) {
                              setWechatThumbMediaId(materialRes.media_id);
                              toastSuccess('封面图重新提交成功');
                            }
                          } catch (error: any) {
                            toastError('重新提交失败: ' + error.message);
                          } finally {
                            setIsGeneratingCover(false);
                          }
                        }}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500/10 hover:bg-amber-500 text-amber-600 hover:text-white rounded-xl transition-all text-xs font-bold border border-amber-500/20"
                      >
                        <span className="material-symbols-outlined text-sm">cloud_upload</span>
                        重新提交图片到微信
                      </button>
                    </div>
                  )}
                  
                  {wechatThumbMediaId && (
                    <div className="flex items-center justify-center gap-1.5 py-1 px-3 bg-green-500/10 rounded-full w-fit mx-auto border border-green-500/20">
                      <span className="material-symbols-outlined text-green-500 text-sm">check_circle</span>
                      <span className="text-[9px] sm:text-[10px] text-green-500 font-mono font-bold">封面已就绪</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 dark:border-border-dark flex flex-col sm:flex-row gap-2 sm:gap-3 bg-slate-50/50 dark:bg-surface-darker/30">
              <button 
                onClick={() => setShowWechatModal(false)}
                className="order-2 sm:order-1 flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
              >
                取消
              </button>
              <button 
                onClick={() => handleCommit('wechat', { title: wechatTitle, author: wechatAuthor, digest: wechatDigest, thumbMediaId: wechatThumbMediaId, showVoice: false })}
                disabled={committing || !wechatTitle}
                className="order-1 sm:order-2 flex-[2] px-6 py-2.5 rounded-xl text-sm font-bold bg-primary hover:bg-cyan-400 text-white shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {committing ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <span className="material-symbols-outlined text-lg">check_circle</span>
                )}
                <span>确认发布草稿</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Execution Picker Modal */}
      {showAIPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAIPicker(false)}>
          <div className="bg-white dark:bg-surface-dark w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-border-dark overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-slate-100 dark:border-border-dark shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-lg sm:text-xl">auto_awesome</span>
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">选择 AI 执行方式</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-text-secondary">选择使用工作流或 Agent 来处理内容</p>
                  </div>
                </div>
                <button onClick={() => setShowAIPicker(false)} className="w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>
              {/* Tabs */}
              <div className="flex gap-0.5 sm:gap-1 mt-3 sm:mt-4 bg-slate-100 dark:bg-surface-darker rounded-lg p-1 overflow-x-auto no-scrollbar">
                {([
                  { key: 'recent', label: '最近', icon: 'history' },
                  { key: 'workflow', label: '工作流', icon: 'account_tree' },
                  { key: 'agent', label: 'Agent', icon: 'smart_toy' },
                  { key: 'tool', label: '工具', icon: 'build' },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setAiPickerTab(tab.key);
                      setSelectedTool(null);
                    }}
                    className={`flex-1 flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-[10px] sm:text-xs font-bold transition-all whitespace-nowrap ${
                      aiPickerTab === tab.key
                        ? 'bg-white dark:bg-surface-dark text-primary shadow-sm'
                        : 'text-slate-500 dark:text-text-secondary hover:text-slate-700 dark:hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px] sm:text-sm">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="p-3 sm:p-4 overflow-auto flex-1">
              {aiPickerLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <div className="w-6 h-6 border-2 border-slate-200 border-t-primary rounded-full animate-spin mr-3"></div>
                  加载中...
                </div>
              ) : aiPickerTab === 'recent' ? (
                (() => {
                  const recents = loadRecent();
                  if (recents.length === 0) return (
                    <div className="text-center py-8 sm:py-12 text-slate-400">
                      <span className="material-symbols-outlined text-3xl mb-2 block">history</span>
                      <p className="text-sm">暂无最近使用记录</p>
                    </div>
                  );
                  const typeConfig = { 
                    workflow: { icon: 'account_tree', color: 'emerald', label: '工作流' }, 
                    agent: { icon: 'smart_toy', color: 'primary', label: 'Agent' },
                    tool: { icon: 'build', color: 'amber', label: '工具' }
                  } as const;
                        const handleRecentClick = (r: any) => {
                          if (r.type === 'workflow') {
                            const wf = workflows.find(w => w.id === r.id);
                            if (wf) handleRunWithWorkflow(wf);
                            else { toastError(`工作流 "${r.name}" 已不存在`); }
                          } else if (r.type === 'agent') {
                            const ag = agents.find(a => a.id === r.id);
                            if (ag) handleRunWithAgent(ag);
                            else { toastError(`Agent "${r.name}" 已不存在`); }
                          } else if (r.type === 'tool') {
                            const tl = tools.find(t => t.id === r.id);
                            if (tl) {
                              setSelectedTool(tl);
                              setAiPickerTab('tool');
                              // 初始化参数
                              const props = tl.parameters?.properties || {};
                              const required = tl.parameters?.required || [];
                              const firstParam = required[0] || Object.keys(props)[0] || 'input';
                              const defaultInput = result?.daily_summary_markdown || 
                                                  (selectedItems ? JSON.stringify(selectedItems, null, 2) : '');
                              setToolArguments({ [firstParam]: defaultInput });
                            }
                            else { toastError(`工具 "${r.name}" 已不存在`); }
                          }
                        };
                  return (
                    <div className="space-y-2">
                      {recents.map((r, idx) => {
                        const cfg = typeConfig[r.type as keyof typeof typeConfig] || typeConfig.agent;
                        const colorMap: Record<string, string> = {
                          emerald: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:border-emerald-400 dark:hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/5',
                          primary: 'bg-primary/10 text-primary hover:border-primary dark:hover:border-primary hover:bg-primary/5',
                          amber: 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:border-amber-400 dark:hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-500/5',
                        };
                        const iconColors: Record<string, string> = {
                          emerald: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
                          primary: 'bg-primary/10 text-primary',
                          amber: 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400',
                        };
                        return (
                          <button
                            key={`${r.type}-${r.id}-${idx}`}
                            onClick={() => handleRecentClick(r)}
                            className={`w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-border-dark transition-all group text-left ${colorMap[cfg.color]?.split(' ').filter(c => c.startsWith('hover:')).join(' ')}`}
                          >
                            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${iconColors[cfg.color]}`}>
                              <span className="material-symbols-outlined text-lg sm:text-xl">{cfg.icon}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm truncate">{r.name}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold ${iconColors[cfg.color]}`}>
                                  <span className="material-symbols-outlined" style={{ fontSize: '10px' }}>{cfg.icon}</span>
                                  {cfg.label}
                                </span>
                              </div>
                            </div>
                            <span className="material-symbols-outlined text-slate-300 dark:text-white/10 group-hover:text-primary transition-colors text-lg sm:text-xl">play_arrow</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()
              ) : aiPickerTab === 'workflow' ? (
                workflows.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <span className="material-symbols-outlined text-3xl mb-2 block">account_tree</span>
                    <p className="text-sm">暂无工作流，请在智能体页面创建</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workflows.map(wf => (
                      <button
                        key={wf.id}
                        onClick={() => handleRunWithWorkflow(wf)}
                        className="w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-border-dark hover:border-emerald-400 dark:hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/5 transition-all group text-left"
                      >
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                          <span className="material-symbols-outlined text-lg sm:text-xl">account_tree</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors truncate">{wf.name}</div>
                          {wf.description && <div className="text-[10px] sm:text-xs text-slate-500 dark:text-text-secondary mt-0.5 truncate">{wf.description}</div>}
                          <div className="text-[9px] sm:text-[10px] text-slate-400 mt-1">{wf.steps?.length || 0} 个步骤</div>
                        </div>
                        <span className="material-symbols-outlined text-slate-300 dark:text-white/10 group-hover:text-emerald-500 transition-colors text-lg sm:text-xl">play_arrow</span>
                      </button>
                    ))}
                  </div>
                )
              ) : aiPickerTab === 'agent' ? (
                agents.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <span className="material-symbols-outlined text-3xl mb-2 block">smart_toy</span>
                    <p className="text-sm">暂无 Agent，请在智能体页面创建</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {agents.map(agent => (
                      <button
                        key={agent.id}
                        onClick={() => handleRunWithAgent(agent)}
                        className="w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-border-dark hover:border-primary dark:hover:border-primary hover:bg-primary/5 transition-all group text-left"
                      >
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <span className="material-symbols-outlined text-lg sm:text-xl">smart_toy</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm group-hover:text-primary transition-colors truncate">{agent.name}</div>
                          {agent.description && <div className="text-[10px] sm:text-xs text-slate-500 dark:text-text-secondary mt-0.5 truncate">{agent.description}</div>}
                          <div className="text-[9px] sm:text-[10px] text-slate-400 mt-1 font-mono truncate">{agent.model || '默认模型'}</div>
                        </div>
                        <span className="material-symbols-outlined text-slate-300 dark:text-white/10 group-hover:text-primary transition-colors text-lg sm:text-xl">play_arrow</span>
                      </button>
                    ))}
                  </div>
                )
              ) : (
                selectedTool ? (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <button 
                      onClick={() => {
                        setSelectedTool(null);
                        setToolArguments({});
                      }}
                      className="flex items-center gap-1 text-[10px] sm:text-xs text-primary hover:underline mb-2"
                    >
                      <span className="material-symbols-outlined text-sm">arrow_back</span>
                      返回工具列表
                    </button>
                    <div className="bg-slate-50 dark:bg-surface-darker p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-border-dark">
                      <div className="flex items-center gap-2 sm:gap-3 mb-2">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
                          <span className="material-symbols-outlined text-base sm:text-lg">build</span>
                        </div>
                        <h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">{selectedTool.name}</h4>
                      </div>
                      <p className="text-[10px] sm:text-xs text-slate-500 dark:text-text-secondary">{selectedTool.description}</p>
                    </div>
                    
                    <div className="space-y-4 max-h-[40vh] overflow-y-auto px-1 no-scrollbar">
                      {Object.entries(selectedTool.parameters?.properties || {}).map(([key, prop]: [string, any]) => {
                        // 排除 date，因为会自动注入
                        if (key === 'date') return null;
                        
                        const isRequired = selectedTool.parameters?.required?.includes(key);
                        const type = prop.type || 'string';
                        
                        return (
                          <div key={key} className="space-y-1.5">
                            <div className="flex justify-between items-center">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                {prop.title || key} {isRequired && <span className="text-red-500">*</span>}
                              </label>
                              {prop.description && (
                                <span className="text-[9px] text-slate-400 italic max-w-[60%] truncate" title={prop.description}>
                                  {prop.description}
                                </span>
                              )}
                            </div>
                            
                            {prop.enum ? (
                              <div className="relative">
                                <select
                                  value={toolArguments[key] || ''}
                                  onChange={e => setToolArguments({ ...toolArguments, [key]: e.target.value })}
                                  className="w-full appearance-none px-3 py-2 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all dark:text-white cursor-pointer"
                                >
                                  <option value="">请选择...</option>
                                  {prop.enum.map((v: string) => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-sm">
                                  expand_more
                                </span>
                              </div>
                            ) : type === 'boolean' ? (
                              <div className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-white/[0.02] rounded-xl border border-slate-200 dark:border-white/5">
                                <span className="text-[10px] text-slate-500">启用</span>
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={!!toolArguments[key]}
                                    onChange={e => setToolArguments({ ...toolArguments, [key]: e.target.checked })}
                                  />
                                  <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-primary transition-all after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                                </label>
                              </div>
                            ) : type === 'number' || type === 'integer' ? (
                              <input
                                type="number"
                                value={toolArguments[key] ?? ''}
                                onChange={e => setToolArguments({ ...toolArguments, [key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                                placeholder={prop.default !== undefined ? `默认: ${prop.default}` : ''}
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all dark:text-white"
                              />
                            ) : (
                              <textarea
                                value={toolArguments[key] || ''}
                                onChange={e => setToolArguments({ ...toolArguments, [key]: e.target.value })}
                                placeholder={prop.default !== undefined ? `默认: ${prop.default}` : '请输入内容...'}
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all dark:text-white min-h-[60px] resize-y"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button 
                      onClick={() => handleRunTool(selectedTool, toolArguments)}
                      className="w-full py-2.5 sm:py-3 rounded-xl bg-primary hover:bg-cyan-400 text-white font-bold shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 text-sm sm:text-base"
                    >
                      <span className="material-symbols-outlined text-lg">play_arrow</span>
                      立即执行
                    </button>
                  </div>
                ) : (
                  tools.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <span className="material-symbols-outlined text-3xl mb-2 block">build</span>
                      <p className="text-sm">暂无可用工具</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tools.map(tool => (
                        <button
                          key={tool.id}
                          onClick={() => {
                            setSelectedTool(tool);
                            const props = tool.parameters?.properties || {};
                            const required = tool.parameters?.required || [];
                            const firstParam = required[0] || Object.keys(props)[0] || 'input';
                            const defaultInput = result?.daily_summary_markdown || 
                                                (selectedItems ? JSON.stringify(selectedItems.map(({ selected, id, description, ...rest }: any) => {
                                                  if (rest.metadata?.ai_summary) {
                                                    const { content_html, ...restMetadata } = rest.metadata;
                                                    return { ...rest, metadata: restMetadata };
                                                  }
                                                  return rest;
                                                }), null, 2) : '');
                            setToolArguments({ [firstParam]: defaultInput });
                          }}
                          className="w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-border-dark hover:border-amber-400 dark:hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-500/5 transition-all group text-left"
                        >
                          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                            <span className="material-symbols-outlined text-lg sm:text-xl">build</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors truncate">{tool.name}</div>
                              {(tool as any).isBuiltin ? (
                                <span className="px-1 py-0.5 rounded text-[7px] sm:text-[8px] font-black bg-primary/10 text-primary uppercase tracking-wider shrink-0">内置</span>
                              ) : (
                                <span className="px-1 py-0.5 rounded text-[7px] sm:text-[8px] font-black bg-amber-100 dark:bg-amber-500/20 text-amber-600 uppercase tracking-wider shrink-0">自定义</span>
                              )}
                            </div>
                            {tool.description && <div className="text-[10px] sm:text-xs text-slate-500 dark:text-text-secondary mt-0.5 line-clamp-1">{tool.description}</div>}
                          </div>
                          <span className="material-symbols-outlined text-slate-300 dark:text-white/10 group-hover:text-amber-500 transition-colors text-lg sm:text-xl">arrow_forward</span>
                        </button>
                      ))}
                    </div>
                  )
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Commit Media Picker Modal */}
      {showCommitPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowCommitPicker(false)}>
          <div className="bg-white dark:bg-surface-dark w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 dark:border-border-dark overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 sm:p-6">
              <div className="flex items-center gap-3 mb-4 sm:mb-5">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-lg sm:text-xl">publish</span>
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">选择提交渠道</h3>
                  <p className="text-[10px] sm:text-xs text-slate-500 dark:text-text-secondary">选择内容发布的目标平台</p>
                </div>
              </div>
              <div className="space-y-2">
                {commitTargets.map(target => (
                  <button
                    key={target.key}
                    onClick={() => handleSelectCommitTarget(target.key)}
                    className="w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border transition-all group text-left border-slate-200 dark:border-border-dark hover:border-primary hover:bg-primary/5 dark:hover:bg-primary/5"
                  >
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary">
                      <span className="material-symbols-outlined text-lg sm:text-xl">{target.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">{target.label}</span>
                      </div>
                      <div className="text-[10px] sm:text-xs text-slate-400 dark:text-text-secondary mt-0.5">{target.desc}</div>
                    </div>
                    <span className="material-symbols-outlined text-slate-300 dark:text-white/10 group-hover:text-primary transition-colors text-lg sm:text-xl">arrow_forward</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowCommitPicker(false)}
                className="w-full mt-4 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-500 dark:text-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Generation;
