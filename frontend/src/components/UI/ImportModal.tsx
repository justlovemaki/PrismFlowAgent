import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { genericImport } from '../../services/importService';
import type { ImportMode } from '../../services/importService';
import { useToast } from '../../context/ToastContext.js';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: any[];
  onSuccess: () => void;
}

const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, categories, onSuccess }) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [mode, setMode] = useState<ImportMode>('URL');
  const [categoryId, setCategoryId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Form states
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [json, setJson] = useState('');

  // Initial category
  useEffect(() => {
    if (categories.length > 0 && !categoryId) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId) {
      toastError('请选择分类');
      return;
    }

    setIsLoading(true);
    try {
      let payload = {};
      if (mode === 'URL') payload = { url };
      else if (mode === 'TEXT') payload = { title, content };
      else if (mode === 'JSON') payload = { json };

      await genericImport(mode, categoryId, payload);
      toastSuccess('导入成功');
      onSuccess();
      onClose();
      // Reset form
      setUrl('');
      setTitle('');
      setContent('');
      setJson('');
    } catch (error: any) {
      toastError(`导入失败: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const currentCategory = categories.find(c => c.id === categoryId) || categories[0];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white dark:bg-surface-dark w-full max-w-2xl rounded-[32px] shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
      >
        <div className="p-8 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-white/[0.02]">
          <div>
            <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-3">
              <span className="material-symbols-outlined text-primary p-2 bg-primary/10 rounded-xl">input</span>
              通用内容导入
            </h3>
            <p className="text-xs text-slate-500 mt-1">手动将外部资讯注入到系统中</p>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          {/* Mode Selection Tabs */}
          <div className="flex p-1.5 bg-slate-100 dark:bg-white/5 rounded-2xl">
            {(['URL', 'TEXT', 'JSON'] as ImportMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${
                  mode === m 
                    ? 'bg-white dark:bg-surface-dark text-primary shadow-sm ring-1 ring-slate-200 dark:ring-white/10' 
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {m === 'URL' ? '网页抓取' : m === 'TEXT' ? '纯文本导入' : 'JSON 批量'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 relative">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">目标分类</label>
              
              {/* Custom Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 rounded-2xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                >
                  <div className="flex items-center gap-2">
                    {currentCategory?.icon && (
                      <span className="material-symbols-outlined text-lg text-primary">
                        {currentCategory.icon}
                      </span>
                    )}
                    <span>{currentCategory?.label || '选择分类'}</span>
                  </div>
                  <span className={`material-symbols-outlined transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`}>
                    expand_more
                  </span>
                </button>

                <AnimatePresence>
                  {isDropdownOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-10" 
                        onClick={() => setIsDropdownOpen(false)}
                      />
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl z-20 overflow-hidden max-h-60 overflow-y-auto"
                      >
                        {categories.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => {
                              setCategoryId(cat.id);
                              setIsDropdownOpen(false);
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-white/5 ${
                              categoryId === cat.id ? 'bg-primary/5 text-primary font-bold' : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <span className="material-symbols-outlined text-lg">
                              {cat.icon || 'label'}
                            </span>
                            {cat.label}
                            {categoryId === cat.id && (
                              <span className="material-symbols-outlined text-sm ml-auto">check</span>
                            )}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {mode === 'URL' && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">文章 URL 地址</label>
                <div className="relative group">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">link</span>
                  <input
                    type="url"
                    required
                    placeholder="https://example.com/article"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 rounded-2xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-mono"
                  />
                </div>
              </div>
            )}

            {mode === 'TEXT' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">标题 (可选)</label>
                  <input
                    type="text"
                    placeholder="输入内容标题..."
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 rounded-2xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">资讯内容</label>
                  <textarea
                    required
                    rows={6}
                    placeholder="在这里粘贴或输入资讯正文内容..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full px-4 py-4 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 rounded-2xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-none"
                  />
                </div>
              </div>
            )}

            {mode === 'JSON' && (
              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">JSON 数组数据</label>
                  <span className="text-[9px] text-primary bg-primary/5 px-2 py-0.5 rounded-full font-bold">需符合 UnifiedData 结构</span>
                </div>
                <textarea
                  required
                  rows={8}
                  placeholder='[ { "title": "...", "description": "..." } ]'
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                  className="w-full px-4 py-4 bg-slate-900 text-green-400 border border-slate-700 rounded-2xl text-xs focus:ring-2 focus:ring-primary/20 outline-none transition-all font-mono scrollbar-thin scrollbar-thumb-slate-700"
                />
              </div>
            )}
          </div>

          <div className="pt-4 flex gap-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-4 rounded-2xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-[2] py-4 bg-primary hover:bg-primary/90 text-white text-sm font-black rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isLoading ? (
                <span className="material-symbols-outlined animate-spin">sync</span>
              ) : (
                <span className="material-symbols-outlined">publish</span>
              )}
              {isLoading ? '正在导入...' : '确认导入系统'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default ImportModal;
