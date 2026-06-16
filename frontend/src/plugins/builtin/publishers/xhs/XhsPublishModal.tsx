import { useEffect, useMemo, useState } from 'react';
import { publishContent } from '../../../../services/contentService';
import { getSettings } from '../../../../services/settingsService';
import ContentRenderer from '../../../../components/UI/ContentRenderer';

interface XhsPublishModalProps {
  date: string;
  content: string;
  onClose: () => void;
  onSuccess: (data: any) => void;
  onError: (error: string) => void;
}

const markdownImageRegex = /!\[.*?\]\((.*?)\)/g;
const plainImageRegex = /(?<!\()https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|gif|webp|avif)(?:[?#][^\s)]*)?/gi;

const extractImageUrls = (text: string): string[] => {
  const mdMatches = [...text.matchAll(markdownImageRegex)].map(m => m[1]);
  const plainMatches = [...text.matchAll(plainImageRegex)].map(m => m[0]);
  return Array.from(new Set([...mdMatches, ...plainMatches]));
};

const removeImageSyntaxFromContent = (text: string): string => {
  let next = text.replace(/!\[.*?\]\((.*?)\)\s?/g, '');
  next = next.replace(plainImageRegex, '');
  next = next.replace(/\n{3,}/g, '\n\n');
  return next.trim();
};

const XhsPublishModal: React.FC<XhsPublishModalProps> = ({ date, content, onClose, onSuccess, onError }) => {
  const [title, setTitle] = useState('');
  const [postType, setPostType] = useState<'normal' | 'long'>('normal');
  const [isDraft, setIsDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [currentContent, setCurrentContent] = useState(content);
  const [showContentPreview, setShowContentPreview] = useState(false);
  const [contentViewMode, setContentViewMode] = useState<'preview' | 'edit'>('edit');
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  useEffect(() => {
    const initData = async () => {
      const titleMatch = content.match(/^#\s+(.+)$/m);
      if (titleMatch && titleMatch[1]) {
        setTitle(titleMatch[1].trim());
      } else {
        const displayDate = date.replace(/-/g, '/');
        setTitle(`AI资讯日报 ${displayDate}`);
      }

      const extractedUrls = extractImageUrls(content);
      setImageUrls(extractedUrls);
      setCurrentContent(removeImageSyntaxFromContent(content));

      try {
        const settings = await getSettings();
        const xhsPublisher = settings?.PUBLISHERS?.find((p: any) => p.id === 'xhs');
        const xhsConfig = xhsPublisher?.config || {};
        setIsDraft(xhsConfig.isDraft === true);
      } catch {
        setIsDraft(false);
      }
    };

    initData();
  }, [content, date]);

  const handleExtractImages = () => {
    const extractedUrls = extractImageUrls(currentContent);
    if (extractedUrls.length === 0) {
      onError('正文中未发现图片链接');
      return;
    }

    const merged = Array.from(new Set([...imageUrls, ...extractedUrls]));
    setImageUrls(merged);
    setCurrentContent(removeImageSyntaxFromContent(currentContent));
  };

  const handleMoveImage = (index: number, direction: 'prev' | 'next') => {
    setImageUrls(prev => {
      const next = [...prev];
      if (direction === 'prev' && index > 0) {
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
      }
      if (direction === 'next' && index < next.length - 1) {
        [next[index + 1], next[index]] = [next[index], next[index + 1]];
      }
      return next;
    });
  };

  const displayCount = useMemo(() => currentContent.length, [currentContent]);

  const handlePublish = async () => {
    if (!currentContent) return;
    setPublishing(true);
    try {
      const payload: { content: string; [key: string]: any } = {
        content: currentContent,
        date,
        title,
        postType,
        isDraft
      };

      if (postType === 'normal') {
        payload.imageUrls = imageUrls.length > 0 ? imageUrls : undefined;
      }

      const res = await publishContent('xhs', payload);
      onSuccess(res.data);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message || '未知错误';
      onError(errorMsg);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-surface-dark w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-border-dark overflow-hidden flex flex-col max-h-[95vh]" onClick={e => e.stopPropagation()}>
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-border-dark flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
              <span className="material-symbols-outlined text-lg sm:text-xl">book</span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">发布到小红书</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="px-4 sm:px-6 py-2.5 bg-amber-50 dark:bg-amber-950/10 border-b border-amber-200/60 dark:border-amber-900/20 flex items-center gap-2 text-[11px] sm:text-xs text-amber-700 dark:text-amber-400">
          <span className="material-symbols-outlined text-sm">browser_updated</span>
          <span className="font-medium">该渠道属于浏览器自动化发布，需配合 OpenChromeCLI 与浏览器桥接服务使用。</span>
        </div>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-auto max-h-[75vh]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:space-y-2 md:col-span-2">
              <label className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">笔记标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2.5 sm:py-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all"
                placeholder="请输入笔记标题"
              />
            </div>

            <div className="space-y-1.5 sm:space-y-2">
              <div className="min-h-[16px] flex items-center ml-1">
                <label className="text-[10px] sm:text-xs leading-none font-bold text-slate-400 uppercase tracking-wider">发布模式</label>
              </div>
              <div className="min-h-[42px] rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] overflow-hidden">
                <select
                  value={postType}
                  onChange={(e) => setPostType(e.target.value as 'normal' | 'long')}
                  className="w-full h-[42px] px-4 bg-transparent text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all"
                >
                  <option value="normal">图文笔记</option>
                  <option value="long">写长文</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5 sm:space-y-2">
              <div className="min-h-[16px] flex items-center gap-2 ml-1">
                <label className="text-[10px] sm:text-xs leading-none font-bold text-slate-400 uppercase tracking-wider">仅存入草稿箱</label>
              </div>
              <div className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] flex items-center justify-end">
                <label className="relative inline-flex h-6 items-center cursor-pointer shrink-0">
                  <input type="checkbox" checked={isDraft} onChange={(e) => setIsDraft(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center justify-between ml-1">
              <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setShowContentPreview(!showContentPreview)}>
                <label className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider cursor-pointer group-hover:text-red-500 transition-colors">正文预览/编辑</label>
                <span className="material-symbols-outlined text-slate-300 text-sm group-hover:text-red-500 transition-all">
                  {showContentPreview ? 'expand_less' : 'expand_more'}
                </span>
              </div>

              {showContentPreview && (
                <div className="flex bg-slate-100 dark:bg-white/5 rounded-lg p-0.5 border border-slate-200 dark:border-white/10">
                  <button
                    onClick={() => setContentViewMode('preview')}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${contentViewMode === 'preview' ? 'bg-white dark:bg-white/10 text-red-500 shadow-sm' : 'text-slate-400'}`}
                  >
                    预览
                  </button>
                  <button
                    onClick={() => setContentViewMode('edit')}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${contentViewMode === 'edit' ? 'bg-white dark:bg-white/10 text-red-500 shadow-sm' : 'text-slate-400'}`}
                  >
                    编辑
                  </button>
                </div>
              )}
            </div>

            {showContentPreview ? (
              <div className="relative">
                {contentViewMode === 'edit' ? (
                  <textarea
                    value={currentContent}
                    onChange={(e) => setCurrentContent(e.target.value)}
                    rows={8}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all font-mono leading-relaxed"
                    placeholder="正文内容"
                  />
                ) : (
                  <div className="w-full px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl max-h-[300px] overflow-y-auto">
                    <ContentRenderer content={currentContent} className="text-xs" />
                  </div>
                )}
                {contentViewMode === 'edit' && (
                  <div className="absolute right-2 bottom-2 px-2 py-0.5 rounded bg-white/50 dark:bg-black/30 backdrop-blur-sm text-[9px] text-slate-500 pointer-events-none border border-slate-200/50 dark:border-white/10">
                    {displayCount} 字
                  </div>
                )}
              </div>
            ) : (
              <div
                onClick={() => setShowContentPreview(true)}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 rounded-xl text-xs text-slate-400 italic cursor-pointer hover:border-red-500/30 transition-all flex items-center justify-between group"
              >
                <span className="group-hover:text-slate-500 transition-colors">点击展开查看或修改正文 ({displayCount} 字)</span>
                <span className="material-symbols-outlined text-sm text-slate-300 group-hover:text-red-500">edit_note</span>
              </div>
            )}
          </div>

          {postType === 'normal' && (
            <div className="space-y-3 p-4 bg-red-50 dark:bg-red-950/10 rounded-xl border border-red-200/50 dark:border-red-900/20">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-red-500 text-sm">collections</span>
                  <label className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">图片管理 ({imageUrls.length})</label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleExtractImages}
                    className="text-[10px] font-bold text-red-600 hover:text-red-700 flex items-center gap-1 bg-red-500/10 px-2 py-0.5 rounded-lg transition-all"
                  >
                    <span className="material-symbols-outlined text-xs" style={{ fontSize: '14px' }}>auto_fix_high</span>
                    识别正文图片
                  </button>
                  <button
                    onClick={() => {
                      const url = prompt('请输入图片 URL:');
                      if (!url) return;
                      setImageUrls(prev => Array.from(new Set([...prev, url])));
                    }}
                    className="text-[10px] font-bold text-primary hover:text-cyan-400 flex items-center gap-1 bg-primary/5 px-2 py-0.5 rounded-lg transition-all"
                  >
                    <span className="material-symbols-outlined text-xs" style={{ fontSize: '14px' }}>add</span>
                    手动添加
                  </button>
                </div>
              </div>

              {imageUrls.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {imageUrls.map((url, idx) => (
                    <div key={`${url}-${idx}`} className="relative aspect-square rounded-lg overflow-hidden border border-red-200 dark:border-red-900/30 group bg-white dark:bg-black/20">
                      <img src={url} className="w-full h-full object-cover" alt={`Image ${idx + 1}`} />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                        {idx > 0 && (
                          <button
                            onClick={() => handleMoveImage(idx, 'prev')}
                            className="w-6 h-6 bg-white/20 hover:bg-white/40 text-white rounded-full flex items-center justify-center backdrop-blur-sm"
                            title="向前移动"
                          >
                            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                          </button>
                        )}
                        <button
                          onClick={() => setImageUrls(prev => prev.filter((_, i) => i !== idx))}
                          className="w-7 h-7 bg-red-500/80 hover:bg-red-500 text-white rounded-full flex items-center justify-center"
                          title="删除"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                        {idx < imageUrls.length - 1 && (
                          <button
                            onClick={() => handleMoveImage(idx, 'next')}
                            className="w-6 h-6 bg-white/20 hover:bg-white/40 text-white rounded-full flex items-center justify-center backdrop-blur-sm"
                            title="向后移动"
                          >
                            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                          </button>
                        )}
                      </div>
                      <div className={`absolute top-1 left-1 px-1 rounded text-[8px] font-bold pointer-events-none ${idx === 0 ? 'bg-red-500 text-white' : 'bg-black/50 text-white'}`}>
                        {idx === 0 ? '封面' : `#${idx + 1}`}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-[10px] text-red-500/60 italic">
                  尚未添加图片，系统会尝试从正文识别图片或由后端自动生成 fallback 图
                </div>
              )}

              <p className="text-[9px] text-red-500/70 leading-tight">提示：第一张图片会自动作为封面图。正文中的 Markdown 图片会被抽取进图文列表并从正文中移除。</p>
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 dark:border-border-dark flex flex-col sm:flex-row gap-2 sm:gap-3 bg-slate-50/50 dark:bg-surface-darker/30">
          <button
            onClick={onClose}
            className="order-2 sm:order-1 flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
          >
            取消
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing || !title}
            className="order-1 sm:order-2 flex-[2] px-6 py-2.5 rounded-xl text-sm font-bold bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {publishing ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            ) : (
              <span className="material-symbols-outlined text-lg">send</span>
            )}
            <span>{isDraft ? '确认发布草稿' : '确认直接发布'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default XhsPublishModal;
