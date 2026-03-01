import { useState, useEffect } from 'react';
import { publishContent, generateCoverImage, uploadWechatMaterial } from '../../../../services/contentService';
import { agentService } from '../../../../services/agentService';
import type { Agent, Workflow } from '../../../../services/agentService';
import { getSettings } from '../../../../services/settingsService';
import { useToast } from '../../../../context/ToastContext.js';

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
  const [wechatCoverMainTitle, setWechatCoverMainTitle] = useState('');
  const [wechatCoverSubtitle, setWechatCoverSubtitle] = useState('');
  const [wechatCoverCustom, setWechatCoverCustom] = useState('');
  const [selectedCoverAgentId, setSelectedCoverAgentId] = useState('');
  const [wechatCoverUrl, setWechatCoverUrl] = useState('');
  const [wechatThumbMediaId, setWechatThumbMediaId] = useState('');
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [committing, setCommitting] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  // 保存封面生成执行器的选择
  useEffect(() => {
    if (selectedCoverAgentId) {
      localStorage.setItem('wechat_cover_executor', selectedCoverAgentId);
    }
  }, [selectedCoverAgentId]);

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
      } catch (e) {
        setWechatAuthor('');
        setWechatTitle(displayDate);
      }
      
      setWechatCoverCustom('比例: 16:9,  优化文案后输出.');
      setWechatDigest('');

      try {
        const [ags, wfs] = await Promise.all([
          agentService.getAgents(),
          agentService.getWorkflows(),
        ]);
        setAgents(ags || []);
        setWorkflows(wfs || []);
        
        const savedExecutorId = localStorage.getItem('wechat_cover_executor');
        if (savedExecutorId) {
          const [type, id] = savedExecutorId.split(':');
          if (type === 'tool') {
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
          if (ags && ags.length > 0) setSelectedCoverAgentId(`agent:${ags[0].id}`);
          else if (wfs && wfs.length > 0) setSelectedCoverAgentId(`workflow:${wfs[0].id}`);
        }
      } catch (e) {
        console.error('Failed to load agents/workflows for cover generation:', e);
      }
    };

    initData();
  }, [date]);

  const handleGenerateCover = async () => {
    const combinedPrompt = `${wechatCoverMainTitle} - ${wechatCoverSubtitle}. ${wechatCoverCustom}`.trim();
    if (!combinedPrompt) return;
    
    setIsGeneratingCover(true);
    try {
      const res = await generateCoverImage(combinedPrompt, selectedCoverAgentId, date);
      if (res && res.url) {
        setWechatCoverUrl(res.url);
        const materialRes = await uploadWechatMaterial(res.url);
        if (materialRes.media_id) {
          setWechatThumbMediaId(materialRes.media_id);
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

  const handleCommit = async () => {
    if (!content) return;
    setCommitting(true);
    try {
      const options = { 
        title: wechatTitle, 
        author: wechatAuthor, 
        digest: wechatDigest, 
        thumbMediaId: wechatThumbMediaId, 
        showVoice: false 
      };
      const res = await publishContent('wechat', { content, date, ...options });
      onSuccess(res.data);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message || '未知错误';
      onError(errorMsg);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
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
    </div>
  );
};

export default WechatPublishModal;
