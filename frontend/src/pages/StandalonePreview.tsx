import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ContentRenderer from '../components/UI/ContentRenderer';
import { loadFromCache, CACHE_KEYS } from '../utils/cacheUtils';
import { getSettings } from '../services/settingsService';
import { useToast } from '../context/ToastContext.js';
import { copyToClipboard as copyToClipboardUtil } from '../utils/clipboardUtils';

const StandalonePreview: React.FC = () => {
  const [searchParams] = useSearchParams();
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const { success: toastSuccess, error: toastError } = useToast();
  
  const [content, setContent] = useState('');
  const [previewMode, setPreviewMode] = useState<'markdown' | 'preview'>('preview');
  const [imageProxy, setImageProxy] = useState('');
  
  const channelRef = useRef<BroadcastChannel | null>(null);

  // 初始化加载
  useEffect(() => {
    // 加载缓存
    const cachedResult = loadFromCache(CACHE_KEYS.GENERATION_RESULT, date) as any;
    if (cachedResult && cachedResult.daily_summary_markdown) {
      setContent(cachedResult.daily_summary_markdown);
    }

    // 加载设置 (图片代理)
    getSettings().then(settings => {
      if (settings?.IMAGE_PROXY) {
        setImageProxy(settings.IMAGE_PROXY);
      }
    });

    // 建立通信通道
    const channel = new BroadcastChannel('generation_sync');
    channelRef.current = channel;

    // 监听来自主页面的同步
    channel.onmessage = (event) => {
      if (event.data && event.data.type === 'update_content' && event.data.date === date) {
        setContent(event.data.content);
      }
    };

    return () => {
      channel.close();
    };
  }, [date]);

  // 当内容修改时同步回主页面
  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'update_content',
        date,
        content: newContent,
        source: 'standalone'
      });
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
    <div className="flex flex-col h-screen bg-white dark:bg-background-dark overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-border-dark bg-slate-50 dark:bg-surface-darker shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <span className="material-symbols-outlined text-lg">edit_note</span>
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">编辑与预览</h1>
            <p className="text-[10px] sm:text-xs text-slate-500 dark:text-text-secondary font-mono">{date}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* View Mode Tabs */}
          <div className="flex bg-slate-100 dark:bg-surface-dark rounded p-0.5 border border-slate-200 dark:border-border-dark shrink-0">
            <button 
              onClick={() => setPreviewMode('preview')}
              className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${previewMode === 'preview' ? 'bg-primary text-white' : 'text-slate-500 hover:text-slate-700 dark:text-text-secondary dark:hover:text-white'}`}
            >
              预览
            </button>
            <button 
              onClick={() => setPreviewMode('markdown')}
              className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${previewMode === 'markdown' ? 'bg-primary text-white' : 'text-slate-500 hover:text-slate-700 dark:text-text-secondary dark:hover:text-white'}`}
            >
              编辑
            </button>
          </div>

          <div className="h-6 w-px bg-slate-200 dark:bg-border-dark mx-1"></div>

          <button 
            onClick={() => copyToClipboard(content)}
            className="text-slate-400 hover:text-primary p-1.5 rounded hover:bg-slate-200 dark:hover:bg-surface-dark transition shrink-0"
            title="复制"
          >
            <span className="material-symbols-outlined text-[20px]">content_copy</span>
          </button>
          
          <button 
            onClick={() => window.close()}
            className="text-slate-400 hover:text-red-500 p-1.5 rounded hover:bg-slate-200 dark:hover:bg-surface-dark transition shrink-0"
            title="关闭页面"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className={`flex-1 overflow-auto no-scrollbar ${previewMode === 'preview' ? 'p-4 sm:p-8 md:p-12 lg:p-16 max-w-4xl mx-auto w-full' : 'p-4 flex flex-col'}`}>
        {content ? (
          previewMode === 'preview' ? (
            <ContentRenderer 
              content={content} 
              imageProxy={imageProxy}
              className="font-sans text-slate-700 dark:text-slate-300"
            />
          ) : (
            <div className="flex-1 flex flex-col relative">
              <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 px-2 py-1 rounded bg-slate-200/50 dark:bg-white/5 backdrop-blur-sm pointer-events-none">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[9px] text-slate-500 dark:text-text-secondary font-medium uppercase tracking-wider">实时同步</span>
              </div>
              <textarea 
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                className="flex-1 w-full font-mono text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-surface-darker/30 p-4 rounded-xl border border-slate-100 dark:border-white/5 focus:ring-1 focus:ring-primary outline-none resize-none leading-relaxed"
                spellCheck={false}
                placeholder="在此输入内容..."
              />
            </div>
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
            <span className="material-symbols-outlined text-4xl mb-3">edit_document</span>
            <p>暂无内容可以编辑</p>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2 bg-slate-50 dark:bg-surface-darker border-t border-slate-200 dark:border-border-dark flex items-center justify-between text-[10px] text-slate-400 font-mono">
        <div className="flex items-center gap-4">
          <span>字符数: {content.length}</span>
          <span>行数: {content.split('\n').length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
          <span>已连接到主窗口</span>
        </div>
      </div>
    </div>
  );
};

export default StandalonePreview;
