import { useState, useEffect } from 'react';
import { publishContent } from '../../../../services/contentService';

interface GithubPublishModalProps {
  date: string;
  content: string;
  onClose: () => void;
  onSuccess: (data: any) => void;
  onError: (error: string) => void;
}

const GithubPublishModal: React.FC<GithubPublishModalProps> = ({ date, content, onClose, onSuccess, onError }) => {
  const [githubTitle, setGithubTitle] = useState('');
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    const displayDate = date.replace(/-/g, '/');
    setGithubTitle(`Daily Update ${displayDate}`);
  }, [date]);

  const handleCommit = async () => {
    if (!content) return;
    setCommitting(true);
    try {
      const res = await publishContent('github', { content, date, title: githubTitle });
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
      <div className="bg-white dark:bg-surface-dark w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-border-dark overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-border-dark flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-slate-900/10 dark:bg-white/10 flex items-center justify-center text-slate-900 dark:text-white">
              <span className="material-symbols-outlined text-lg sm:text-xl">code</span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">发布到 GitHub</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
        
        <div className="p-4 sm:p-6 space-y-4">
          <div className="space-y-1.5 sm:space-y-2">
            <label className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">提交信息 (Commit Message)</label>
            <input 
              type="text"
              value={githubTitle}
              onChange={(e) => setGithubTitle(e.target.value)}
              className="w-full px-4 py-2.5 sm:py-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              placeholder="请输入 GitHub 提交信息"
            />
          </div>
          <p className="text-xs text-slate-500">
            此标题将作为 GitHub 的 Commit Message，并可被存储在提交历史中。
          </p>
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
            disabled={committing || !githubTitle}
            className="order-1 sm:order-2 flex-[2] px-6 py-2.5 rounded-xl text-sm font-bold bg-primary hover:bg-cyan-400 text-white shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {committing ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            ) : (
              <span className="material-symbols-outlined text-lg">check_circle</span>
            )}
            <span>确认发布</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default GithubPublishModal;
