import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { knowledgeService } from '../services/knowledgeService';
import type { KBCategory, KBDocument } from '../services/knowledgeService';
import { useToast } from '../context/ToastContext';

const KnowledgeBase: React.FC = () => {
  const { success, error: toastError } = useToast();
  const [categories, setCategories] = useState<KBCategory[]>([]);
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: '', description: '' });
  
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    if (selectedCategoryId) {
      loadDocuments(selectedCategoryId);
    } else {
      setDocuments([]);
    }
  }, [selectedCategoryId]);

  const loadCategories = async () => {
    try {
      setIsLoading(true);
      const data = await knowledgeService.getCategories();
      setCategories(data);
      if (data.length > 0 && !selectedCategoryId) {
        setSelectedCategoryId(data[0].id);
      }
    } catch (err: any) {
      toastError('加载分类失败: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDocuments = async (catId: string) => {
    try {
      const data = await knowledgeService.getDocuments(catId);
      setDocuments(data);
    } catch (err: any) {
      toastError('加载文档失败: ' + err.message);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategory.name.trim()) return;
    try {
      await knowledgeService.addCategory(newCategory.name, newCategory.description);
      success('分类创建成功');
      setIsAddingCategory(false);
      setNewCategory({ name: '', description: '' });
      await loadCategories();
    } catch (err: any) {
      toastError('创建分类失败: ' + err.message);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCategoryId) return;

    try {
      setIsUploading(true);
      await knowledgeService.uploadDocument(selectedCategoryId, file);
      success('文档上传并处理完成');
      await loadDocuments(selectedCategoryId);
      await loadCategories(); // 更新文档计数
    } catch (err: any) {
      toastError('上传失败: ' + err.message);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('确定删除该文档吗？这将同时删除所有相关的分块。')) return;
    try {
      await knowledgeService.deleteDocument(docId);
      success('文档已删除');
      if (selectedCategoryId) {
        await loadDocuments(selectedCategoryId);
        await loadCategories();
      }
    } catch (err: any) {
      toastError('删除失败: ' + err.message);
    }
  };

  const handleQuery = async () => {
    if (!query.trim()) return;
    try {
      setIsSearching(true);
      setSearchResult(null);
      const res = await knowledgeService.queryKnowledge(query, selectedCategoryId ? [selectedCategoryId] : undefined);
      setSearchResult(res.answer);
    } catch (err: any) {
      toastError('检索失败: ' + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">知识库 (Knowledge Base)</h2>
          <p className="text-sm text-slate-500">管理您的 PDF、Word 和 Markdown 文档，为 AI 提供专业背景知识。</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsAddingCategory(true)}
            className="px-4 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white rounded-xl hover:bg-slate-50 transition-all text-sm font-bold"
          >
            新建分类
          </button>
          <label className={`px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all text-sm font-bold cursor-pointer shadow-lg shadow-primary/20 ${!selectedCategoryId ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <input 
              type="file" 
              className="hidden" 
              disabled={!selectedCategoryId || isUploading}
              onChange={handleFileUpload}
              accept=".pdf,.docx,.doc,.md,.txt"
            />
            {isUploading ? '处理中...' : '上传文档'}
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Categories Sidebar */}
        <div className="lg:col-span-1 space-y-4">
          {/* Semantic Search Box (Moved back to sidebar top) */}
          <div className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 px-2">语义检索测试</h3>
            <div className="space-y-3">
              <textarea 
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleQuery();
                  }
                }}
                placeholder="输入问题，Enter 提交..."
                className="w-full p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-2xl text-[11px] outline-none focus:ring-2 focus:ring-primary/20 resize-none dark:text-white"
                rows={3}
              />
              <button 
                onClick={handleQuery}
                disabled={isSearching || !query.trim()}
                className="w-full py-2 bg-slate-800 text-white rounded-xl text-[11px] font-bold hover:bg-slate-900 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSearching ? '检索中...' : (
                  <>
                    <span className="material-symbols-outlined text-sm">send</span>
                    提交查询
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 px-2">知识分类</h3>
            <div className="space-y-1">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all ${
                    selectedCategoryId === cat.id 
                      ? 'bg-primary text-white shadow-md shadow-primary/20' 
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-xl">folder</span>
                    <span className="text-sm font-bold truncate max-w-[120px]">{cat.name}</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    selectedCategoryId === cat.id ? 'bg-white/20' : 'bg-slate-100 dark:bg-white/5'
                  }`}>
                    {cat.documentCount}
                  </span>
                </button>
              ))}
              {categories.length === 0 && !isLoading && (
                <div className="text-center py-8 text-slate-400 text-xs">暂无分类</div>
              )}
            </div>
          </div>
        </div>

        {/* Documents Grid Area */}
        <div className="lg:col-span-3 space-y-6">
          <AnimatePresence mode="wait">
            {searchResult ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-3xl p-6"
              >
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <span className="material-symbols-outlined">auto_awesome</span>
                    <h4 className="text-sm font-bold">AI 检索回复</h4>
                  </div>
                  <button onClick={() => setSearchResult(null)} className="text-blue-400 hover:text-blue-600 transition-colors">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {searchResult}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key={selectedCategoryId}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {documents.map(doc => (
                  <div key={doc.id} className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-5 shadow-sm hover:shadow-md transition-all group">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          doc.type === 'pdf' ? 'bg-red-50 text-red-500' : 
                          doc.type === 'docx' ? 'bg-blue-50 text-blue-500' : 
                          'bg-slate-50 text-slate-500'
                        }`}>
                          <span className="material-symbols-outlined text-2xl">
                            {doc.type === 'pdf' ? 'picture_as_pdf' : doc.type === 'docx' ? 'description' : 'article'}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-slate-900 dark:text-white truncate" title={doc.name}>{doc.name}</h4>
                          <p className="text-[10px] text-slate-400">{doc.type.toUpperCase()} · {doc.chunkCount} 个分块</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all opacity-0 group-hover:opacity-100"
                      >
                        <span className="material-symbols-outlined text-lg">delete</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed bg-slate-50 dark:bg-white/[0.02] p-2 rounded-xl">
                      {doc.summary}
                    </p>
                    <div className="mt-3 flex justify-between items-center text-[10px] text-slate-400">
                      <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                      <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 rounded-full">就绪</span>
                    </div>
                  </div>
                ))}
                {documents.length === 0 && !isLoading && (
                  <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400">
                    <span className="material-symbols-outlined text-5xl mb-4 opacity-20">inventory_2</span>
                    <p className="text-sm font-bold">该分类下暂无文档</p>
                    <p className="text-xs mt-1">点击右上角按钮开始上传</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Add Category Modal */}
      <AnimatePresence>
        {isAddingCategory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-md p-8"
            >
              <h3 className="text-xl font-bold mb-6 dark:text-white">创建新知识分类</h3>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">名称</label>
                  <input 
                    type="text"
                    value={newCategory.name}
                    onChange={e => setNewCategory({...newCategory, name: e.target.value})}
                    placeholder="例如：产品指南"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">描述</label>
                  <input 
                    type="text"
                    value={newCategory.description}
                    onChange={e => setNewCategory({...newCategory, description: e.target.value})}
                    placeholder="简短说明分类内容"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 dark:text-white"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={handleAddCategory}
                    className="flex-1 py-3 bg-primary text-white rounded-2xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    确认创建
                  </button>
                  <button 
                    onClick={() => setIsAddingCategory(false)}
                    className="flex-1 py-3 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
                  >
                    取消
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default KnowledgeBase;
