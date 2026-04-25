import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { knowledgeService } from '../services/knowledgeService';
import type { KBCategory, KBDocument } from '../services/knowledgeService';
import { useToast } from '../context/ToastContext';

const KnowledgeBase: React.FC = () => {
  const { success, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState<'knowledge' | 'memory'>('knowledge');

  // Knowledge State
  const [categories, setCategories] = useState<KBCategory[]>([]);
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  
  // Memory State
  const [memoryCategories, setMemoryCategories] = useState<KBCategory[]>([]);
  const [selectedMemoryCategoryId, setSelectedMemoryCategoryId] = useState<string | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<any[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [movingDocId, setMovingDocId] = useState<string | null>(null);
  const [movingMemoryId, setMovingMemoryId] = useState<string | null>(null);
  const [isSelectingTarget, setIsSelectingTarget] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [editingCategory, setEditingCategory] = useState<KBCategory | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState({ name: '', description: '' });
  
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Detail Modal State
  const [selectedItem, setSelectedItem] = useState<{ id: string, name: string, type: 'knowledge' | 'memory' } | null>(null);
  const [itemContent, setItemContent] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isEditingItem, setIsEditingItem] = useState(false);
  const [editedContent, setEditedContent] = useState<string>('');

  useEffect(() => {
    if (activeTab === 'knowledge') {
      loadCategories();
    } else {
      loadMemoryCategories();
    }
    setSelectedCategoryIds([]); // Reset selection on tab change
  }, [activeTab]);

  useEffect(() => {
    if (selectedCategoryId && activeTab === 'knowledge') {
      loadDocuments(selectedCategoryId);
    } else {
      setDocuments([]);
    }
  }, [selectedCategoryId, activeTab]);

  useEffect(() => {
    if (selectedMemoryCategoryId && activeTab === 'memory') {
      loadMemoryDetails(selectedMemoryCategoryId);
    } else {
      setMemoryEntries([]);
    }
  }, [selectedMemoryCategoryId, activeTab]);

  const loadCategories = async () => {
    try {
      setIsLoading(true);
      const data = await knowledgeService.getCategories();
      setCategories(data);

      if (data.length === 0) {
        setSelectedCategoryId(null);
        return;
      }

      if (!selectedCategoryId || !data.some(category => category.id === selectedCategoryId)) {
        setSelectedCategoryId(data[0].id);
      }
    } catch (err: any) {
      toastError('加载分类失败: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMemoryCategories = async () => {
    try {
      setIsLoading(true);
      const data = await knowledgeService.getMemoryCategories();
      setMemoryCategories(data);

      if (data.length === 0) {
        setSelectedMemoryCategoryId(null);
        return;
      }

      if (!selectedMemoryCategoryId || !data.some(category => category.id === selectedMemoryCategoryId)) {
        setSelectedMemoryCategoryId(data[0].id);
      }
    } catch (err: any) {
      toastError('加载记忆分类失败: ' + err.message);
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

  const loadMemoryDetails = async (catId: string) => {
    try {
      const data = await knowledgeService.getMemoryCategoryDetails(catId);
      setMemoryEntries(data.entries || []);
    } catch (err: any) {
      toastError('加载记忆详情失败: ' + err.message);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategory.name.trim()) return;
    try {
      if (activeTab === 'knowledge') {
        await knowledgeService.addCategory(newCategory.name, newCategory.description);
        success('知识分类创建成功');
        await loadCategories();
      } else {
        await knowledgeService.addMemoryCategory(newCategory.name, newCategory.description);
        success('记忆主题创建成功');
        await loadMemoryCategories();
      }
      setIsAddingCategory(false);
      setNewCategory({ name: '', description: '' });
    } catch (err: any) {
      toastError('创建失败: ' + err.message);
    }
  };

  const handleMoveMemory = async (memoryId: string) => {
    setMovingMemoryId(memoryId);
    setIsSelectingTarget(true);
  };

  const confirmMoveMemory = async (targetCatId: string) => {
    if (!movingMemoryId) return;

    try {
      await knowledgeService.moveMemoryToCategory(movingMemoryId, targetCatId);
      const targetCat = memoryCategories.find(c => c.id === targetCatId);
      success(`已成功移动到主题: ${targetCat?.name || '新主题'}`);
      if (selectedMemoryCategoryId) {
        await loadMemoryDetails(selectedMemoryCategoryId);
        await loadMemoryCategories();
      }
      setIsSelectingTarget(false);
      setMovingMemoryId(null);
    } catch (err: any) {
      toastError('移动失败: ' + err.message);
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !editingCategory.name.trim()) return;
    try {
      if (activeTab === 'knowledge') {
        await knowledgeService.updateCategory(editingCategory.id, editingCategory.name, editingCategory.description);
        success('知识分类更新成功');
        await loadCategories();
      } else {
        await knowledgeService.updateMemoryCategory(editingCategory.id, editingCategory.name, editingCategory.description);
        success('记忆主题更新成功');
        await loadMemoryCategories();
      }
      setEditingCategory(null);
    } catch (err: any) {
      toastError('更新失败: ' + err.message);
    }
  };

  const handleMergeCategories = async () => {
    if (selectedCategoryIds.length < 2) return;
    const currentCategories = activeTab === 'knowledge' ? categories : memoryCategories;
    const targetName = prompt("请输入合并后的新分类名称:", currentCategories.find(c => c.id === selectedCategoryIds[0])?.name || "");
    if (!targetName) return;

    try {
      setIsMerging(true);
      if (activeTab === 'knowledge') {
        await knowledgeService.mergeCategories(selectedCategoryIds, targetName, `由 ${selectedCategoryIds.length} 个分类合并而成`);
        success(`成功合并知识分类`);
        await loadCategories();
      } else {
        await knowledgeService.mergeMemoryCategories(selectedCategoryIds, targetName, `由 ${selectedCategoryIds.length} 个主题合并而成`);
        success(`成功合并记忆主题`);
        await loadMemoryCategories();
      }
      setSelectedCategoryIds([]);
    } catch (err: any) {
      toastError('合并失败: ' + err.message);
    } finally {
      setIsMerging(false);
    }
  };

  const handleDeleteCategory = async (category: KBCategory) => {
    const confirmed = confirm(`确定删除分类“${category.name}”吗？这将同时删除该分类下的所有文档与分块。`);
    if (!confirmed) return;

    try {
      setDeletingCategoryId(category.id);
      const nextCategory = (activeTab === 'knowledge' ? categories : memoryCategories).find(item => item.id !== category.id) ?? null;
      
      if (activeTab === 'knowledge') {
        await knowledgeService.deleteCategory(category.id);
        if (selectedCategoryId === category.id) setSelectedCategoryId(nextCategory?.id ?? null);
        await loadCategories();
      } else {
        await knowledgeService.deleteMemoryCategory(category.id);
        if (selectedMemoryCategoryId === category.id) setSelectedMemoryCategoryId(nextCategory?.id ?? null);
        await loadMemoryCategories();
      }
      
      success('分类已删除');
      setSearchResult(null);
    } catch (err: any) {
      toastError('删除失败: ' + err.message);
    } finally {
      setDeletingCategoryId(null);
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
      await loadCategories();
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

  const handleMoveToMemory = async (doc: KBDocument) => {
    const confirmed = confirm(`确定将文档“${doc.name}”转换为长期记忆吗？\n\n系统将自动提取文档全文，由 AI 进行深度整理、格式化并存入记忆库。该过程可能需要几秒钟。`);
    if (!confirmed) return;

    try {
      setMovingDocId(doc.id);
      await knowledgeService.moveDocumentToMemory(doc.id);
      success('文档已成功整理并转为长期记忆');
      if (selectedCategoryId) {
        await loadDocuments(selectedCategoryId);
        await loadCategories();
      }
    } catch (err: any) {
      toastError('转换失败: ' + err.message);
    } finally {
      setMovingDocId(null);
    }
  };

  const handleDeleteMemory = async (memId: string) => {
    if (!confirm('确定删除该记忆条目吗？')) return;
    try {
      await knowledgeService.deleteMemory(memId);
      success('记忆已删除');
      setSelectedMemoryIds(prev => prev.filter(id => id !== memId));
      if (selectedMemoryCategoryId) {
        await loadMemoryDetails(selectedMemoryCategoryId);
        await loadMemoryCategories();
      }
    } catch (err: any) {
      toastError('删除失败: ' + err.message);
    }
  };

  const handleMergeMemories = async () => {
    if (selectedMemoryIds.length < 2) return;
    const confirmed = confirm(`确定将选中的 ${selectedMemoryIds.length} 条记忆合并为一条吗？这会生成一条包含所有细节的新记忆，并删除旧记忆。`);
    if (!confirmed) return;

    try {
      setIsMerging(true);
      const res = await knowledgeService.mergeMemories(selectedMemoryIds, selectedMemoryCategoryId || undefined);
      success(`成功合并 ${selectedMemoryIds.length} 条记忆，生成新记录 ${res.id.slice(-6)}`);
      setSelectedMemoryIds([]);
      if (selectedMemoryCategoryId) {
        await loadMemoryDetails(selectedMemoryCategoryId);
        await loadMemoryCategories();
      }
    } catch (err: any) {
      toastError('合并失败: ' + err.message);
    } finally {
      setIsMerging(false);
    }
  };

  const toggleSelectMemory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedMemoryIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleShowDetail = async (id: string, name: string, type: 'knowledge' | 'memory') => {
    setSelectedItem({ id, name, type });
    setItemContent(null);
    setEditedContent('');
    setIsEditingItem(false);
    setIsLoadingContent(true);
    try {
      if (type === 'knowledge') {
        const res = await knowledgeService.getDocumentContent(id);
        setItemContent(res.content);
        setEditedContent(res.content);
      } else {
        const res = await knowledgeService.getMemoryContent(id);
        setItemContent(res.content);
        setEditedContent(res.content);
      }
    } catch (err: any) {
      toastError('获取内容失败: ' + err.message);
      setSelectedItem(null);
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleSaveContent = async () => {
    if (!selectedItem) return;
    try {
      setIsLoadingContent(true);
      if (selectedItem.type === 'knowledge') {
        await knowledgeService.updateDocumentContent(selectedItem.id, editedContent);
        success('文档内容已更新');
        if (selectedCategoryId) await loadDocuments(selectedCategoryId);
      } else {
        await knowledgeService.updateMemoryContent(selectedItem.id, editedContent);
        success('记忆内容已更新');
        if (selectedMemoryCategoryId) await loadMemoryDetails(selectedMemoryCategoryId);
      }
      setItemContent(editedContent);
      setIsEditingItem(false);
    } catch (err: any) {
      toastError('保存失败: ' + err.message);
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleQuery = async () => {
    if (!query.trim()) return;
    try {
      setIsSearching(true);
      setSearchResult(null);
      
      let res;
      if (activeTab === 'knowledge') {
        res = await knowledgeService.queryKnowledge(query, selectedCategoryId ? [selectedCategoryId] : undefined);
      } else {
        res = await knowledgeService.queryMemory(query, selectedMemoryCategoryId ? [selectedMemoryCategoryId] : undefined);
      }
      
      setSearchResult(res.answer);
    } catch (err: any) {
      toastError('检索失败: ' + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-white truncate">知识与记忆</h2>
          <p className="text-xs md:text-sm text-slate-500 truncate">
            {activeTab === 'knowledge' 
              ? '管理专业文档，为 AI 提供行业背景。' 
              : '查看对话中沉淀的长期记忆与经验。'}
          </p>
          
          <div className="flex gap-1 mt-4 bg-slate-100 dark:bg-white/5 p-1 rounded-xl w-full md:w-fit overflow-x-auto no-scrollbar">
            <button 
              onClick={() => { setActiveTab('knowledge'); setSearchResult(null); }}
              className={`flex-1 md:flex-none px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'knowledge' 
                  ? 'bg-white dark:bg-white/10 text-primary dark:text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              本地知识库
            </button>
            <button 
              onClick={() => { setActiveTab('memory'); setSearchResult(null); }}
              className={`flex-1 md:flex-none px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'memory' 
                  ? 'bg-white dark:bg-white/10 text-primary dark:text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              长期记忆库
            </button>
          </div>
        </div>
        
        {activeTab === 'knowledge' ? (
          <div className="flex gap-2 w-full md:w-auto">
            <button 
              onClick={() => setIsAddingCategory(true)}
              className="flex-1 md:flex-none px-4 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white rounded-xl hover:bg-slate-50 transition-all text-xs md:text-sm font-bold"
            >
              新建分类
            </button>
            <label className={`flex-1 md:flex-none px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all text-xs md:text-sm font-bold cursor-pointer text-center shadow-lg shadow-primary/20 ${!selectedCategoryId ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input 
                type="file" 
                className="hidden" 
                disabled={!selectedCategoryId || isUploading}
                onChange={handleFileUpload}
                accept=".pdf,.docx,.doc,.md,.txt,.csv,.xlsx,.xls"
              />
              {isUploading ? '处理中...' : '上传文档'}
            </label>
          </div>
        ) : (
          <div className="flex gap-2 w-full md:w-auto">
            {selectedMemoryIds.length === 0 && (
              <button 
                onClick={() => setIsAddingCategory(true)}
                className="flex-1 md:flex-none px-4 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white rounded-xl hover:bg-slate-50 transition-all text-xs md:text-sm font-bold"
              >
                新建主题
              </button>
            )}
            {selectedMemoryIds.length > 0 && (
              <div className="flex items-center justify-between md:justify-start gap-4 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-4 md:px-6 py-3 rounded-2xl animate-in slide-in-from-top-4 w-full md:w-auto">
                <span className="text-xs md:text-sm font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap">
                  已选中 {selectedMemoryIds.length} 条
                </span>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={handleMergeMemories}
                    disabled={selectedMemoryIds.length < 2 || isMerging}
                    className="flex items-center gap-2 px-3 md:px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-[10px] md:text-xs font-bold transition-all shadow-md shadow-purple-600/20"
                  >
                    <span className="material-symbols-outlined text-sm hidden md:inline">auto_fix_high</span>
                    {isMerging ? '处理中' : '合并整理'}
                  </button>
                  <button 
                    onClick={() => setSelectedMemoryIds([])}
                    className="text-[10px] md:text-xs text-purple-500 hover:text-purple-700 dark:text-purple-400 font-bold"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4 order-2 lg:order-1">
          <div className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-4 shadow-sm">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 px-2">语义检索测试</h3>
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
                placeholder={activeTab === 'knowledge' ? "查询知识库文档..." : "检索历史记忆片段..."}
                className="w-full p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-2xl text-[11px] outline-none focus:ring-2 focus:ring-primary/20 resize-none dark:text-white"
                rows={2}
              />
              <button 
                onClick={handleQuery}
                disabled={isSearching || !query.trim()}
                className="w-full py-2.5 bg-slate-800 text-white rounded-xl text-[11px] font-bold hover:bg-slate-900 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSearching ? '检索中...' : (
                  <>
                    <span className="material-symbols-outlined text-sm">send</span>
                    开始检索
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-4 shadow-sm">
            <div className="flex justify-between items-center mb-4 px-2">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {activeTab === 'knowledge' ? '知识分类' : '记忆主题'}
              </h3>
              {selectedCategoryIds.length >= 2 && (
                <button 
                  onClick={handleMergeCategories}
                  className={`text-[9px] ${activeTab === 'knowledge' ? 'bg-primary/10 text-primary' : 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400'} px-2 py-1 rounded-md font-bold hover:opacity-80 transition-all`}
                >
                  合并 ({selectedCategoryIds.length})
                </button>
              )}
            </div>
            <div className="space-y-1 max-h-[40vh] lg:max-h-none overflow-y-auto custom-scrollbar pr-1">
              {(activeTab === 'knowledge' ? categories : memoryCategories).map(cat => (
                <div
                  key={cat.id}
                  className={`w-full flex items-center justify-between p-2.5 md:p-3 rounded-2xl transition-all ${
                    (activeTab === 'knowledge' ? selectedCategoryId : selectedMemoryCategoryId) === cat.id 
                      ? 'bg-primary text-white shadow-md shadow-primary/20' 
                      : (selectedCategoryIds.includes(cat.id) ? (activeTab === 'knowledge' ? 'bg-primary/5 text-primary border border-primary/20' : 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20') : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5')
                  }`}
                >
                  <button
                    onClick={() => {
                      if (activeTab === 'knowledge') {
                        setSelectedCategoryId(cat.id);
                      } else {
                        setSelectedMemoryCategoryId(cat.id);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSelectedCategoryIds(prev => 
                        prev.includes(cat.id) ? prev.filter(id => id !== cat.id) : [...prev, cat.id]
                      );
                    }}
                    className="flex items-center gap-2 md:gap-3 min-w-0 flex-1 text-left"
                  >
                    <span 
                      className={`material-symbols-outlined text-lg md:text-xl ${selectedCategoryIds.includes(cat.id) ? 'fill-1' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCategoryIds(prev => 
                          prev.includes(cat.id) ? prev.filter(id => id !== cat.id) : [...prev, cat.id]
                        );
                      }}
                    >
                      {selectedCategoryIds.includes(cat.id) ? 'check_box' : (activeTab === 'knowledge' ? 'folder' : 'psychology')}
                    </span>
                    <span className="text-xs md:text-sm font-bold truncate max-w-[80px] md:max-w-[100px]">{cat.name}</span>
                  </button>
                  <div className="flex items-center gap-0.5 md:gap-1 shrink-0 ml-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingCategory(cat); }}
                      className={`w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-full transition-all ${
                        (activeTab === 'knowledge' ? selectedCategoryId : selectedMemoryCategoryId) === cat.id ? 'text-white/80 hover:text-white hover:bg-white/15' : 'text-slate-300 hover:text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm md:text-base">edit</span>
                    </button>
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        handleDeleteCategory(cat); 
                      }}
                      disabled={deletingCategoryId === cat.id}
                      className={`w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-full transition-all ${
                        (activeTab === 'knowledge' ? selectedCategoryId : selectedMemoryCategoryId) === cat.id
                          ? 'text-white/80 hover:text-white hover:bg-white/15'
                          : 'text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
                      } disabled:opacity-50`}
                    >
                      <span className="material-symbols-outlined text-sm md:text-base">
                        {deletingCategoryId === cat.id ? 'hourglass_top' : 'delete'}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
              {(activeTab === 'knowledge' ? categories : memoryCategories).length === 0 && !isLoading && (
                <div className="text-center py-8 text-slate-400 text-xs">暂无分类</div>
              )}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3 space-y-6 order-1 lg:order-2">
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
                <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                  {searchResult}
                </div>
              </motion.div>
            ) : activeTab === 'knowledge' ? (
              <motion.div 
                key={`kb-${selectedCategoryId}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {documents.map(doc => (
                  <div 
                    key={doc.id} 
                    onClick={() => movingDocId !== doc.id && handleShowDetail(doc.id, doc.name, 'knowledge')}
                    className={`bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-5 shadow-sm hover:shadow-md transition-all group relative overflow-hidden ${
                      movingDocId === doc.id ? 'opacity-75 cursor-wait' : 'cursor-pointer'
                    }`}
                  >
                    {movingDocId === doc.id && (
                      <div className="absolute inset-0 z-10 bg-white/60 dark:bg-surface-dark/80 backdrop-blur-[2px] flex flex-col items-center justify-center text-primary text-center px-4">
                        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin mb-2"></div>
                        <span className="text-[10px] font-bold">AI 深度整理中...</span>
                      </div>
                    )}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          doc.type === 'pdf' ? 'bg-red-50 text-red-500' : 
                          doc.type === 'docx' ? 'bg-blue-50 text-blue-500' : 
                          doc.type === 'xlsx' || doc.type === 'xls' ? 'bg-green-50 text-green-500' :
                          doc.type === 'csv' ? 'bg-teal-50 text-teal-500' :
                          'bg-slate-50 text-slate-500'
                        }`}>
                          <span className="material-symbols-outlined text-2xl">
                            {doc.type === 'pdf' ? 'picture_as_pdf' : 
                             doc.type === 'docx' ? 'description' : 
                             doc.type === 'xlsx' || doc.type === 'xls' ? 'table_view' :
                             doc.type === 'csv' ? 'format_list_bulleted' :
                             'article'}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-slate-900 dark:text-white truncate text-sm md:text-base" title={doc.name}>{doc.name}</h4>
                          <p className="text-[10px] text-slate-400">{doc.type.toUpperCase()} · {doc.chunkCount} 个分块</p>
                        </div>
                      </div>
                      <div className={`flex items-center gap-1 transition-all ${movingDocId === doc.id ? 'invisible' : 'md:opacity-0 md:group-hover:opacity-100'}`}>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleMoveToMemory(doc); }}
                          title="转为长期记忆"
                          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/10 rounded-full"
                        >
                          <span className="material-symbols-outlined text-lg">psychology</span>
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteDocument(doc.id); }}
                          title="删除文档"
                          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full"
                        >
                          <span className="material-symbols-outlined text-lg">delete</span>
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed bg-slate-50 dark:bg-white/[0.02] p-2 rounded-xl break-words">
                      {doc.summary}
                    </p>
                    <div className="mt-3 flex justify-between items-center text-[10px] text-slate-400">
                      <span>{new Date(doc.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>
                      <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 rounded-full">就绪</span>
                    </div>
                  </div>
                ))}
                {documents.length === 0 && !isLoading && (
                  <div className="col-span-full flex flex-col items-center justify-center py-10 md:py-20 text-slate-400">
                    <span className="material-symbols-outlined text-5xl mb-4 opacity-20">inventory_2</span>
                    <p className="text-sm font-bold">该分类下暂无文档</p>
                    <p className="text-xs mt-1">点击右上角按钮开始上传</p>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key={`mem-${selectedMemoryCategoryId}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {memoryEntries.map(mem => (
                  <div 
                    key={mem.id} 
                    onClick={() => handleShowDetail(mem.id, `记忆片段 ${mem.id.slice(-6)}`, 'memory')}
                    className={`bg-white dark:bg-surface-dark rounded-3xl border ${
                      selectedMemoryIds.includes(mem.id) 
                        ? 'border-purple-500 shadow-md shadow-purple-500/10' 
                        : 'border-slate-200 dark:border-white/5 shadow-sm'
                    } p-5 hover:shadow-md transition-all group cursor-pointer relative`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div 
                          className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 cursor-pointer hover:scale-110 transition-transform"
                          onClick={(e) => toggleSelectMemory(mem.id, e)}
                        >
                          <span className={`material-symbols-outlined text-2xl ${
                            selectedMemoryIds.includes(mem.id) ? 'fill-1' : ''
                          }`}>
                            {selectedMemoryIds.includes(mem.id) ? 'check_circle' : 'sticky_note'}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-slate-900 dark:text-white truncate text-sm md:text-base">记忆片段 {mem.id.slice(-6)}</h4>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-[10px] font-bold ${
                              mem.importance >= 4 ? 'text-orange-500' : 'text-slate-400'
                            }`}>
                              重要度 {mem.importance}
                            </span>
                            {mem.tags?.map((tag: string) => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-slate-100 dark:bg-white/5 rounded-md text-slate-500 uppercase font-medium">{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 transition-all md:opacity-0 md:group-hover:opacity-100">
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleMoveMemory(mem.id); }}
                          disabled={movingMemoryId === mem.id}
                          title="移动到其他主题"
                          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/10 rounded-full disabled:opacity-50"
                        >
                          <span className={`material-symbols-outlined text-lg ${movingMemoryId === mem.id ? 'animate-spin' : ''}`}>
                            {movingMemoryId === mem.id ? 'hourglass_top' : 'move_item'}
                          </span>
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteMemory(mem.id); }}
                          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                        >
                          <span className="material-symbols-outlined text-lg">delete</span>
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-3 leading-relaxed bg-slate-50 dark:bg-white/[0.02] p-2 rounded-xl italic">
                      “{mem.summary}”
                    </p>
                    <div className="mt-3 flex justify-between items-center text-[10px] text-slate-400">
                      <span>{new Date(mem.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>
                      <span className="px-2 py-0.5 bg-purple-50 dark:bg-purple-500/5 text-purple-600 dark:text-purple-400 rounded-full">长期记忆</span>
                    </div>
                  </div>
                ))}
                {memoryEntries.length === 0 && !isLoading && (
                  <div className="col-span-full flex flex-col items-center justify-center py-10 md:py-20 text-slate-400">
                    <span className="material-symbols-outlined text-5xl mb-4 opacity-20">cloud_off</span>
                    <p className="text-sm font-bold">该主题下暂无记忆</p>
                    <p className="text-xs mt-1">记忆会在您与智能体的对话中自动生成</p>
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
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-md p-6 md:p-8"
            >
              <h3 className="text-xl font-bold mb-6 dark:text-white">创建新{activeTab === 'knowledge' ? '知识分类' : '记忆主题'}</h3>
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

      {/* Edit Category Modal */}
      <AnimatePresence>
        {editingCategory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-md p-6 md:p-8"
            >
              <h3 className="text-xl font-bold mb-6 dark:text-white">编辑{activeTab === 'knowledge' ? '知识分类' : '记忆主题'}</h3>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">名称</label>
                  <input 
                    type="text"
                    value={editingCategory.name}
                    onChange={e => setEditingCategory({...editingCategory, name: e.target.value})}
                    placeholder="分类名称"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">描述</label>
                  <textarea 
                    value={editingCategory.description}
                    onChange={e => setEditingCategory({...editingCategory, description: e.target.value})}
                    placeholder="说明该分类包含的内容"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 dark:text-white"
                    rows={3}
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={handleUpdateCategory}
                    className="flex-1 py-3 bg-primary text-white rounded-2xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    保存修改
                  </button>
                  <button 
                    onClick={() => setEditingCategory(null)}
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

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-2xl md:rounded-[32px] shadow-2xl w-full max-w-4xl max-h-[95vh] md:max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="p-4 md:p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50/50 dark:bg-white/5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-primary mb-1">
                    <span className="material-symbols-outlined text-sm">
                      {selectedItem.type === 'knowledge' ? 'description' : 'psychology'}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      {selectedItem.type === 'knowledge' ? '知识库文档' : '长期记忆'}
                    </span>
                  </div>
                  <h3 className="text-base md:text-xl font-bold dark:text-white truncate max-w-[200px] md:max-w-2xl">{selectedItem.name}</h3>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!isEditingItem && (
                    <button 
                      onClick={() => setIsEditingItem(true)}
                      className="flex items-center gap-1 md:gap-2 px-3 md:px-4 py-1.5 md:py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white rounded-xl hover:bg-slate-50 transition-all text-[10px] md:text-xs font-bold"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                      <span className="hidden md:inline">编辑内容</span>
                    </button>
                  )}
                  <button 
                    onClick={() => setSelectedItem(null)}
                    className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-white/10 transition-all text-slate-500"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
                {isLoadingContent ? (
                  <div className="flex flex-col items-center justify-center py-10 md:py-20 text-slate-400">
                    <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4"></div>
                    <p className="text-sm">正在加载全文内容...</p>
                  </div>
                ) : isEditingItem ? (
                  <div className="h-full min-h-[300px] md:min-h-[400px]">
                    <textarea 
                      value={editedContent}
                      onChange={e => setEditedContent(e.target.value)}
                      className="w-full h-full min-h-[300px] md:min-h-[400px] p-4 md:p-6 bg-slate-50 dark:bg-black/20 border border-primary/20 rounded-2xl text-xs md:text-sm leading-relaxed text-slate-700 dark:text-slate-200 font-mono outline-none focus:ring-2 focus:ring-primary/10 resize-none"
                      placeholder="在此编辑内容..."
                    />
                  </div>
                ) : (
                  <div className="prose dark:prose-invert max-w-none">
                    <div className="whitespace-pre-wrap break-words text-xs md:text-sm leading-relaxed text-slate-600 dark:text-slate-300 font-mono bg-slate-50 dark:bg-white/5 p-4 md:p-6 rounded-2xl border border-slate-100 dark:border-white/5">
                      {itemContent}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 md:p-6 bg-slate-50/50 dark:bg-white/5 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3">
                {isEditingItem ? (
                  <>
                    <button 
                      onClick={handleSaveContent}
                      className="flex-1 md:flex-none px-6 py-2 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 text-sm"
                    >
                      保存修改
                    </button>
                    <button 
                      onClick={() => { setIsEditingItem(false); setEditedContent(itemContent || ''); }}
                      className="flex-1 md:flex-none px-6 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white rounded-xl hover:bg-slate-50 transition-all font-bold text-sm"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={() => setSelectedItem(null)}
                    className="w-full md:w-auto px-8 py-2 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all shadow-lg shadow-slate-900/20 text-sm"
                  >
                    关闭
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Select Target Category Modal */}
      <AnimatePresence>
        {isSelectingTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-md p-6 md:p-8"
            >
              <h3 className="text-xl font-bold mb-6 dark:text-white">移动记忆片段</h3>
              <p className="text-xs text-slate-500 mb-4 px-1">请选择目标主题：</p>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                {memoryCategories
                  .filter(c => c.id !== selectedMemoryCategoryId)
                  .map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => confirmMoveMemory(cat.id)}
                      className="w-full text-left p-4 rounded-2xl border border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-purple-500">psychology</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold dark:text-white truncate">{cat.name}</div>
                          <div className="text-[10px] text-slate-400 truncate">{cat.description}</div>
                        </div>
                        <span className="material-symbols-outlined text-slate-300 group-hover:text-primary transition-colors">chevron_right</span>
                      </div>
                    </button>
                  ))}
                {memoryCategories.filter(c => c.id !== selectedMemoryCategoryId).length === 0 && (
                  <div className="text-center py-6 text-slate-400 text-xs italic">
                    没有其他可选主题
                  </div>
                )}
              </div>
              <div className="mt-6">
                <button 
                  onClick={() => { setIsSelectingTarget(false); setMovingMemoryId(null); }}
                  className="w-full py-3 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
                >
                  取消移动
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default KnowledgeBase;
