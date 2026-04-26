import { useState, useEffect, useRef } from 'react';
import { publishContent, generateCoverImage, uploadWechatMaterial } from '../../../../services/contentService';
import { toPng } from 'html-to-image';
import { agentService } from '../../../../services/agentService';
import type { Agent, Workflow, Tool } from '../../../../services/agentService';
import { getSettings } from '../../../../services/settingsService';
import { useToast } from '../../../../context/ToastContext.js';
import ContentRenderer from '../../../../components/UI/ContentRenderer';

interface WechatPublishModalProps {
  date: string;
  content: string;
  onClose: () => void;
  onSuccess: (data: any) => void;
  onError: (error: string) => void;
}

const WechatPublishModal: React.FC<WechatPublishModalProps> = ({ date, content, onClose, onSuccess, onError }) => {
  const { success: toastSuccess, error: toastError } = useToast();
  
  const [wechatTitle, setWechatTitle] = useState('');
  const [wechatAuthor, setWechatAuthor] = useState('');
  const [wechatDigest, setWechatDigest] = useState('');
  const [currentContent, setCurrentContent] = useState(content);
  const [wechatCoverMainTitle, setWechatCoverMainTitle] = useState('');
  const [wechatCoverSubtitle, setWechatCoverSubtitle] = useState('');
  const [wechatCoverCustom, setWechatCoverCustom] = useState('');
  const [selectedCoverAgentId, setSelectedCoverAgentId] = useState('');
  const [wechatCoverUrl, setWechatCoverUrl] = useState('');
  const [wechatCoverUrls, setWechatCoverUrls] = useState<string[]>([]);
  const [wechatThumbMediaId, setWechatThumbMediaId] = useState('');
  const [imageProxy, setImageProxy] = useState('');
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [isProcessingContent, setIsProcessingContent] = useState(false);
  const [isUploadingMaterial, setIsUploadingMaterial] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [publishAsImageText, setPublishAsImageText] = useState(false);
  const [htmlToRender, setHtmlToRender] = useState('');
  const [selectedContentExecutorId, setSelectedContentExecutorId] = useState('');
  const [contentImageMediaId, setContentImageMediaId] = useState<string | null>(null);
  const [showContentPreview, setShowContentPreview] = useState(false);
  const [contentViewMode, setContentViewMode] = useState<'preview' | 'edit'>('edit');
  const [newspicImageUrls, setNewspicImageUrls] = useState<string[]>([]);
  const [urlToMediaIdMap, setUrlToMediaIdMap] = useState<Record<string, string>>({});
  const coverImageRef = useRef<HTMLImageElement>(null);
  const htmlCaptureRef = useRef<HTMLDivElement>(null);

  // 辅助函数：等待所有图片加载完成
  const waitForImages = async (element: HTMLElement) => {
    const imgs = Array.from(element.querySelectorAll('img'));
    if (imgs.length === 0) return;
    
    await Promise.all(imgs.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve; // 即使加载失败也继续，防止挂死
      });
    }));
  };

  const [agents, setAgents] = useState<Agent[]>([]);

  const processHtmlForCapture = (html: string) => {
    if (!html) return '';
    // 1. 移除视频标签，因为截图无法捕获视频且可能导致布局异常
    let processed = html.replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '');
    processed = processed.replace(/<video[^>]*\/>/gi, '');

    // 2. 将 HTML 中的图片 URL 替换为通过后端代理的 URL，以解决 CORS 问题
    return processed.replace(/src=["']([^"']+)["']/gi, (match, src) => {
      if (src.startsWith('data:') || src.startsWith('/api/temp-image') || src.startsWith('blob:')) {
        return match;
      }
      return `src="${getImageUrl(src)}"`;
    });
  };

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);

  // 保存封面生成执行器的选择
  useEffect(() => {
    if (selectedCoverAgentId) {
      localStorage.setItem('wechat_cover_executor', selectedCoverAgentId);
    }
  }, [selectedCoverAgentId]);

  // 保存内容处理执行器的选择
  useEffect(() => {
    if (selectedContentExecutorId) {
      localStorage.setItem('wechat_content_executor', selectedContentExecutorId);
    }
  }, [selectedContentExecutorId]);

  const handleExtractImages = () => {
    // 1. 匹配 Markdown 图片语法: ![alt](url)
    const mdImgRegex = /!\[.*?\]\((https?:\/\/.*?)\)/g;
    const mdMatches = [...currentContent.matchAll(mdImgRegex)];
    const mdUrls = mdMatches.map(m => m[1]);

    // 2. 匹配纯图片链接 (以常见图片扩展名结尾)
    const pureUrlRegex = /(?<!\()https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|gif|webp|avif)(?:[?#][^\s)]*)?/gi;
    const pureMatches = [...currentContent.matchAll(pureUrlRegex)];
    const pureUrls = pureMatches.map(m => m[0]);

    const allExtractedUrls = Array.from(new Set([...mdUrls, ...pureUrls]));
    
    if (allExtractedUrls.length === 0) {
      toastSuccess('正文中未发现图片或链接');
      return;
    }
    
    // 3. 更新图片列表
    const prevCount = newspicImageUrls.length;
    const combinedUrls = Array.from(new Set([...newspicImageUrls, ...allExtractedUrls]));
    const addedCount = combinedUrls.length - prevCount;
    
    if (addedCount > 0) {
      setNewspicImageUrls(combinedUrls);
      toastSuccess(`已从正文识别并添加 ${addedCount} 张图片`);
    } else {
      toastSuccess('发现图片已在列表中');
    }

    // 4. 从正文中移除图片语法和纯链接，以及视频链接，避免重复
    let cleanedContent = currentContent;
    // 移除 Markdown 图片语法
    cleanedContent = cleanedContent.replace(/!\[.*?\]\((https?:\/\/.*?)\)\s?/g, '');
    // 移除 HTML 视频标签
    cleanedContent = cleanedContent.replace(/<video[^>]*>([\s\S]*?)<\/video>|<video[^>]*\/>/gi, '');
    // 移除纯视频链接
    cleanedContent = cleanedContent.replace(/https?:\/\/[^\s)]+\.(?:mp4|mov|wmv|flv|avi)(?:[?#][^\s)]*)?\s?/gi, '');
    
    // 移除已提取的纯图片链接 (注意要精确匹配已经提取出来的链接)
    allExtractedUrls.forEach(url => {
      cleanedContent = cleanedContent.split(url).join('').trim();
    });

    setCurrentContent(cleanedContent.replace(/\n{3,}/g, '\n\n').trim());
  };

  // 初始化微信发布弹窗的数据
  useEffect(() => {
    const initData = async () => {
      const displayDate = date.replace(/-/g, '/');
      try {
        const settings = await getSettings();
        const wechatPublisher = settings?.PUBLISHERS?.find((p: any) => p.id === 'wechat');
        const wechatConfig = wechatPublisher?.config || {};
        
        setWechatAuthor(wechatConfig.author || '');
        const title = `${wechatConfig.title || ''} ${displayDate}`.trim();
        setWechatTitle(title);
        if (settings?.IMAGE_PROXY) {
          setImageProxy(settings.IMAGE_PROXY);
        }
      } catch (e) {
        setWechatAuthor('');
        setWechatTitle(displayDate);
      }
      
      setWechatCoverCustom('比例: 16:9,  优化文案后输出.');
      setWechatDigest('');

      try {
        const [ags, wfs, tls] = await Promise.all([
          agentService.getAgents(),
          agentService.getWorkflows(),
          agentService.getTools(),
        ]);
        setAgents(ags || []);
        setWorkflows(wfs || []);
        setTools(tls || []);
        
        const savedExecutorId = localStorage.getItem('wechat_cover_executor');
        if (savedExecutorId) {
          const [type, id] = savedExecutorId.split(':');
          let exists = false;
          if (type === 'agent') exists = ags?.some((a: Agent) => a.id === id);
          else if (type === 'workflow') exists = wfs?.some((w: Workflow) => w.id === id);
          else if (type === 'tool') exists = tls?.some((t: Tool) => t.id === id);
          
          if (exists) {
            setSelectedCoverAgentId(savedExecutorId);
          } else {
            if (ags && ags.length > 0) setSelectedCoverAgentId(`agent:${ags[0].id}`);
            else if (wfs && wfs.length > 0) setSelectedCoverAgentId(`workflow:${wfs[0].id}`);
            else if (tls && tls.length > 0) setSelectedCoverAgentId(`tool:${tls[0].id}`);
          }
        } else {
          if (ags && ags.length > 0) setSelectedCoverAgentId(`agent:${ags[0].id}`);
          else if (wfs && wfs.length > 0) setSelectedCoverAgentId(`workflow:${wfs[0].id}`);
          else if (tls && tls.length > 0) setSelectedCoverAgentId(`tool:${tls[0].id}`);
        }

        const savedContentExecutorId = localStorage.getItem('wechat_content_executor');
        if (savedContentExecutorId) {
          const [type, id] = savedContentExecutorId.split(':');
          let exists = false;
          if (type === 'agent') exists = ags?.some((a: Agent) => a.id === id);
          else if (type === 'workflow') exists = wfs?.some((w: Workflow) => w.id === id);
          else if (type === 'tool') exists = tls?.some((t: Tool) => t.id === id);
          
          if (exists) {
            setSelectedContentExecutorId(savedContentExecutorId);
          }
        }
      } catch (e) {
        console.error('Failed to load agents/workflows/tools for cover generation:', e);
      }
    };

    initData();
  }, [date]);

  const handleGenerateCover = async () => {
    const combinedPrompt = `主标题：${wechatCoverMainTitle} - 副标题：${wechatCoverSubtitle}. 其它要求：${wechatCoverCustom}`.trim();
    if (!combinedPrompt) return;
    
    setIsGeneratingCover(true);
    // 开始新生成时，重置旧的 media_id，但保留 URL 直到新 URL 返回
    setWechatThumbMediaId('');
    
    try {
      const res = await generateCoverImage(
        combinedPrompt, 
        selectedCoverAgentId, 
        date, 
        selectedCoverAgentId.startsWith('tool:') ? currentContent : undefined
      );
      
      let imageUrl = res.url;

      // 如果返回的是 HTML，则渲染并截图
      if (res.isHtml || res.html) {
        setHtmlToRender(processHtmlForCapture(res.html));
        // 等待 DOM 渲染和图片加载
        await new Promise(resolve => setTimeout(resolve, 300));
        if (htmlCaptureRef.current) {
          await waitForImages(htmlCaptureRef.current);
          try {
            const dataUrl = await toPng(htmlCaptureRef.current, {
              quality: 1,
              pixelRatio: 2,
              skipFonts: true, // 跳过字体嵌入，避免加载过多外部字体
              cacheBust: false
            });
            imageUrl = dataUrl;
          } catch (screenshotError: any) {
            console.error('Failed to capture HTML as image:', screenshotError);
            toastError('HTML 截图失败，请重试');
            return;
          }
        }
      }

      if (imageUrl) {
        setWechatCoverUrl(imageUrl);
        const uniqueUrls = res.urls && Array.isArray(res.urls) ? Array.from(new Set(res.urls)) : [imageUrl];
        setWechatCoverUrls(uniqueUrls as string[]);

        // 只有在启用微信且有 URL 时才尝试自动上传
        if (imageUrl) {
          if (urlToMediaIdMap[imageUrl]) {
            setWechatThumbMediaId(urlToMediaIdMap[imageUrl]);
          } else {
            setIsUploadingMaterial(true);
            try {
              const materialRes = await robustUpload(imageUrl);
              if (materialRes.media_id) {
                setWechatThumbMediaId(materialRes.media_id);
                setUrlToMediaIdMap(prev => ({ ...prev, [imageUrl]: materialRes.media_id }));
                toastSuccess('封面图生成并上传成功');
              }
            } catch (uploadError: any) {
              console.error('Upload to WeChat failed:', uploadError);
              toastError('封面已生成但上传到微信失败: ' + uploadError.message + '。请尝试手动重新提交。');
            } finally {
              setIsUploadingMaterial(false);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Generate cover failed:', error);
      toastError('生成封面失败: ' + error.message);
    } finally {
      setIsGeneratingCover(false);
      setHtmlToRender('');
    }
  };

  const handleProcessContent = async () => {
    if (!selectedContentExecutorId) return;
    if (selectedContentExecutorId.startsWith('tool:') && !currentContent) return;
    
    setIsProcessingContent(true);
    try {
      const res = await agentService.runExecutor(
        selectedContentExecutorId, 
        selectedContentExecutorId.startsWith('tool:') ? currentContent : undefined, 
        date
      );
      
      // 如果返回的是 HTML，且我们想要图文（截图），则进行截图
      const isHtmlResult = res.isHtml || (res.content && /<\/(p|div|section|h[1-6]|table|ul|ol)>/i.test(res.content));
      
      if (isHtmlResult && publishAsImageText) {
        setHtmlToRender(processHtmlForCapture(res.content || res.html));
        // 等待 DOM 渲染和图片加载
        await new Promise(resolve => setTimeout(resolve, 300));
        if (htmlCaptureRef.current) {
          await waitForImages(htmlCaptureRef.current);
          try {
            const dataUrl = await toPng(htmlCaptureRef.current, {
              quality: 1,
              pixelRatio: 2,
              skipFonts: true, // 跳过字体嵌入，避免加载过多外部字体
              cacheBust: false
            });
            // 截图作为内容的一部分或全部。在 newspic 模式下，我们会上传这个图
            toastSuccess('内容已成功转换为长图');
            
            // 自动上传该长图并获取 media_id
            const materialRes = await robustUpload(dataUrl);
            if (materialRes.media_id) {
              setContentImageMediaId(materialRes.media_id);
            }
          } catch (screenshotError: any) {
            console.error('Failed to capture HTML content as image:', screenshotError);
            toastError('HTML 转换图片失败');
          }
        }
      }

      if (res.content) {
        setCurrentContent(res.content);
        toastSuccess('内容处理成功');
      }
    } catch (error: any) {
      console.error('Process content failed:', error);
      toastError('处理内容失败: ' + error.message);
    } finally {
      setIsProcessingContent(false);
      setHtmlToRender('');
    }
  };

  const handleMoveImage = (idx: number, direction: 'prev' | 'next') => {
    setNewspicImageUrls(prev => {
      const newList = [...prev];
      if (direction === 'prev' && idx > 0) {
        [newList[idx], newList[idx - 1]] = [newList[idx - 1], newList[idx]];
      } else if (direction === 'next' && idx < newList.length - 1) {
        [newList[idx], newList[idx + 1]] = [newList[idx + 1], newList[idx]];
      }
      return newList;
    });
  };

  const handleCommit = async () => {
    if (!currentContent) return;
    setCommitting(true);
    try {
      const options: any = { 
        title: wechatTitle, 
        author: wechatAuthor, 
        digest: wechatDigest, 
        thumbMediaId: wechatThumbMediaId, 
        showVoice: false,
        articleType: publishAsImageText ? 'newspic' : 'news'
      };

      if (publishAsImageText) {
        // 在图文模式下，上传所有收集到的图片
        const allImageMediaIds: string[] = [];
        
        // 1. 如果有内容处理器生成的长图截图
        if (contentImageMediaId) {
          allImageMediaIds.push(contentImageMediaId);
        }
        
        // 2. 上传 newspicImageUrls 中的其他图片 (去重)
        const pendingUrls = newspicImageUrls.filter(url => !urlToMediaIdMap[url]);
        const uploadResults = await Promise.allSettled(pendingUrls.map(url => robustUpload(url)));
        
        const newMap = { ...urlToMediaIdMap };
        uploadResults.forEach((res, idx) => {
          if (res.status === 'fulfilled' && res.value.media_id) {
            newMap[pendingUrls[idx]] = res.value.media_id;
          }
        });
        setUrlToMediaIdMap(newMap);

        // 3. 汇总所有 media_id
        newspicImageUrls.forEach(url => {
          if (newMap[url]) allImageMediaIds.push(newMap[url]);
        });

        options.imageMediaIds = Array.from(new Set(allImageMediaIds));
      }

      const res = await publishContent('wechat', { content: currentContent, date, ...options });
      onSuccess(res.data);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message || '未知错误';
      onError(errorMsg);
    } finally {
      setCommitting(false);
    }
  };

  const getImageUrl = (url: string) => {
    if (!url) return '';
    // 如果本身就是 data URL (base64)，则直接返回，避免通过后端代理导致 URL 过长 (431 error)
    if (url.startsWith('data:')) return url;
    
    const token = localStorage.getItem('auth_token');
    // 统一通过 /api/temp-image 接口处理，并携带 token 保证安全
    return `/api/temp-image?path=${encodeURIComponent(url)}${token ? `&token=${token}` : ''}`;
  };

  const handleViewImage = (url: string) => {
    const finalUrl = getImageUrl(url);
    if (finalUrl.startsWith('data:')) {
      try {
        const parts = finalUrl.split(',');
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
      } catch (e) {
        console.error('Failed to open base64 image:', e);
        // 回退到简单方式
        const newTab = window.open();
        newTab?.document.write(`<img src="${finalUrl}" style="max-width:100%" />`);
        newTab?.document.close();
      }
    } else {
      window.open(finalUrl, '_blank');
    }
  };

  const robustUpload = async (url: string) => {
    let originalError: any;
    try {
      // 1. 尝试常规 URL 上传
      return await uploadWechatMaterial(url);
    } catch (error: any) {
      originalError = error;
      console.warn('Regular upload failed, trying frontend capture fallback...', error);
      // 给用户一个提示，说明正在尝试备选方案
      toastSuccess('常规上传失败，正在尝试从浏览器缓存抓取图片...');
    }

    // 2. 备选方案：只要前端有渲染好的图片，就尝试从前端抓取内容上传
    if (coverImageRef.current) {
      try {
        const img = coverImageRef.current;
        if (img.complete && img.naturalWidth > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            if (dataUrl) {
              console.info('Successfully captured image from frontend DOM, uploading as base64...');
              const res = await uploadWechatMaterial(dataUrl);
              toastSuccess('已通过浏览器缓存成功恢复并上传封面');
              return res;
            }
          }
        } else {
          console.warn('Image DOM element found but not fully loaded or zero size.');
        }
      } catch (frontendError: any) {
        console.error('Frontend capture process failed:', frontendError);
      }
    }
    
    // 如果备选方案也失败了，抛出最初的错误
    throw originalError;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-surface-dark w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-border-dark overflow-hidden flex flex-col max-h-[95vh] sm:max-h-none" onClick={e => e.stopPropagation()}>
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-border-dark flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
              <span className="material-symbols-outlined text-lg sm:text-xl">chat</span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">发布到微信公众号</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
        
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-auto max-h-[70vh]">
          {/* Publish Mode Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/[0.03] rounded-xl border border-slate-200 dark:border-white/10">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${publishAsImageText ? 'bg-amber-500/10 text-amber-500' : 'bg-primary/10 text-primary'}`}>
                <span className="material-symbols-outlined text-lg">{publishAsImageText ? 'photo_library' : 'article'}</span>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">发布为{publishAsImageText ? '图文消息' : '普通文章'}</p>
                <p className="text-[10px] text-slate-500">{publishAsImageText ? '以多图+短文形式发布（适合视觉内容）' : '以标准公众号文章格式发布'}</p>
              </div>
            </div>
            <button 
              onClick={() => setPublishAsImageText(!publishAsImageText)}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${publishAsImageText ? 'bg-primary' : 'bg-slate-200 dark:bg-white/10'}`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${publishAsImageText ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
             
             {/* Content Executor Section */}
             <div className="space-y-1.5 sm:space-y-2">
                <label className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">内容 AI 处理器</label>
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 sm:py-1">
                   <select 
                      value={selectedContentExecutorId}
                      onChange={(e) => setSelectedContentExecutorId(e.target.value)}
                      className="flex-1 bg-transparent border-none text-xs text-slate-600 dark:text-slate-300 focus:ring-0 cursor-pointer min-w-0"
                    >
                      <option value="">(不使用 AI 处理)</option>
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
                      <optgroup label="工具 (Tools)">
                        {tools.map(tool => (
                          <option key={tool.id} value={`tool:${tool.id}`}>{tool.name}</option>
                        ))}
                      </optgroup>
                    </select>
                    <button 
                      disabled={isProcessingContent || !selectedContentExecutorId}
                      onClick={handleProcessContent}
                      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 transition-all"
                      title="执行 AI 处理"
                    >
                      {isProcessingContent ? (
                        <div className="w-3 h-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      ) : (
                        <span className="material-symbols-outlined text-base">play_arrow</span>
                      )}
                    </button>
                </div>
             </div>
          </div>

          {/* Content Section - Expanded to Full Width */}
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center justify-between ml-1">
              <div 
                className="flex items-center gap-2 cursor-pointer group"
                onClick={() => setShowContentPreview(!showContentPreview)}
              >
                <label className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider cursor-pointer group-hover:text-primary transition-colors">正文预览/编辑</label>
                <span className="material-symbols-outlined text-slate-300 text-sm group-hover:text-primary transition-all">
                  {showContentPreview ? 'expand_less' : 'expand_more'}
                </span>
              </div>
              
              {showContentPreview && (
                <div className="flex bg-slate-100 dark:bg-white/5 rounded-lg p-0.5 border border-slate-200 dark:border-white/10">
                  <button 
                    onClick={() => setContentViewMode('preview')}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${contentViewMode === 'preview' ? 'bg-white dark:bg-white/10 text-primary shadow-sm' : 'text-slate-400'}`}
                  >
                    预览
                  </button>
                  <button 
                    onClick={() => setContentViewMode('edit')}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${contentViewMode === 'edit' ? 'bg-white dark:bg-white/10 text-primary shadow-sm' : 'text-slate-400'}`}
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
                    rows={6}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-mono leading-relaxed"
                    placeholder="正文内容"
                  />
                ) : (
                  <div className="w-full px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl max-h-[300px] overflow-y-auto">
                    <ContentRenderer 
                      content={currentContent} 
                      imageProxy={imageProxy}
                      className="text-xs"
                    />
                  </div>
                )}
                {contentViewMode === 'edit' && (
                  <div className="absolute right-2 bottom-2 px-2 py-0.5 rounded bg-white/50 dark:bg-black/30 backdrop-blur-sm text-[9px] text-slate-500 pointer-events-none border border-slate-200/50 dark:border-white/10">
                    {currentContent.length} 字
                  </div>
                )}
              </div>
            ) : (
              <div 
                onClick={() => setShowContentPreview(true)}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 rounded-xl text-xs text-slate-400 italic cursor-pointer hover:border-primary/30 transition-all flex items-center justify-between group"
              >
                <span className="group-hover:text-slate-500 transition-colors">点击展开查看或修改正文 ({currentContent.length} 字)</span>
                <span className="material-symbols-outlined text-sm text-slate-300 group-hover:text-primary">edit_note</span>
              </div>
            )}
          </div>

          {/* Newspic Images Management (Only shown in Image-Text Mode) */}
          {publishAsImageText && (
            <div className="space-y-3 p-4 bg-amber-50 dark:bg-amber-950/10 rounded-xl border border-amber-200/50 dark:border-amber-900/20">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-500 text-sm">collections</span>
                  <label className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">图片管理 ({newspicImageUrls.length})</label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleExtractImages}
                      className="text-[10px] font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded-lg transition-all"
                    >
                      <span className="material-symbols-outlined text-xs" style={{ fontSize: '14px' }}>auto_fix_high</span>
                      识别正文
                    </button>
                    <button 
                      onClick={() => {
                        const url = prompt('请输入图片 URL:');
                        if (url) setNewspicImageUrls(prev => Array.from(new Set([...prev, url])));
                      }}
                      className="text-[10px] font-bold text-primary hover:text-cyan-400 flex items-center gap-1 bg-primary/5 px-2 py-0.5 rounded-lg transition-all"
                    >
                      <span className="material-symbols-outlined text-xs" style={{ fontSize: '14px' }}>add</span>
                      手动添加
                    </button>
                  </div>
                </div>
              </div>
              
              {newspicImageUrls.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {newspicImageUrls.map((url, idx) => (
                    <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-amber-200 dark:border-amber-900/30 group bg-white dark:bg-black/20">
                      <img src={getImageUrl(url)} className="w-full h-full object-cover" alt={`Image ${idx}`} />
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
                          onClick={() => setNewspicImageUrls(prev => prev.filter((_, i) => i !== idx))}
                          className="w-7 h-7 bg-red-500/80 hover:bg-red-500 text-white rounded-full flex items-center justify-center"
                          title="删除"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                        {idx < newspicImageUrls.length - 1 && (
                          <button 
                            onClick={() => handleMoveImage(idx, 'next')}
                            className="w-6 h-6 bg-white/20 hover:bg-white/40 text-white rounded-full flex items-center justify-center backdrop-blur-sm"
                            title="向后移动"
                          >
                            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                          </button>
                        )}
                      </div>
                      <div className="absolute top-1 left-1 px-1 rounded bg-black/50 text-[8px] text-white font-bold pointer-events-none">
                        #{idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-[10px] text-amber-500/60 italic">
                  尚未添加图片，系统将自动使用封面图作为正文图片
                </div>
              )}
              <p className="text-[9px] text-amber-500/70 leading-tight">提示：图文模式下，正文中的 Markdown 图片语法会被自动移除，仅保留文字描述。</p>
            </div>
          )}

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
                    <optgroup label="工具 (Tools)">
                      {tools.map(tool => (
                        <option key={tool.id} value={`tool:${tool.id}`}>{tool.name}</option>
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
              <div className="flex flex-col gap-2">
                <div className="relative rounded-2xl overflow-hidden border-2 border-dashed border-slate-200 dark:border-white/10 aspect-[2.35/1] bg-slate-50 dark:bg-black/20 flex items-center justify-center group">
                  {wechatCoverUrl ? (
                    <>
                      <img ref={coverImageRef} src={getImageUrl(wechatCoverUrl)} className="w-full h-full object-cover" alt="Cover" crossOrigin="anonymous" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button 
                          onClick={() => {
                            const url = prompt('请输入外部封面图片 URL:', wechatCoverUrl);
                            if (url && url !== wechatCoverUrl) {
                              setWechatCoverUrl(url);
                              setWechatThumbMediaId('');
                            }
                          }}
                          className="px-3 py-1.5 bg-white/20 backdrop-blur-md hover:bg-white/40 text-white rounded-lg text-[10px] font-bold transition-all border border-white/30 whitespace-nowrap"
                        >
                          手动输入 URL
                        </button>
                        <button 
                          onClick={() => handleViewImage(wechatCoverUrl)}
                          className="px-3 py-1.5 bg-white/20 backdrop-blur-md hover:bg-white/40 text-white rounded-lg text-[10px] font-bold transition-all border border-white/30 flex items-center gap-1 whitespace-nowrap"
                          title="在新标签页中打开查看图片"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_new</span>
                          查看图片
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center p-4">
                      <span className="material-symbols-outlined text-2xl sm:text-3xl text-slate-300 dark:text-slate-600 mb-2">image</span>
                      <p className="text-[10px] sm:text-xs text-slate-400 font-medium">微信将默认使用正文第一张图作为封面</p>
                      <button 
                        onClick={() => {
                          const url = prompt('请输入外部封面图片 URL:');
                          if (url) {
                            setWechatCoverUrl(url);
                            setWechatThumbMediaId('');
                          }
                        }}
                        className="mt-2 text-[10px] text-primary hover:underline font-bold"
                      >
                        或手动输入图片 URL
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {wechatCoverUrls.length > 1 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 px-1">
                  {wechatCoverUrls.map((url, index) => (
                    <div 
                      key={index}
                      onClick={async () => {
                        if (isUploadingMaterial) return;
                        setWechatCoverUrl(url);
                        
                        if (urlToMediaIdMap[url]) {
                          setWechatThumbMediaId(urlToMediaIdMap[url]);
                          toastSuccess('已切换到缓存的封面');
                        } else {
                          setWechatThumbMediaId('');
                          // 自动切换并同步上传到微信
                          try {
                            setIsUploadingMaterial(true);
                            const materialRes = await robustUpload(url);
                            if (materialRes.media_id) {
                              setWechatThumbMediaId(materialRes.media_id);
                              setUrlToMediaIdMap(prev => ({ ...prev, [url]: materialRes.media_id }));
                              toastSuccess('封面已切换并同步到微信');
                            }
                          } catch (error: any) {
                            console.error('Upload to WeChat failed:', error);
                            toastError('封面已切换但上传到微信失败，请手动上传。');
                          } finally {
                            setIsUploadingMaterial(false);
                          }
                        }
                      }}
                      className={`relative aspect-[2.35/1] rounded-lg overflow-hidden border-2 transition-all cursor-pointer group ${
                        wechatCoverUrl === url ? 'border-primary shadow-sm' : 'border-slate-200 dark:border-white/10 hover:border-primary/50'
                      }`}
                    >
                      <img src={getImageUrl(url)} className="w-full h-full object-cover" alt={`Option ${index + 1}`} />
                      {wechatCoverUrl === url && (
                        <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                          <span className="material-symbols-outlined text-primary text-xs bg-white rounded-full">check_circle</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {wechatCoverUrl && !wechatThumbMediaId && !isGeneratingCover && (
                <div className="flex flex-col items-center gap-2">
                  <button 
                    disabled={isUploadingMaterial}
                    onClick={async () => {
                      setIsUploadingMaterial(true);
                      try {
                        const materialRes = await robustUpload(wechatCoverUrl);
                        if (materialRes.media_id) {
                          setWechatThumbMediaId(materialRes.media_id);
                          setUrlToMediaIdMap(prev => ({ ...prev, [wechatCoverUrl]: materialRes.media_id }));
                          toastSuccess('封面图上传成功');
                        }
                      } catch (error: any) {
                        toastError('上传失败: ' + error.message);
                      } finally {
                        setIsUploadingMaterial(false);
                      }
                    }}
                    className="flex items-center gap-1.5 px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-lg shadow-amber-500/20 transition-all text-xs font-bold disabled:opacity-50"
                  >
                    {isUploadingMaterial ? (
                       <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                    ) : (
                       <span className="material-symbols-outlined text-sm">cloud_upload</span>
                    )}
                    重新上传封面图到微信
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
            onClick={onClose}
            className="order-2 sm:order-1 flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
          >
            取消
          </button>
          <button 
            onClick={handleCommit}
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

      {/* Hidden div for HTML-to-Image capture */}
      <div className="fixed -left-[9999px] top-0 pointer-events-none">
        <div 
          ref={htmlCaptureRef}
          style={{ width: '750px', padding: '0', margin: '0', background: 'transparent' }}
          dangerouslySetInnerHTML={{ __html: htmlToRender }}
        />
      </div>
    </div>
  );
};

export default WechatPublishModal;
