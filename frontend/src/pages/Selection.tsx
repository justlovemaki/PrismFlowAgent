import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getContent, regenerateSummary } from '../services/contentService';
import { getSettings } from '../services/settingsService';
import { agentService } from '../services/agentService';
import type { Agent } from '../services/agentService';
import { getTodayShanghai, formatToShanghai } from '../utils/dateUtils';
import { saveToCache, loadFromCache, CACHE_KEYS, clearExpiredCache, clearCache } from '../utils/cacheUtils';
import ContentRenderer from '../components/UI/ContentRenderer';

interface ContentItem {
  id: string;
  category: string;
  title: string;
  description: string;
  url: string;
  source?: string;
  published_date?: string;
  author?: string;
  stars?: string;
  selected: boolean;
  selectedOrder?: number; // 记录选中顺序
  metadata?: {
    tags?: string[];
    ai_summary?: string;
    ai_score?: number;
    ai_score_reason?: string;
    [key: string]: any;
  };
}

const Selection: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(dateParam || getTodayShanghai());
  const [items, setItems] = useState<ContentItem[]>([]);
  const [activeTab, setActiveTab] = useState('全部');
  const [categories, setCategories] = useState<any[]>([]);
  const [imageProxy, setImageProxy] = useState('');
  const [previewItem, setPreviewItem] = useState<ContentItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [columnCount, setColumnCount] = useState(3);
  const [selectionCounter, setSelectionCounter] = useState(0); // 用于记录选中顺序
  const [aiMode, setAiMode] = useState(false); // AI 推荐模式开关

  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [targetItem, setTargetItem] = useState<ContentItem | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (dateParam && dateParam !== date) {
      setDate(dateParam);
    }
  }, [dateParam]);

  useEffect(() => {
    loadCategories();
    loadExecutors();
  }, []);

  const loadExecutors = async () => {
    try {
      const [ags, wfs] = await Promise.all([
        agentService.getAgents(),
        agentService.getWorkflows(),
      ]);
      setAgents(ags || []);
      setWorkflows(wfs || []);
    } catch (error) {
      console.error('Failed to load agents/workflows:', error);
    }
  };

  const loadCategories = async () => {
    try {
      const settings = await getSettings();
      if (settings?.CATEGORIES) {
        setCategories(settings.CATEGORIES);
      }
      if (settings?.IMAGE_PROXY) {
        setImageProxy(settings.IMAGE_PROXY);
      }
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  };

  useEffect(() => {
    // 清除过期缓存
    clearExpiredCache();
    fetchData();
  }, [date]);

  // 响应式列数
  useEffect(() => {
    const updateColumnCount = () => {
      if (window.innerWidth >= 1024) setColumnCount(3);
      else if (window.innerWidth >= 768) setColumnCount(2);
      else setColumnCount(1);
    };
    
    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    setSearchParams({ date: newDate });
  };

  const handleForceRefresh = () => {
    // 清除当前日期的缓存并重新加载
    clearCache(CACHE_KEYS.SELECTION_ITEMS, date);
    fetchData();
  };

  const fetchData = async () => {
    setLoading(true);

    // 尝试从缓存加载：先展示缓存，再后台刷新，避免历史存档等新数据被旧缓存遮蔽
    const cachedItems = loadFromCache<ContentItem[]>(CACHE_KEYS.SELECTION_ITEMS, date);
    const hasCachedData = !!(cachedItems && cachedItems.length > 0);

    if (hasCachedData) {
      setItems(cachedItems!);
      // 计算最大的选中顺序，并设置计数器
      const maxOrder = cachedItems!.reduce((max, item) => Math.max(max, item.selectedOrder || 0), 0);
      setSelectionCounter(maxOrder);
      setLoading(false);
    } else {
      // 无缓存时才先清空，避免刷新失败导致已有内容闪空
      setItems([]);
      setSelectionCounter(0);
    }

    try {
      const res = await getContent(date);
      // Flatten the categorized data: { github: [], news: [], paper: [] }
      const flattened: ContentItem[] = [];

      Object.entries(res).forEach(([category, list]: [string, any]) => {
        if (Array.isArray(list)) {
          console.log(`[Selection] 处理分类: ${category}, 数据条数: ${list.length}`);
          list.forEach(item => {
            flattened.push({
              ...item,
              category,
              selected: false, // Default to not selected
              source: item.source,
              published_date: item.published_date || item.time || ''
            });
          });
        }
      });

      console.log(`[Selection] 总共加载 ${flattened.length} 条数据`);
      
      setItems(prev => {
        // 合并选中状态：如果当前已有选中的项目，保留其选中状态
        const selectedMap = new Map();
        prev.forEach(item => {
          if (item.selected) {
            selectedMap.set(`${item.category}-${item.id}`, {
              selected: true,
              selectedOrder: item.selectedOrder
            });
          }
        });

        const merged = flattened.map(item => {
          const state = selectedMap.get(`${item.category}-${item.id}`);
          if (state) {
            return { ...item, ...state };
          }
          return item;
        });

        // 只有当数据不为空时才保存到缓存
        if (merged.length > 0) {
          saveToCache(CACHE_KEYS.SELECTION_ITEMS, merged, date);
        }
        return merged;
      });
    } catch (error) {
      console.error('Failed to fetch content:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = (category: string, id: string) => {
    setItems(prev => {
      const updated = prev.map(item => {
        if (item.id === id && item.category === category) {
          if (item.selected) {
            // 取消选中，移除顺序标记
            return { ...item, selected: false, selectedOrder: undefined };
          } else {
            // 选中，添加顺序标记
            setSelectionCounter(c => c + 1);
            return { ...item, selected: true, selectedOrder: selectionCounter + 1 };
          }
        }
        return item;
      });
      // 保存到缓存
      saveToCache(CACHE_KEYS.SELECTION_ITEMS, updated, date);
      return updated;
    });
  };

  const handleSelectAll = () => {
    const visibleIds = new Set(filteredItems.map(item => `${item.category}-${item.id}`));
    setItems(prev => {
      let counter = selectionCounter;
      const updated = prev.map(item => {
        if (visibleIds.has(`${item.category}-${item.id}`) && !item.selected) {
          counter++;
          return { ...item, selected: true, selectedOrder: counter };
        }
        return item;
      });
      setSelectionCounter(counter);
      // 保存到缓存
      saveToCache(CACHE_KEYS.SELECTION_ITEMS, updated, date);
      return updated;
    });
  };

  const handleDeselectAll = () => {
    const visibleIds = new Set(filteredItems.map(item => `${item.category}-${item.id}`));
    setItems(prev => {
      const updated = prev.map(item =>
        visibleIds.has(`${item.category}-${item.id}`) ? { ...item, selected: false, selectedOrder: undefined } : item
      );
      // 保存到缓存
      saveToCache(CACHE_KEYS.SELECTION_ITEMS, updated, date);
      return updated;
    });
  };

  const handleGenerate = () => {
    // 按选中顺序排序
    const sortedSelectedItems = items
      .filter(i => i.selected)
      .sort((a, b) => (a.selectedOrder || 0) - (b.selectedOrder || 0));
    
    if (sortedSelectedItems.length === 0) return;

    const selectedIds = sortedSelectedItems.map(i => `${i.category}:${i.id}`);
    navigate('/generation', { state: { date, selectedIds, selectedItems: sortedSelectedItems } });
  };

  const handleRegenerateClick = (item: ContentItem) => {
    setTargetItem(item);
    setShowAgentSelector(true);
  };

  const onSelectAgent = async (agentId: string) => {
    if (!targetItem) return;
    
    setRegenerating(true);
    try {
      const result = await regenerateSummary(targetItem.id, agentId);
      if (result && result.ai_summary) {
        // 更新本地状态
        setItems(prev => {
          const updated = prev.map(item => {
            if (item.id === targetItem.id && item.category === targetItem.category) {
              return {
                ...item,
                metadata: {
                  ...item.metadata,
                  ai_summary: result.ai_summary
                }
              };
            }
            return item;
          });
          // 同时更新缓存
          saveToCache(CACHE_KEYS.SELECTION_ITEMS, updated, date);
          return updated;
        });
        setShowAgentSelector(false);
        setTargetItem(null);
      }
    } catch (error) {
      console.error('Failed to regenerate summary:', error);
    } finally {
      setRegenerating(false);
    }
  };

  const filteredItems = items.filter(item => {
    // 分类过滤
    const cat = item.category.toLowerCase();
    
    // 获取当前有效的分类 ID 列表
    const validCategoryIds = new Set(categories.map(c => c.id.toLowerCase()));
    validCategoryIds.add('history'); // 历史存档始终有效

    let categoryMatch = true;
    if (activeTab === '全部') {
      // 在“全部”模式下，只显示在有效分类列表中的项目，避免显示已删除分类的残留数据
      categoryMatch = validCategoryIds.has(cat);
    }
    else if (activeTab === '历史存档') {
      categoryMatch = cat === 'history';
    }
    else {
      // 查找当前选中的页签对应的分类 ID
      const activeCat = categories.find(c => 
        c.label === activeTab || 
        c.id === activeTab ||
        c.label.toLowerCase() === activeTab.toLowerCase() ||
        c.id.toLowerCase() === activeTab.toLowerCase()
      );
      
      if (activeCat) {
        // 使用 ID 进行匹配 (忽略大小写)
        categoryMatch = cat === activeCat.id.toLowerCase();
      } else {
        // 如果没找到分类配置，且不是全部/历史存档，则不匹配
        categoryMatch = false;
      }
    }

    
    // 搜索过滤
    if (!searchQuery.trim()) return categoryMatch;
    
    const query = searchQuery.toLowerCase();
    const titleMatch = item.title.toLowerCase().includes(query);
    const descMatch = item.description.toLowerCase().includes(query);
    const sourceMatch = item.source?.toLowerCase().includes(query);
    const authorMatch = item.author?.toLowerCase().includes(query);
    
    return categoryMatch && (titleMatch || descMatch || sourceMatch || authorMatch);
  }).sort((a, b) => {
    const dateA = a.published_date ? new Date(a.published_date).getTime() : 0;
    const dateB = b.published_date ? new Date(b.published_date).getTime() : 0;

    // 如果开启了 AI 推荐模式，按分数和时间综合排序
    if (aiMode) {
      // 先按日期（天）排序
      const dayA = new Date(dateA).setHours(0, 0, 0, 0);
      const dayB = new Date(dateB).setHours(0, 0, 0, 0);
      
      if (dayB !== dayA) {
        return dayB - dayA;
      }
      
      // 同一天内，按 AI 分数排序
      const scoreA = a.metadata?.ai_score || 0;
      const scoreB = b.metadata?.ai_score || 0;
      
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      
      // 如果分数也相同，按具体时间排序
      return dateB - dateA;
    }
    // 按时间降序排序（最新的在前）
    return dateB - dateA;
  });


  const selectedCount = items.filter(i => i.selected).length;

  // 将数据分配到各列，按时间从左到右排序
  const distributeToColumns = (items: ContentItem[]) => {
    const columns: ContentItem[][] = Array.from({ length: columnCount }, () => []);
    
    items.forEach((item, index) => {
      const columnIndex = index % columnCount;
      columns[columnIndex].push(item);
    });
    
    return columns;
  };

  const getTypeStyle = (category: string) => {
    const cat = category.toLowerCase();
    
    if (cat === 'githubtrending') return 'bg-slate-900 dark:bg-[#24292e] text-white border-slate-800';
    if (cat === 'news') return 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20';
    if (cat === 'paper') return 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-500/20';
    if (cat === 'social' || cat === 'socialmedia') return 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-500/20';
    if (cat === 'history') return 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20';
    
    return 'bg-primary/10 text-primary border-primary/20';
  };

  const getIcon = (category: string) => {
    const cat = category.toLowerCase();
    if (cat === 'history') return 'archive';
    const config = categories.find(c => c.id.toLowerCase() === cat);
    if (config && config.icon) return config.icon;
    return 'public';
  };


  const columns = distributeToColumns(filteredItems);



  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">内容筛选</h1>
          <p className="text-slate-500 dark:text-text-secondary text-sm">筛选用于生成的原始素材 (Github, Papers, News, Social 等)</p>
        </div>
        <div className="flex items-center gap-3 bg-white dark:bg-surface-dark p-1.5 rounded-lg border border-slate-200 dark:border-border-dark shadow-sm">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-text-secondary">
              <span className="material-symbols-outlined text-[20px]">calendar_today</span>
            </div>
            <input 
              className="bg-slate-50 dark:bg-surface-darker text-slate-900 dark:text-white text-sm rounded border-none focus:ring-1 focus:ring-primary pl-10 pr-3 py-1.5 min-w-[160px] cursor-pointer" 
              type="date" 
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              onClick={(e) => (e.target as any).showPicker?.()}
            />
          </div>
          <div className="h-6 w-px bg-slate-200 dark:bg-border-dark"></div>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-text-secondary">
              <span className="material-symbols-outlined text-[20px]">search</span>
            </div>
            <input 
              className="bg-slate-50 dark:bg-surface-darker text-slate-900 dark:text-white text-sm rounded border-none focus:ring-1 focus:ring-primary pl-10 pr-3 py-1.5 min-w-[200px]" 
              type="text" 
              placeholder="搜索标题、描述、来源..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-10 bg-background-light dark:bg-background-dark pt-2 pb-4 space-y-4">
        <div className="border-b border-slate-200 dark:border-border-dark">
          <div className="flex gap-8 min-w-max px-2">
            {['全部', '历史存档', ...categories.map(c => c.label)].map((tab) => (
              <button 
                key={tab} 
                onClick={() => setActiveTab(tab)}
                className={`pb-3 border-b-2 text-sm font-medium px-1 transition-colors ${activeTab === tab ? 'border-primary text-slate-900 dark:text-white' : 'border-transparent text-slate-500 dark:text-text-secondary hover:text-primary'}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-between items-center">
          <div className="flex gap-4">
            <button 
              onClick={handleSelectAll}
              className="text-xs font-medium text-primary hover:text-cyan-400 flex items-center gap-1 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">done_all</span>
              全选当前
            </button>
            <button 
              onClick={handleDeselectAll}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-text-secondary dark:hover:text-white flex items-center gap-1 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">deselect</span>
              全不选
            </button>
            {activeTab !== '全部' && activeTab !== '历史存档' && (
              <button 
                onClick={() => setAiMode(!aiMode)}
                className={`text-xs font-medium flex items-center gap-1 transition-colors ${aiMode ? 'text-amber-500 hover:text-amber-400' : 'text-slate-500 hover:text-primary dark:text-text-secondary dark:hover:text-white'}`}
                title={aiMode ? '切换到时间排序' : '切换到 AI 评分排序'}
              >
                <span className={`material-symbols-outlined text-sm ${aiMode ? 'fill-current' : ''}`}>auto_awesome</span>
                {aiMode ? 'AI 推荐已开启' : '开启 AI 推荐'}
              </button>
            )}
            <button 
              onClick={handleForceRefresh}

              className="text-xs font-medium text-amber-600 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300 flex items-center gap-1 transition-colors"
              title="清除缓存并重新加载数据"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              强制刷新
            </button>
          </div>
          <div className="text-xs text-slate-400 dark:text-text-secondary">
            共 {filteredItems.length} 个项目 (总计 {items.length} 项)
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <p className="text-slate-500 dark:text-text-secondary animate-pulse">流光溢彩，正在获取深度洞察...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {columns.map((column, columnIndex) => (
            <div key={columnIndex} className="flex flex-col gap-4">
              {column.map((item) => (
                <motion.div 
                  key={`${item.category}-${item.id}`}
                  layout
                  onClick={() => toggleItem(item.category, item.id)}
                  className={`group relative border-2 rounded-xl p-3 transition-all cursor-pointer ${
                    item.selected 
                      ? 'bg-white dark:bg-surface-dark border-primary shadow-[0_0_15px_rgba(12,175,207,0.1)]' 
                      : 'bg-white dark:bg-surface-dark border-slate-200 dark:border-border-dark hover:border-primary/50'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="relative flex items-center">
                      <input 
                        type="checkbox" 
                        checked={item.selected}
                        onChange={() => {}} 
                        className="w-5 h-5 rounded border-slate-300 dark:border-border-dark text-primary bg-background-light dark:bg-background-dark focus:ring-primary cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      {aiMode && item.metadata?.ai_score && (
                        <span className="flex items-center gap-1 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm" title={item.metadata?.ai_score_reason}>
                          <span className="material-symbols-outlined text-[12px]">grade</span>
                          {item.metadata.ai_score}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 ${getTypeStyle(item.category)}`}>
                        <span className="material-symbols-outlined text-sm">{getIcon(item.category)}</span> 
                        {categories.find(c => c.id.toLowerCase() === item.category.toLowerCase())?.label || item.category.toUpperCase()}
                      </span>
                    </div>


                  </div>
                  
                  <h3 className={`font-bold text-lg mb-2 leading-tight transition-colors line-clamp-2 break-words ${item.selected ? 'text-primary' : 'text-slate-900 dark:text-white group-hover:text-primary'}`}>
                    {item.metadata?.translated_title || item.title}
                  </h3>

                  <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-[11px] text-slate-400 dark:text-text-secondary">
                    {item.source && (
                      <span className="flex items-center gap-1 truncate max-w-full">
                        <span className="material-symbols-outlined text-xs flex-shrink-0">hub</span>
                        <span className="truncate">{item.source}</span>
                      </span>
                    )}
                    {item.author && (
                      <span className="flex items-center gap-1 truncate max-w-full">
                        <span className="material-symbols-outlined text-xs flex-shrink-0">person</span>
                        <span className="truncate">{item.author}</span>
                      </span>
                    )}
                    {item.published_date && (
                      <span className="flex items-center gap-1 truncate max-w-full" title="发布时间 (上海)">
                        <span className="material-symbols-outlined text-xs flex-shrink-0">schedule</span>
                        <span className="truncate">{formatToShanghai(item.published_date)}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <div className="text-slate-500 dark:text-text-secondary text-sm mb-4 line-clamp-5 break-words overflow-hidden">
                      <ContentRenderer 
                        content={(aiMode && item.metadata?.ai_summary) 
                          ? item.metadata.ai_summary 
                          : (item.metadata?.translated_description || item.description)} 
                        imageProxy={imageProxy}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-white/5 h-12 flex-shrink-0">
                      <div className="flex items-center">
                        {item.metadata && Object.keys(item.metadata).length > 0 && (
                          <>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewItem(item);
                              }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-all"
                              title="查看预览"
                            >
                              <span className="material-symbols-outlined text-xl">visibility</span>
                            </button>
                            {aiMode && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRegenerateClick(item);
                                }}
                                className="w-8 h-8 ml-2 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 transition-all"
                                title="重新生成 AI 摘要"
                              >
                                <span className="material-symbols-outlined text-xl">refresh</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-4">
                        {item.stars && (
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-text-secondary font-medium">
                            <span className="material-symbols-outlined text-xs text-amber-500">star</span> {item.stars}
                          </div>
                        )}
                        <a 
                          href={item.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-all"
                          title="打开链接"
                        >
                          <span className="material-symbols-outlined text-xl">open_in_new</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ))}
          {filteredItems.length === 0 && (
            <div className="col-span-full py-20 text-center text-slate-500">
              暂无内容
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-0 right-0 z-30 flex justify-center pointer-events-none px-4"
          >
            <div className="bg-white/95 dark:bg-surface-dark/95 border border-slate-200 dark:border-white/5 shadow-2xl rounded-2xl p-2 pl-6 pr-2 flex items-center gap-6 pointer-events-auto backdrop-blur-md max-w-lg w-full justify-between">
              <div className="flex flex-col">
                <span className="text-slate-900 dark:text-white font-bold text-sm">已选择 {selectedCount} 个项目</span>
                <span className="text-slate-500 dark:text-text-secondary text-xs">预计生成内容字数: ~{selectedCount * 200}字</span>
              </div>
              <button 
                onClick={handleGenerate}
                className="bg-primary hover:bg-cyan-400 text-white dark:text-background-dark font-bold text-sm px-5 py-2.5 rounded-xl shadow-lg shadow-primary/20 flex items-center gap-2 transition-all transform hover:scale-105 active:scale-95"
              >
                <span className="material-symbols-outlined text-xl">auto_awesome</span>
                生成 AI 内容
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showAgentSelector && (
          <div 
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => !regenerating && setShowAgentSelector(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-border-dark rounded-2xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-slate-500/5">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">选择执行器</h3>
                  <p className="text-xs text-slate-500 mt-1">选择一个 Agent 或工作流来重新生成 AI 摘要</p>
                </div>
                {!regenerating && (
                  <button 
                    onClick={() => setShowAgentSelector(false)}
                    className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                )}
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto">
                {regenerating ? (
                  <div className="py-10 flex flex-col items-center justify-center space-y-4">
                    <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    <p className="text-sm text-slate-500 animate-pulse">正在重新生成 AI 摘要...</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Agents Section */}
                    {agents.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm">smart_toy</span>
                          智能体 (Agents)
                        </h4>
                        {agents.map(agent => (
                          <button
                            key={agent.id}
                            onClick={() => onSelectAgent(`agent:${agent.id}`)}
                            className="w-full text-left p-4 rounded-xl border border-slate-100 dark:border-white/5 hover:border-primary hover:bg-primary/5 transition-all group"
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors">
                                {agent.name}
                              </span>
                              <span className="text-[10px] bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded text-slate-500 uppercase">
                                {agent.model}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 line-clamp-2">
                              {agent.description || '暂无描述'}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Workflows Section */}
                    {workflows.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm">account_tree</span>
                          工作流 (Workflows)
                        </h4>
                        {workflows.map(wf => (
                          <button
                            key={wf.id}
                            onClick={() => onSelectAgent(`workflow:${wf.id}`)}
                            className="w-full text-left p-4 rounded-xl border border-slate-100 dark:border-white/5 hover:border-emerald-500 hover:bg-emerald-500/5 transition-all group"
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-bold text-slate-900 dark:text-white group-hover:text-emerald-500 transition-colors">
                                {wf.name}
                              </span>
                              <span className="text-[10px] bg-emerald-100 dark:bg-emerald-500/10 px-2 py-0.5 rounded text-emerald-600 uppercase">
                                Workflow
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 line-clamp-2">
                              {wf.description || '暂无描述'}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}

                    {agents.length === 0 && workflows.length === 0 && (
                      <div className="py-10 text-center text-slate-500">
                        暂无可用智能体或工作流，请先在设置中创建
                      </div>
                    )}
                  </div>
                )}
              </div>
              {!regenerating && (
                <div className="p-4 border-t border-slate-100 dark:border-white/5 flex justify-end">
                  <button 
                    onClick={() => setShowAgentSelector(false)}
                    className="px-6 py-2 rounded-xl border border-slate-200 dark:border-border-dark text-slate-600 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-white/5 transition-all text-sm font-medium"
                  >
                    取消
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {previewItem && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setPreviewItem(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-border-dark rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-slate-500/5">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">数据预览</h3>
                  <p className="text-xs text-slate-500 mt-1">{previewItem.metadata?.translated_title || previewItem.title}</p>
                </div>
                <button 
                  onClick={() => setPreviewItem(null)}
                  className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-6 overflow-y-auto">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4">
                    {previewItem.url && (
                      <div className="flex flex-col gap-1 border-b border-slate-100 dark:border-white/5 pb-4">
                        <span className="text-xs font-bold text-primary uppercase tracking-wider">链接</span>
                        <a href={previewItem.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all flex items-center gap-1">
                          {previewItem.url}
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        </a>
                      </div>
                    )}
                    {previewItem.category && (
                      <div className="flex flex-col gap-1 border-b border-slate-100 dark:border-white/5 pb-4">
                        <span className="text-xs font-bold text-primary uppercase tracking-wider">分类</span>
                        <p className="text-sm text-slate-600 dark:text-slate-300">{previewItem.category}</p>
                      </div>
                    )}
                    {previewItem.source && (
                      <div className="flex flex-col gap-1 border-b border-slate-100 dark:border-white/5 pb-4">
                        <span className="text-xs font-bold text-primary uppercase tracking-wider">来源</span>
                        <p className="text-sm text-slate-600 dark:text-slate-300">{previewItem.source}</p>
                      </div>
                    )}
                    {previewItem.author && (
                      <div className="flex flex-col gap-1 border-b border-slate-100 dark:border-white/5 pb-4">
                        <span className="text-xs font-bold text-primary uppercase tracking-wider">作者</span>
                        <p className="text-sm text-slate-600 dark:text-slate-300">{previewItem.author}</p>
                      </div>
                    )}
                    {previewItem.published_date && (
                      <div className="flex flex-col gap-1 border-b border-slate-100 dark:border-white/5 pb-4">
                        <span className="text-xs font-bold text-primary uppercase tracking-wider">发布日期</span>
                        <p className="text-sm text-slate-600 dark:text-slate-300">{previewItem.published_date}</p>
                      </div>
                    )}
                    {Object.entries(previewItem.metadata || {}).map(([key, value]) => {
                      if (key === 'description' || key === 'translated_title' || key === 'translated_description' ) return null; // 已经在下面显示了
                      return (
                        <div key={key} className="flex flex-col gap-2 border-b border-slate-100 dark:border-white/5 pb-4 last:border-0">
                          <span className="text-xs font-bold text-primary uppercase tracking-wider">{key}</span>
                          <div className="text-sm text-slate-600 dark:text-slate-300 break-words leading-relaxed max-w-none">
                            {typeof value === 'string' ? (
                              <ContentRenderer content={value} imageProxy={imageProxy} />
                            ) : (
                              <pre className="whitespace-pre-wrap font-mono text-xs bg-slate-50 dark:bg-slate-900/50 p-2 rounded">
                                {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                              </pre>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {(previewItem.metadata?.translated_description || previewItem.description || (aiMode && previewItem.metadata?.ai_summary)) && (
                      <div className="flex flex-col gap-1 border-b border-slate-100 dark:border-white/5 pb-4 last:border-0">
                        <span className="text-xs font-bold text-primary uppercase tracking-wider">
                          {(aiMode && previewItem.metadata?.ai_summary) ? 'AI 总结' : '描述'}
                        </span>
                        <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                          <ContentRenderer 
                            content={(aiMode && previewItem.metadata?.ai_summary) 
                              ? previewItem.metadata.ai_summary 
                              : (previewItem.metadata?.translated_description || previewItem.description)} 
                            imageProxy={imageProxy} 
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3">
                <button 
                  onClick={() => setPreviewItem(null)}
                  className="px-6 py-2 rounded-xl border border-slate-200 dark:border-border-dark text-slate-600 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-white/5 transition-all text-sm font-medium"
                >
                  关闭
                </button>
                <a 
                  href={previewItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-2 rounded-xl bg-primary text-white hover:bg-cyan-400 transition-all text-sm font-medium flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  查看详情
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Selection;
