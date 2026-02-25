import React, { useEffect, useState } from 'react';
import { getCommitHistory, deleteCommitHistory, republishCommitHistory, type CommitRecord } from '../services/historyService';
import ContentRenderer from '../components/UI/ContentRenderer';
import { useToast } from '../context/ToastContext.js';

const History: React.FC = () => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [republishing, setRepublishing] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [previewContent, setPreviewContent] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const offset = (currentPage - 1) * pageSize;
      const res = await getCommitHistory({ 
        limit: pageSize, 
        offset,
        search: searchQuery || undefined
      });
      setCommits(res.commits);
      setTotal(res.total);
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [currentPage, searchQuery]);

  // 搜索时重置到第一页
  useEffect(() => {
    if (currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [searchQuery]);

  // 分页计算
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条记录吗？此操作不可恢复。')) {
      return;
    }
    
    setDeleting(id);
    try {
      await deleteCommitHistory(id);
      // 重新获取列表
      await fetchHistory();
      toastSuccess('删除成功');
    } catch (error) {
      console.error('Failed to delete:', error);
      toastError('删除失败，请重试');
    } finally {
      setDeleting(null);
    }
  };

  const handleRepublish = async (id: number) => {
    if (!confirm('确定要重新发布这条记录吗？')) {
      return;
    }
    
    setRepublishing(id);
    try {
      await republishCommitHistory(id);
      toastSuccess('重新发布成功');
      // 重新获取列表
      await fetchHistory();
    } catch (error: any) {
      console.error('Failed to republish:', error);
      toastError('重新发布失败，请重试');
    } finally {
      setRepublishing(null);
    }
  };

  const formatDateTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center text-primary">
            <span className="material-symbols-outlined text-2xl">archive</span>
          </div>
          <h2 className="text-slate-900 dark:text-white text-2xl font-bold tracking-tight">历史存档</h2>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full">
            <input 
              className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-transparent text-slate-900 dark:text-white text-sm rounded-lg pl-10 pr-4 py-2 w-full sm:w-64 shadow-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all" 
              placeholder="搜索报告..." 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400">search</span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1.5 w-7 h-7 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-border-dark overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-surface-dark-lighter/50 border-b border-slate-200 dark:border-surface-dark-lighter text-xs uppercase tracking-wider text-slate-500 dark:text-text-secondary">
                <th className="px-6 py-4 font-semibold">日期</th>
                <th className="px-6 py-4 font-semibold">平台</th>
                <th className="px-4 py-4 font-semibold hidden sm:table-cell">提交时间</th>
                <th className="px-4 py-4 font-semibold text-center hidden md:table-cell">状态</th>
                <th className="px-6 py-4 font-semibold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-surface-dark-lighter">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-500">
                    <div className="flex justify-center">
                      <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    </div>
                  </td>
                </tr>
              ) : total === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-500">
                    {searchQuery ? '未找到匹配的记录' : '暂无历史记录'}
                  </td>
                </tr>
              ) : commits.map((commit) => (
                <tr key={commit.id} className="group hover:bg-slate-50 dark:hover:bg-surface-dark-lighter/30 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-500 dark:text-text-secondary whitespace-nowrap">
                    {commit.date}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700 dark:text-white">
                    {commit.platform}
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-500 dark:text-text-secondary whitespace-nowrap hidden sm:table-cell">
                    {formatDateTime(commit.commitTime)}
                  </td>
                  <td className="px-4 py-4 text-center hidden md:table-cell">
                    <div className="flex items-center justify-center gap-2">
                      <span className="size-2 rounded-full bg-accent-success shadow-[0_0_8px_rgba(34,197,94,0.4)]"></span>
                      <span className="text-sm text-slate-700 dark:text-white">已提交</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1 sm:gap-2">
                      <button
                        onClick={() => handleRepublish(commit.id)}
                        disabled={republishing === commit.id}
                        className="text-primary font-bold text-xs hover:bg-primary/10 px-2 sm:px-3 py-1.5 rounded-md transition-colors inline-flex items-center justify-center gap-1 min-w-[50px] sm:w-20 disabled:opacity-50"
                        title="重新发布"
                      >
                        {republishing === commit.id ? (
                          <div className="w-3 h-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                        ) : (
                          <>
                            <span className="hidden xs:inline">重发</span>
                            <span className="material-symbols-outlined text-[14px]">refresh</span>
                          </>
                        )}
                      </button>
                      {commit.fullContent && (
                        <button
                          onClick={() => setPreviewContent(commit.fullContent!)}
                          className="text-slate-600 dark:text-text-secondary font-bold text-xs hover:bg-slate-100 dark:hover:bg-surface-dark-lighter px-2 sm:px-3 py-1.5 rounded-md transition-colors inline-flex items-center justify-center gap-1 min-w-[50px] sm:w-20"
                        >
                          <span className="hidden xs:inline">预览</span>
                          <span className="material-symbols-outlined text-[14px]">visibility</span>
                        </button>
                      )}
                      {commit.viewUrl ? (
                        <a 
                          href={commit.viewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary font-bold text-xs hover:bg-primary/10 px-2 sm:px-3 py-1.5 rounded-md transition-colors inline-flex items-center justify-center gap-1 min-w-[50px] sm:w-20"
                        >
                          <span className="hidden xs:inline">查看</span>
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        </a>
                      ) : (
                        <span className="text-slate-400 text-xs px-2 sm:px-3 py-1.5 min-w-[50px] sm:w-20 inline-flex justify-center">无</span>
                      )}
                      <button
                        onClick={() => handleDelete(commit.id)}
                        disabled={deleting === commit.id}
                        className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 px-1.5 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="删除记录"
                      >
                        {deleting === commit.id ? (
                          <div className="w-4 h-4 border-2 border-red-600/20 border-t-red-600 rounded-full animate-spin"></div>
                        ) : (
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-surface-dark border-t border-slate-200 dark:border-border-dark rounded-b-xl">
          <div className="text-sm text-slate-500 dark:text-text-secondary">
            显示 {startIndex + 1} - {endIndex} 条，共 {total} 条记录
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-text-secondary hover:bg-slate-100 dark:hover:bg-surface-dark-lighter rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              上一页
            </button>
            
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                // 只显示当前页附近的页码
                if (
                  page === 1 ||
                  page === totalPages ||
                  (page >= currentPage - 1 && page <= currentPage + 1)
                ) {
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        currentPage === page
                          ? 'bg-primary text-white'
                          : 'text-slate-600 dark:text-text-secondary hover:bg-slate-100 dark:hover:bg-surface-dark-lighter'
                      }`}
                    >
                      {page}
                    </button>
                  );
                } else if (
                  page === currentPage - 2 ||
                  page === currentPage + 2
                ) {
                  return <span key={page} className="px-2 text-slate-400">...</span>;
                }
                return null;
              })}
            </div>

            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-text-secondary hover:bg-slate-100 dark:hover:bg-surface-dark-lighter rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              下一页
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewContent !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden border border-slate-200 dark:border-border-dark">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-surface-dark-lighter">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">原始内容预览</h3>
              <button 
                onClick={() => setPreviewContent(null)}
                className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-slate-50 dark:bg-black/20">
              <ContentRenderer 
                content={previewContent || ''} 
                className="text-sm text-slate-700 dark:text-text-secondary"
              />
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-surface-dark-lighter flex justify-end">
              <button 
                onClick={() => setPreviewContent(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-surface-dark-lighter text-slate-700 dark:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-opacity-80 transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default History;
