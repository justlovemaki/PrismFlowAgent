import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { agentService } from '../services/agentService';
import type { Agent, Skill, Tool, Workflow, WorkflowStep, MCPServerConfig } from '../services/agentService';
import { getSettings } from '../services/settingsService';
import { useToast } from '../context/ToastContext.js';

const FileTreeNode: React.FC<{
  items: any[];
  skillId: string;
  selectedPath: string | null;
  onSelect: (skillId: string, path: string) => void;
  depth?: number;
}> = ({ items, skillId, selectedPath, onSelect, depth = 0 }) => (
  <div className={depth > 0 ? 'ml-3 border-l border-slate-100 dark:border-white/5 pl-2' : ''}>
    {items.map((item: any) => (
      <div key={item.path}>
        {item.type === 'dir' ? (
          <div>
            <div className="flex items-center gap-1.5 py-1 px-1.5 text-slate-500 dark:text-slate-400">
              <span className="material-symbols-outlined text-sm">folder</span>
              <span className="text-[11px] font-bold">{item.name}</span>
            </div>
            {item.children && (
              <FileTreeNode items={item.children} skillId={skillId} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
            )}
          </div>
        ) : (
          <button
            onClick={() => onSelect(skillId, item.path)}
            className={`w-full flex items-center gap-1.5 py-1 px-1.5 rounded-lg text-left transition-all ${
              selectedPath === item.path
                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
            }`}
          >
            <span className="material-symbols-outlined text-sm">
              {item.name.endsWith('.md') ? 'article' : item.name.endsWith('.py') || item.name.endsWith('.js') || item.name.endsWith('.ts') ? 'code' : 'description'}
            </span>
            <span className="text-[11px] truncate flex-1">{item.name}</span>
            <span className="text-[9px] text-slate-400 flex-shrink-0">{item.size < 1024 ? `${item.size}B` : `${(item.size / 1024).toFixed(1)}K`}</span>
          </button>
        )}
      </div>
    ))}
  </div>
);

const Agents: React.FC = () => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState('agents');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Form states
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [mcpConfigs, setMcpConfigs] = useState<MCPServerConfig[]>([]);
  const [editingMCP, setEditingMCP] = useState<MCPServerConfig | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testingAgentId, setTestingAgentId] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const skillFileRef = React.useRef<HTMLInputElement>(null);
  const [previewSkill, setPreviewSkill] = useState<Skill | null>(null);
  const [skillFileTree, setSkillFileTree] = useState<any[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [testingWorkflowId, setTestingWorkflowId] = useState<string | null>(null);
  const [workflowTestInput, setWorkflowTestInput] = useState('');
  const [workflowTestResult, setWorkflowTestResult] = useState<Record<string, string>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [agentsData, skillsData, toolsData, workflowsData, settingsData, mcpData] = await Promise.all([
        agentService.getAgents(),
        agentService.getSkills(),
        agentService.getTools(),
        agentService.getWorkflows(),
        getSettings(),
        agentService.getMCPConfigs()
      ]);
      setAgents(agentsData);
      setSkills(skillsData);
      setTools(toolsData);
      setWorkflows(workflowsData);
      setSettings(settingsData);
      setMcpConfigs(mcpData);
    } catch (error) {
      console.error('Failed to load agent data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveAgent = async (agent: Agent) => {
    try {
      setIsSaving(true);
      await agentService.saveAgent(agent);
      await loadData();
      setEditingAgent(null);
      toastSuccess('Agent 保存成功');
    } catch (error) {
      toastError('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAgent = async (id: string) => {
    if (!confirm('确定删除该 Agent 吗？')) return;
    try {
      await agentService.deleteAgent(id);
      await loadData();
      toastSuccess('Agent 已删除');
    } catch (error) {
      toastError('删除失败');
    }
  };

  const handleRunAgent = async (id: string, input: string) => {
    try {
      // 在测试前清除上一次的测试结果
      setTestResults(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      
      setTestResults(prev => ({ ...prev, [id]: '运行中...' }));
      const result = await agentService.runAgent(id, input);
      setTestResults(prev => ({ ...prev, [id]: result.content }));
    } catch (error: any) {
      setTestResults(prev => ({ ...prev, [id]: `错误: ${error.message}` }));
    }
  };

  const tabs = [
    { id: 'agents', label: '智能体 (Agents)', icon: 'smart_toy' },
    { id: 'tools', label: '工具箱 (Tools)', icon: 'construction' },
    { id: 'skills', label: '技能库 (Skills)', icon: 'bolt' },
    { id: 'workflows', label: '工作流 (Workflows)', icon: 'account_tree' },
  ];

  const renderAgents = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Agent 列表</h3>
        <button 
          onClick={() => setEditingAgent({
            id: `agent_${Math.random().toString(36).substr(2, 5)}`,
            name: '新 Agent',
            description: '',
            systemPrompt: '',
            providerId: settings.ACTIVE_AI_PROVIDER_ID || '',
            model: '',
            temperature: 1.0,
            toolIds: [],
            skillIds: [],
            mcpServerIds: []
          })}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all text-sm font-bold shadow-lg shadow-primary/20"
        >
          <span className="material-symbols-outlined">add</span>
          创建智能体
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {agents.map(agent => (
          <div key={agent.id} className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-6 shadow-sm hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl">smart_toy</span>
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white">{agent.name}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{agent.description}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => { setTestingAgentId(agent.id); setTestInput(''); }}
                  className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 rounded-full transition-all"
                  title="测试"
                >
                  <span className="material-symbols-outlined text-xl">play_arrow</span>
                </button>
                <button 
                  onClick={() => setEditingAgent(agent)}
                  className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/10 rounded-full transition-all"
                >
                  <span className="material-symbols-outlined text-xl">edit</span>
                </button>
                <button 
                  onClick={() => handleDeleteAgent(agent.id)}
                  className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                >
                  <span className="material-symbols-outlined text-xl">delete</span>
                </button>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex flex-wrap gap-2">
                {agent.skillIds.map(sid => (
                  <span key={sid} className="px-2 py-1 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg text-[10px] font-bold">
                    {skills.find(s => s.id === sid)?.name || sid}
                  </span>
                ))}
                {agent.toolIds.map(tid => (
                  <span key={tid} className="px-2 py-1 bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 rounded-lg text-[10px] font-bold">
                    {tools.find(t => t.id === tid)?.name || tid}
                  </span>
                ))}
                {agent.toolIds.includes('search_knowledge_base') && (
                  <span className="px-2 py-1 bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 rounded-lg text-[10px] font-bold">
                    RAG 已开启
                  </span>
                )}
                {(agent.mcpServerIds || []).map(mid => (
                  <span key={mid} className="px-2 py-1 bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 rounded-lg text-[10px] font-bold">
                    {mcpConfigs.find(m => m.id === mid)?.name || mid}
                  </span>
                ))}
              </div>
            </div>

          </div>
        ))}
      </div>

      {/* Editing Modal */}
      <AnimatePresence>
        {editingAgent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-bold dark:text-white">配置智能体</h3>
                <button onClick={() => setEditingAgent(null)} className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">名称</label>
                    <input 
                      type="text"
                      value={editingAgent.name}
                      onChange={e => setEditingAgent({...editingAgent, name: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">ID</label>
                    <input 
                      type="text"
                      value={editingAgent.id}
                      disabled
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm opacity-50 dark:text-slate-400"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">描述</label>
                  <input 
                    type="text"
                    value={editingAgent.description}
                    onChange={e => setEditingAgent({...editingAgent, description: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">系统提示词 (System Prompt)</label>
                  <textarea 
                    rows={10}
                    value={editingAgent.systemPrompt}
                    onChange={e => setEditingAgent({...editingAgent, systemPrompt: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20 transition-all dark:text-white resize-y min-h-[200px]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">AI 提供商</label>
                    <div className="relative">
                      <select 
                        value={editingAgent.providerId}
                        onChange={e => {
                          const newProviderId = e.target.value;
                          const provider = (settings.AI_PROVIDERS || []).find((p: any) => p.id === newProviderId);
                          setEditingAgent({
                            ...editingAgent, 
                            providerId: newProviderId,
                            model: provider?.models?.[0] || '' // 切换提供商时默认选中第一个可用模型
                          });
                        }}
                        className="w-full appearance-none px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer dark:text-white"
                      >
                        <option value="">请选择提供商</option>
                        {(settings.AI_PROVIDERS || [])
                          .filter((p: any) => !(settings.CLOSED_PLUGINS || []).includes(p.id))
                          .map((p: any) => (
                            <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                          ))}
                      </select>
                      <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                        expand_more
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">模型</label>
                    <div className="relative">
                      {(settings.AI_PROVIDERS || []).find((p: any) => p.id === editingAgent.providerId)?.models?.length > 0 ? (
                        <>
                          <select 
                            value={editingAgent.model}
                            onChange={e => setEditingAgent({...editingAgent, model: e.target.value})}
                            className="w-full appearance-none px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer dark:text-white"
                          >
                            {(settings.AI_PROVIDERS || []).find((p: any) => p.id === editingAgent.providerId)?.models.map((m: string) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                            expand_more
                          </span>
                        </>
                      ) : (
                        <input 
                          type="text"
                          value={editingAgent.model}
                          placeholder="手动输入模型 ID..."
                          onChange={e => setEditingAgent({...editingAgent, model: e.target.value})}
                          className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all dark:text-white"
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center ml-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Temperature ({editingAgent.temperature})</label>
                  </div>
                  <input 
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={editingAgent.temperature}
                    onChange={e => setEditingAgent({...editingAgent, temperature: parseFloat(e.target.value)})}
                    className="w-full h-2 bg-slate-200 dark:bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">关联技能</label>
                  <div className="flex flex-wrap gap-2">
                    {skills.map(skill => (
                      <button
                        key={skill.id}
                        onClick={() => {
                          const skillIds = editingAgent.skillIds || [];
                          const ids = skillIds.includes(skill.id) ? [] : [skill.id];
                          setEditingAgent({...editingAgent, skillIds: ids});
                        }}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                          (editingAgent.skillIds || []).includes(skill.id)
                            ? 'bg-primary text-white border-primary shadow-sm shadow-primary/20'
                            : 'bg-white dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
                        }`}
                      >
                        {skill.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">可用工具</label>
                  <div className="flex flex-wrap gap-2">
                    {tools.filter(t => t.id !== 'search_knowledge_base').map(tool => (
                      <button
                        key={tool.id}
                        onClick={() => {
                          const toolIds = editingAgent.toolIds || [];
                          const isSelected = toolIds.includes(tool.id);
                          const hasRag = toolIds.includes('search_knowledge_base');
                          const newIds = isSelected 
                            ? (hasRag ? ['search_knowledge_base'] : []) 
                            : (hasRag ? [tool.id, 'search_knowledge_base'] : [tool.id]);
                          setEditingAgent({...editingAgent, toolIds: newIds});
                        }}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                          (editingAgent.toolIds || []).includes(tool.id)
                            ? 'bg-slate-800 dark:bg-white text-white dark:text-slate-900 border-slate-800 dark:border-white shadow-sm'
                            : 'bg-white dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
                        }`}
                      >
                        {tool.name}
                      </button>
                    ))}
                  </div>
                </div>

                {mcpConfigs.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">MCP 工具服务</label>
                    <div className="flex flex-wrap gap-2">
                      {mcpConfigs.map(mcp => (
                        <button
                          key={mcp.id}
                          onClick={() => {
                            const mcpIds = editingAgent.mcpServerIds || [];
                            const ids = mcpIds.includes(mcp.id) ? [] : [mcp.id];
                            setEditingAgent({...editingAgent, mcpServerIds: ids});
                          }}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border flex items-center gap-1.5 ${
                            (editingAgent.mcpServerIds || []).includes(mcp.id)
                              ? 'bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-500/20'
                              : 'bg-white dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
                          }`}
                        >
                          {mcp.name}
                          {!mcp.enabled && <span className="text-[8px] opacity-60">(已禁用)</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-4 bg-slate-50 dark:bg-white/[0.02] rounded-2xl border border-slate-200 dark:border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-green-500">database</span>
                      <span className="text-xs font-bold dark:text-white">RAG 知识库检索</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={editingAgent.toolIds.includes('search_knowledge_base')}
                        onChange={e => {
                          const toolIds = e.target.checked
                            ? [...editingAgent.toolIds, 'search_knowledge_base']
                            : editingAgent.toolIds.filter(id => id !== 'search_knowledge_base');
                          setEditingAgent({ ...editingAgent, toolIds });
                        }}
                      />
                      <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:bg-green-500 transition-all after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2">开启后，Agent 将调用 search_knowledge_base 工具检索历史资讯。</p>
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => handleSaveAgent(editingAgent)}
                    disabled={isSaving}
                    className="flex-1 py-3 bg-primary text-white rounded-2xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    {isSaving ? '保存中...' : '确认保存'}
                  </button>
                  <button 
                    onClick={() => setEditingAgent(null)}
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

      {/* Test Modal */}
      <AnimatePresence>
        {testingAgentId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-lg p-8"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-500/20 text-green-600 flex items-center justify-center">
                    <span className="material-symbols-outlined text-2xl">play_arrow</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold dark:text-white">测试智能体</h3>
                    <p className="text-xs text-slate-400">{agents.find(a => a.id === testingAgentId)?.name}</p>
                  </div>
                </div>
                <button onClick={() => setTestingAgentId(null)} className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-4">
                <textarea 
                  rows={3}
                  value={testInput}
                  onChange={e => setTestInput(e.target.value)}
                  placeholder="输入测试内容..."
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500/20 transition-all dark:text-white resize-none"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleRunAgent(testingAgentId, testInput);
                    }
                  }}
                />
                <button 
                  onClick={() => handleRunAgent(testingAgentId, testInput)}
                  disabled={!testInput.trim() || testResults[testingAgentId] === '运行中...'}
                  className="w-full py-3 bg-green-500 text-white rounded-2xl font-bold hover:bg-green-600 transition-all shadow-lg shadow-green-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-xl">
                    {testResults[testingAgentId] === '运行中...' ? 'hourglass_top' : 'send'}
                  </span>
                  {testResults[testingAgentId] === '运行中...' ? '运行中...' : '运行测试'}
                </button>

                {testResults[testingAgentId] && (
                  <div className="p-4 bg-slate-50 dark:bg-black/20 rounded-xl text-xs text-slate-600 dark:text-slate-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border border-slate-200 dark:border-white/5">
                    {testResults[testingAgentId]}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  const handleUploadSkill = async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      setUploadError('请上传 .zip 格式的压缩包');
      return;
    }
    try {
      setIsUploading(true);
      setUploadError(null);
      await agentService.uploadSkill(file);
      await loadData();
    } catch (error: any) {
      setUploadError(error.message || '上传失败');
    } finally {
      setIsUploading(false);
      if (skillFileRef.current) skillFileRef.current.value = '';
    }
  };

  const handleDeleteSkill = async (id: string) => {
    if (!confirm('确定删除该技能吗？')) return;
    try {
      await agentService.deleteSkill(id);
      await loadData();
      if (previewSkill?.id === id) setPreviewSkill(null);
      toastSuccess('技能已删除');
    } catch (error) {
      toastError('删除失败');
    }
  };

  const handlePreviewSkill = async (skill: Skill) => {
    setPreviewSkill(skill);
    setSelectedFilePath(null);
    setSelectedFileContent(null);
    try {
      const result = await agentService.getSkillFiles(skill.id);
      setSkillFileTree(result.files || []);
    } catch {
      setSkillFileTree([]);
    }
  };

  const handleSelectFile = async (skillId: string, filePath: string) => {
    setSelectedFilePath(filePath);
    setSelectedFileContent(null);
    setIsLoadingFile(true);
    try {
      const result = await agentService.getSkillFileContent(skillId, filePath);
      setSelectedFileContent(result.content);
    } catch {
      setSelectedFileContent('// 无法读取文件内容');
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleSaveFile = async () => {
    if (!previewSkill || !selectedFilePath || selectedFileContent === null) return;
    try {
      setIsSaving(true);
      await agentService.saveSkillFileContent(previewSkill.id, selectedFilePath, selectedFileContent);
      // 重新加载数据以刷新列表中的指令等信息
      await loadData();
      
      // 更新当前预览的技能对象，以同步名称和描述
      const updatedSkill = await agentService.getSkills().then((skills: Skill[]) => 
        skills.find(s => s.id === previewSkill.id)
      );
      if (updatedSkill) {
        setPreviewSkill(updatedSkill);
      }
      toastSuccess('文件保存成功');
    } catch (error: any) {
      toastError(`保存失败: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const renderSkills = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">技能库</h3>
        <div className="flex items-center gap-3">
          <input
            ref={skillFileRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleUploadSkill(file);
            }}
          />
          <button
            onClick={() => skillFileRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all text-sm font-bold shadow-lg shadow-blue-500/20 disabled:opacity-50"
          >
            <span className="material-symbols-outlined">{isUploading ? 'hourglass_top' : 'upload_file'}</span>
            {isUploading ? '上传中...' : '上传技能包'}
          </button>
        </div>
      </div>

      {uploadError && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl">
          <span className="material-symbols-outlined text-red-500">error</span>
          <span className="text-sm text-red-600 dark:text-red-400 font-medium">{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="ml-auto w-8 h-8 inline-flex items-center justify-center text-red-400 hover:bg-red-100 dark:hover:bg-red-500/10 rounded-full transition-all">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}

      {skills.length === 0 ? (
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleUploadSkill(file);
          }}
          className={`flex flex-col items-center justify-center py-20 rounded-[40px] border-2 border-dashed transition-all ${
            isDragging
              ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10'
              : 'border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02]'
          }`}
        >
          <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center mb-6">
            <span className="material-symbols-outlined text-4xl text-blue-400">inventory_2</span>
          </div>
          <h3 className="text-xl font-bold text-slate-400 dark:text-slate-500 mb-2">暂无技能</h3>
          <p className="text-sm text-slate-400/80 dark:text-slate-500/80 mb-6">拖拽 .zip 压缩包到此处，或点击上方按钮上传</p>
          <div className="p-4 bg-white dark:bg-surface-dark rounded-2xl border border-slate-200 dark:border-white/5 max-w-md">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">压缩包结构 (Claude Skills 规范)</p>
            <pre className="text-[11px] text-slate-500 font-mono leading-relaxed">{'my-skill.zip\n├── SKILL.md       (必需)\n├── scripts/       (可选: 脚本)\n└── resources/     (可选: 模板/数据)'}</pre>
            <div className="mt-3 p-3 bg-slate-50 dark:bg-black/20 rounded-xl">
              <p className="text-[10px] font-bold text-slate-400 mb-1">SKILL.md 示例:</p>
              <pre className="text-[10px] text-slate-500 font-mono leading-relaxed whitespace-pre-wrap">{'---\nname: my-skill\ndescription: 技能描述，说明何时使用\n---\n# My Skill\n\n## Instructions\n具体指令内容...'}</pre>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleUploadSkill(file);
          }}
          className={`transition-all rounded-3xl ${isDragging ? 'ring-2 ring-blue-400 ring-offset-4 dark:ring-offset-slate-900' : ''}`}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {skills.map(skill => (
              <div key={skill.id} onClick={() => handlePreviewSkill(skill)} className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-6 shadow-sm hover:shadow-md transition-all group cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/20 text-blue-600 flex items-center justify-center">
                      <span className="material-symbols-outlined text-2xl">bolt</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white">{skill.name}</h4>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1">{skill.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteSkill(skill.id); }}
                    className="w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all opacity-0 group-hover:opacity-100"
                  >
                    <span className="material-symbols-outlined text-lg">delete</span>
                  </button>
                </div>
                {skill.instructions && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 line-clamp-3 font-mono bg-slate-50 dark:bg-white/[0.02] p-2 rounded-lg whitespace-pre-wrap">{skill.instructions.slice(0, 200)}{skill.instructions.length > 200 ? '...' : ''}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {(skill.files || []).length > 0 && (
                    <span className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-500 rounded text-[9px] font-bold">
                      {skill.files.length} 个附件
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skill Preview Modal */}
      <AnimatePresence>
        {previewSkill && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-4xl h-[85vh] overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="flex justify-between items-center p-6 pb-4 border-b border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/20 text-blue-600 flex items-center justify-center">
                    <span className="material-symbols-outlined text-2xl">bolt</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold dark:text-white">{previewSkill.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{previewSkill.description}</p>
                  </div>
                </div>
                <button onClick={() => setPreviewSkill(null)} className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {/* Body: File Tree + Content */}
              <div className="flex flex-1 overflow-hidden min-h-0">
                {/* File Tree Sidebar */}
                <div className="w-64 border-r border-slate-100 dark:border-white/5 overflow-y-auto p-4 flex-shrink-0">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1">文件结构</p>
                  {skillFileTree.length === 0 ? (
                    <p className="text-xs text-slate-400 ml-1">加载中...</p>
                  ) : (
                    <FileTreeNode items={skillFileTree} skillId={previewSkill.id} selectedPath={selectedFilePath} onSelect={handleSelectFile} />
                  )}
                </div>

                {/* File Content */}
                <div className="flex-1 flex flex-col overflow-hidden p-6 min-w-0">
                  {!selectedFilePath ? (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12">
                      <span className="material-symbols-outlined text-5xl text-slate-200 dark:text-white/10 mb-4">description</span>
                      <p className="text-sm text-slate-400 dark:text-slate-500">点击左侧文件查看并编辑内容</p>
                    </div>
                  ) : isLoadingFile ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm text-slate-400">description</span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{selectedFilePath}</span>
                        </div>
                        <button
                          onClick={handleSaveFile}
                          disabled={isSaving}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-sm">save</span>
                          {isSaving ? '保存中...' : '保存修改'}
                        </button>
                      </div>
                      <textarea
                        value={selectedFileContent || ''}
                        onChange={e => setSelectedFileContent(e.target.value)}
                        className="flex-1 w-full text-[12px] text-slate-700 dark:text-slate-300 font-mono whitespace-pre bg-slate-50 dark:bg-black/20 p-4 rounded-2xl border border-slate-200 dark:border-white/5 leading-relaxed outline-none focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                        spellCheck={false}
                      />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  const handleSaveMCP = async (config: MCPServerConfig) => {
    try {
      setIsSaving(true);
      await agentService.saveMCPConfig(config);
      await loadData();
      setEditingMCP(null);
      toastSuccess('MCP 配置保存成功');
    } catch (error) {
      toastError('保存 MCP 配置失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteMCP = async (id: string) => {
    if (!confirm('确定删除该 MCP 配置吗？')) return;
    try {
      await agentService.deleteMCPConfig(id);
      await loadData();
      toastSuccess('MCP 配置已删除');
    } catch (error) {
      toastError('删除失败');
    }
  };

  const createEmptyMCP = (): MCPServerConfig => ({
    id: `mcp_${Date.now().toString(36)}`,
    name: '',
    description: '',
    transportType: 'stdio',
    command: '',
    args: [],
    url: '',
    headers: {},
    env: {},
    enabled: true
  });

  const renderTools = () => (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/10 p-6 rounded-3xl">
        <div className="flex items-center gap-3 mb-2 text-blue-600 dark:text-blue-400">
          <span className="material-symbols-outlined">info</span>
          <h4 className="font-bold">关于工具箱</h4>
        </div>
        <p className="text-sm text-blue-600/80 dark:text-blue-400/80 leading-relaxed">
          工具是 Agent 与外部系统交互的能力集合。目前支持抓取、发布和 RAG 检索。系统内置工具不可修改，可通过 MCP 协议扩展自定义工具。
        </p>
      </div>

      {/* Built-in Tools */}
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">内置工具</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {tools.map(tool => (
            <div key={tool.id} className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-6 shadow-sm">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 text-slate-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">construction</span>
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white">{tool.name}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">ID: {tool.id}</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-4">{tool.description}</p>
              <div className="p-3 bg-slate-50 dark:bg-black/20 rounded-xl">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">参数定义 (JSON Schema)</span>
                <pre className="text-[10px] text-slate-500 font-mono whitespace-pre-wrap">{JSON.stringify(tool.parameters, null, 2)}</pre>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MCP Servers Section */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white">MCP 服务配置</h3>
          <button
            onClick={() => setEditingMCP(createEmptyMCP())}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-all text-sm font-bold shadow-lg shadow-violet-500/20"
          >
            <span className="material-symbols-outlined">add</span>
            新增 MCP
          </button>
        </div>

        {mcpConfigs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 bg-slate-50 dark:bg-white/[0.02] rounded-3xl border border-dashed border-slate-200 dark:border-white/5">
            <div className="w-16 h-16 rounded-full bg-violet-100 dark:bg-violet-500/10 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-3xl text-violet-400">hub</span>
            </div>
            <h4 className="text-base font-bold text-slate-400 dark:text-slate-500 mb-1">暂无 MCP 配置</h4>
            <p className="text-xs text-slate-400/80 dark:text-slate-500/80">点击「新增 MCP」添加自定义 Model Context Protocol 服务端</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {mcpConfigs.map(mcp => (
              <div key={mcp.id} className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-6 shadow-sm hover:shadow-md transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${mcp.enabled ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-600' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                      <span className="material-symbols-outlined text-2xl">hub</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-900 dark:text-white">{mcp.name || '未命名'}</h4>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${mcp.enabled ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                          {mcp.enabled ? '已启用' : '已禁用'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{mcp.description || '无描述'}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditingMCP(mcp)}
                      className="w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-500/10 rounded-full transition-all"
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </button>
                    <button
                      onClick={() => handleDeleteMCP(mcp.id)}
                      className="w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                    >
                      <span className="material-symbols-outlined text-lg">delete</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 rounded-lg text-[10px] font-bold uppercase">{mcp.transportType}</span>
                    {mcp.transportType === 'stdio' && mcp.command && (
                      <span className="text-[10px] text-slate-400 font-mono truncate">{mcp.command} {(mcp.args || []).join(' ')}</span>
                    )}
                    {(mcp.transportType === 'sse' || mcp.transportType === 'streamable-http') && mcp.url && (
                      <span className="text-[10px] text-slate-400 font-mono truncate">{mcp.url}</span>
                    )}
                  </div>
                  {mcp.env && Object.keys(mcp.env).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {Object.keys(mcp.env).map(key => (
                        <span key={key} className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/5 text-slate-400 rounded text-[9px] font-mono">{key}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MCP Editing Modal */}
      <AnimatePresence>
        {editingMCP && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8"
            >
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-500/20 text-violet-600 flex items-center justify-center">
                    <span className="material-symbols-outlined text-2xl">hub</span>
                  </div>
                  <h3 className="text-xl font-bold dark:text-white">配置 MCP 服务</h3>
                </div>
                <button onClick={() => setEditingMCP(null)} className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-6">
                {/* Name & ID */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">名称</label>
                    <input
                      type="text"
                      value={editingMCP.name}
                      onChange={e => setEditingMCP({ ...editingMCP, name: e.target.value })}
                      placeholder="例如: filesystem-server"
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500/20 transition-all dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">ID</label>
                    <input
                      type="text"
                      value={editingMCP.id}
                      disabled
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm opacity-50 dark:text-slate-400"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">描述</label>
                  <input
                    type="text"
                    value={editingMCP.description}
                    onChange={e => setEditingMCP({ ...editingMCP, description: e.target.value })}
                    placeholder="简短描述此 MCP 服务的功能..."
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500/20 transition-all dark:text-white"
                  />
                </div>

                {/* Transport Type */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">传输方式 (Transport)</label>
                  <div className="flex gap-2">
                    {(['stdio', 'sse', 'streamable-http'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setEditingMCP({ ...editingMCP, transportType: t })}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                          editingMCP.transportType === t
                            ? 'bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-500/20'
                            : 'bg-white dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10 hover:border-violet-300'
                        }`}
                      >
                        {t.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* stdio fields */}
                {editingMCP.transportType === 'stdio' && (
                  <div className="space-y-4 p-4 bg-slate-50 dark:bg-white/[0.02] rounded-2xl border border-slate-200 dark:border-white/5">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">启动命令 (Command)</label>
                      <input
                        type="text"
                        value={editingMCP.command || ''}
                        onChange={e => setEditingMCP({ ...editingMCP, command: e.target.value })}
                        placeholder="例如: npx, node, python"
                        className="w-full px-4 py-2.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500/20 transition-all dark:text-white"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">参数 (Args, 每行一个)</label>
                      <textarea
                        rows={3}
                        value={(editingMCP.args || []).join('\n')}
                        onChange={e => setEditingMCP({ ...editingMCP, args: e.target.value.split('\n').filter(Boolean) })}
                        placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
                        className="w-full px-4 py-2.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500/20 transition-all dark:text-white resize-none"
                      />
                    </div>
                  </div>
                )}

                {/* sse / streamable-http fields */}
                {(editingMCP.transportType === 'sse' || editingMCP.transportType === 'streamable-http') && (
                  <div className="space-y-4 p-4 bg-slate-50 dark:bg-white/[0.02] rounded-2xl border border-slate-200 dark:border-white/5">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">服务地址 (URL)</label>
                      <input
                        type="text"
                        value={editingMCP.url || ''}
                        onChange={e => setEditingMCP({ ...editingMCP, url: e.target.value })}
                        placeholder="例如: http://localhost:3001/sse"
                        className="w-full px-4 py-2.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500/20 transition-all dark:text-white"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">请求头 (Headers, JSON 格式)</label>
                      <textarea
                        rows={2}
                        value={JSON.stringify(editingMCP.headers || {}, null, 2)}
                        onChange={e => {
                          try {
                            setEditingMCP({ ...editingMCP, headers: JSON.parse(e.target.value) });
                          } catch { /* ignore parse errors while typing */ }
                        }}
                        placeholder={'{\n  "Authorization": "Bearer xxx"\n}'}
                        className="w-full px-4 py-2.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500/20 transition-all dark:text-white resize-none"
                      />
                    </div>
                  </div>
                )}

                {/* Environment Variables */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">环境变量 (JSON 格式)</label>
                  <textarea
                    rows={3}
                    value={JSON.stringify(editingMCP.env || {}, null, 2)}
                    onChange={e => {
                      try {
                        setEditingMCP({ ...editingMCP, env: JSON.parse(e.target.value) });
                      } catch { /* ignore parse errors while typing */ }
                    }}
                    placeholder={'{\n  "API_KEY": "your-key"\n}'}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500/20 transition-all dark:text-white resize-none"
                  />
                </div>

                {/* Enabled toggle */}
                <div className="p-4 bg-slate-50 dark:bg-white/[0.02] rounded-2xl border border-slate-200 dark:border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-violet-500">power_settings_new</span>
                      <span className="text-xs font-bold dark:text-white">启用此 MCP 服务</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={editingMCP.enabled}
                        onChange={e => setEditingMCP({ ...editingMCP, enabled: e.target.checked })}
                      />
                      <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:bg-violet-500 transition-all after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => handleSaveMCP(editingMCP)}
                    disabled={isSaving || !editingMCP.name.trim()}
                    className="flex-1 py-3 bg-violet-600 text-white rounded-2xl font-bold hover:bg-violet-700 transition-all shadow-lg shadow-violet-500/20 disabled:opacity-50"
                  >
                    {isSaving ? '保存中...' : '确认保存'}
                  </button>
                  <button
                    onClick={() => setEditingMCP(null)}
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

  const createEmptyWorkflow = (): Workflow => ({
    id: `wf_${Date.now().toString(36)}`,
    name: '',
    description: '',
    steps: [{ id: 'step_1', agentId: '', inputMap: {}, nextStepIds: [], condition: '' }],
    initialStepId: 'step_1',
  });

  // Normalize step: ensure nextStepIds is always present
  const getNextStepIds = (step: WorkflowStep): string[] => {
    if (step.nextStepIds && step.nextStepIds.length > 0) return step.nextStepIds;
    if (step.nextStepId) return [step.nextStepId];
    return [];
  };

  const handleSaveWorkflow = async (workflow: Workflow) => {
    try {
      setIsSaving(true);
      await agentService.saveWorkflow(workflow);
      await loadData();
      setEditingWorkflow(null);
      toastSuccess('工作流保存成功');
    } catch (error) {
      toastError('保存工作流失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    if (!confirm('确定删除该工作流吗？')) return;
    try {
      await agentService.deleteWorkflow(id);
      await loadData();
      toastSuccess('工作流已删除');
    } catch (error) {
      toastError('删除失败');
    }
  };

  const handleRunWorkflow = async (id: string, input: string) => {
    try {
      // 在测试前清除上一次的测试结果
      setWorkflowTestResult(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      setWorkflowTestResult(prev => ({ ...prev, [id]: '运行中...' }));
      const result = await agentService.runWorkflow(id, input);
      setWorkflowTestResult(prev => ({ ...prev, [id]: result?.content || (typeof result === 'string' ? result : JSON.stringify(result, null, 2)) }));
    } catch (error: any) {
      setWorkflowTestResult(prev => ({ ...prev, [id]: `错误: ${error.message}` }));
    }
  };

  const addWorkflowStep = () => {
    if (!editingWorkflow) return;
    const existingIds = editingWorkflow.steps.map(s => s.id);
    let idx = editingWorkflow.steps.length + 1;
    while (existingIds.includes(`step_${idx}`)) idx++;
    const newStep: WorkflowStep = { id: `step_${idx}`, agentId: '', inputMap: {}, nextStepIds: [], condition: '' };
    // inputMap kept empty — engine auto-derives input from DAG predecessors
    setEditingWorkflow({ ...editingWorkflow, steps: [...editingWorkflow.steps, newStep] });
  };

  const updateWorkflowStep = (stepIdx: number, patch: Partial<WorkflowStep>) => {
    if (!editingWorkflow) return;
    const steps = editingWorkflow.steps.map((s, i) => i === stepIdx ? { ...s, ...patch } : s);
    setEditingWorkflow({ ...editingWorkflow, steps });
  };

  const removeWorkflowStep = (stepIdx: number) => {
    if (!editingWorkflow || editingWorkflow.steps.length <= 1) return;
    const removedId = editingWorkflow.steps[stepIdx].id;
    const removedNextIds = getNextStepIds(editingWorkflow.steps[stepIdx]);
    const steps = editingWorkflow.steps.filter((_, i) => i !== stepIdx);
    // Fix links: any step referencing removed step in nextStepIds gets it replaced with removed step's successors
    const fixedSteps = steps.map(s => {
      const nexts = getNextStepIds(s);
      if (nexts.includes(removedId)) {
        const updated = [...nexts.filter(id => id !== removedId), ...removedNextIds].filter((v, i, a) => a.indexOf(v) === i);
        return { ...s, nextStepIds: updated, nextStepId: undefined };
      }
      return s;
    });
    const newInitial = editingWorkflow.initialStepId === removedId ? fixedSteps[0]?.id : editingWorkflow.initialStepId;
    setEditingWorkflow({ ...editingWorkflow, steps: fixedSteps, initialStepId: newInitial });
  };

  const getStepLabel = (step: WorkflowStep) => {
    if (step.agentId) {
      const agent = agents.find(a => a.id === step.agentId);
      return agent ? agent.name : step.agentId;
    }
    return '未配置';
  };

  // Build topological layers for DAG visualization
  const buildTopologicalLayers = (steps: WorkflowStep[], initialStepId: string): WorkflowStep[][] => {
    if (steps.length === 0) return [];
    const stepMap = new Map(steps.map(s => [s.id, s]));
    const stepIds = new Set(steps.map(s => s.id));

    // Build in-degree from nextStepIds edges
    const inDegree = new Map<string, number>();
    const successors = new Map<string, Set<string>>();
    for (const s of steps) {
      inDegree.set(s.id, 0);
      successors.set(s.id, new Set());
    }

    for (const s of steps) {
      const nexts = getNextStepIds(s);
      for (const nid of nexts) {
        if (stepIds.has(nid)) {
          successors.get(s.id)!.add(nid);
          inDegree.set(nid, (inDegree.get(nid) || 0) + 1);
        }
      }
    }

    // BFS topological sort by layers
    const layers: WorkflowStep[][] = [];
    let queue = steps.filter(s => (inDegree.get(s.id) || 0) === 0);
    const visited = new Set<string>();

    // If no zero-indegree nodes, start with initialStepId
    if (queue.length === 0 && stepMap.has(initialStepId)) {
      queue = [stepMap.get(initialStepId)!];
    }

    while (queue.length > 0) {
      layers.push(queue);
      const nextQueue: WorkflowStep[] = [];
      for (const s of queue) {
        visited.add(s.id);
        for (const nid of successors.get(s.id) || []) {
          const newDeg = (inDegree.get(nid) || 1) - 1;
          inDegree.set(nid, newDeg);
          if (newDeg === 0 && !visited.has(nid)) {
            nextQueue.push(stepMap.get(nid)!);
          }
        }
      }
      queue = nextQueue;
    }

    // Add any remaining unvisited steps as final layer
    const remaining = steps.filter(s => !visited.has(s.id));
    if (remaining.length > 0) layers.push(remaining);

    return layers;
  };

  const buildWorkflowGraphLayout = (steps: WorkflowStep[], initialStepId: string, compact = false) => {
    const layers = buildTopologicalLayers(steps, initialStepId);
    const layerGap = compact ? 146 : 190;
    const nodeGap = compact ? 46 : 64;
    const paddingX = compact ? 8 : 16;
    const paddingY = compact ? 8 : 14;

    const roughPositions = new Map<string, { x: number; y: number; layerIndex: number }>();
    let maxRows = 1;

    layers.forEach((layer, li) => {
      maxRows = Math.max(maxRows, layer.length);
      const startY = ((maxRows - layer.length) * nodeGap) / 2 + paddingY;
      layer.forEach((step, idx) => {
        roughPositions.set(step.id, {
          x: paddingX + li * layerGap,
          y: startY + idx * nodeGap,
          layerIndex: li,
        });
      });
    });

    const edges: Array<{ from: string; to: string }> = [];
    const idSet = new Set(steps.map(s => s.id));
    steps.forEach(step => {
      getNextStepIds(step).forEach(nextId => {
        if (idSet.has(nextId)) {
          edges.push({ from: step.id, to: nextId });
        }
      });
    });

    // 为抬升曲线预留顶部空间，避免被裁切，同时让预览区域高度自适应
    let maxCurveLift = 0;
    edges.forEach(edge => {
      const from = roughPositions.get(edge.from);
      const to = roughPositions.get(edge.to);
      if (!from || !to) return;
      const layerSpan = Math.max(1, to.layerIndex - from.layerIndex);
      if (layerSpan > 1) {
        const lift = 24 + (layerSpan - 1) * 14;
        maxCurveLift = Math.max(maxCurveLift, lift);
      }
    });

    const topCurvePadding = Math.max(8, maxCurveLift + 8);
    const positions = new Map<string, { x: number; y: number; layerIndex: number }>();
    roughPositions.forEach((pos, id) => {
      positions.set(id, { ...pos, y: pos.y + topCurvePadding });
    });

    const minWidth = compact ? 176 : 220;
    const tailWidth = compact ? 132 : 170;
    const minHeight = compact ? 76 : 96;
    const bottomPadding = compact ? 24 : 36;

    return {
      positions,
      edges,
      width: Math.max(minWidth, paddingX * 2 + Math.max(0, layers.length - 1) * layerGap + tailWidth),
      height: Math.max(minHeight, paddingY * 2 + Math.max(1, maxRows - 1) * nodeGap + bottomPadding + topCurvePadding),
    };
  };

  const renderWorkflowGraphPreview = (steps: WorkflowStep[], initialStepId: string, compact = false) => {
    const layout = buildWorkflowGraphLayout(steps, initialStepId, compact);
    const nodeWidth = compact ? 98 : 132;
    const nodeHeight = compact ? 24 : 34;

    return (
      <div className="w-full overflow-hidden">
        <div className="w-full flex justify-center">
          <div className="relative" style={{ width: `${layout.width}px`, height: `${layout.height}px` }}>
            <svg className="absolute inset-0 pointer-events-none" width={layout.width} height={layout.height}>
            {layout.edges.map((edge, idx) => {
              const from = layout.positions.get(edge.from);
              const to = layout.positions.get(edge.to);
              if (!from || !to) return null;

              const x1 = from.x + nodeWidth;
              const y1 = from.y + nodeHeight / 2;
              const x2 = to.x;
              const y2 = to.y + nodeHeight / 2;
              const c1x = x1 + Math.max(20, (x2 - x1) / 2);
              const c2x = x2 - Math.max(20, (x2 - x1) / 2);
              const layerSpan = Math.max(1, to.layerIndex - from.layerIndex);
              const curveOffset = layerSpan > 1 ? -(24 + (layerSpan - 1) * 14) : 0;
              const c1y = y1 + curveOffset;
              const c2y = y2 + curveOffset;

              return (
                <path
                  key={`edge_${edge.from}_${edge.to}_${idx}`}
                  d={`M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`}
                  fill="none"
                  stroke={
                    layerSpan > 1
                      ? (compact ? 'rgba(245, 158, 11, 0.88)' : 'rgba(245, 158, 11, 0.75)')
                      : (compact ? 'rgba(148, 163, 184, 0.58)' : 'rgba(148, 163, 184, 0.72)')
                  }
                  strokeWidth={layerSpan > 1 ? (compact ? 2 : 1.8) : (compact ? 1.35 : 1.5)}
                  strokeDasharray={compact && layerSpan > 1 ? '0' : undefined}
                />
              );
            })}
          </svg>

            {steps.map(step => {
              const pos = layout.positions.get(step.id);
              if (!pos) return null;
              return (
                <div
                  key={`node_${step.id}`}
                  className={`absolute inline-flex items-center gap-1.5 border font-bold ${
                    compact
                      ? 'px-2 py-0.5 text-[9px] rounded-lg backdrop-blur-sm'
                      : 'px-3 py-1.5 text-[10px] rounded-xl'
                  } ${
                    step.agentId
                      ? 'bg-white/95 dark:bg-surface-dark text-slate-800 dark:text-slate-200 border-slate-200/90 dark:border-white/10 shadow-sm'
                      : 'bg-slate-50/95 dark:bg-white/[0.03] text-slate-400 border-slate-200 dark:border-white/10'
                  } ${
                    step.id === initialStepId
                      ? 'ring-1 ring-emerald-300 dark:ring-emerald-500/40'
                      : ''
                  }`}
                  style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${nodeWidth}px`, minHeight: `${nodeHeight}px` }}
                  title={step.id}
                >
                  <span className="material-symbols-outlined text-[12px] text-primary">{step.agentId ? 'smart_toy' : 'help'}</span>
                  <span className="truncate">{getStepLabel(step)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderWorkflows = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">工作流列表</h3>
        <button
          onClick={() => setEditingWorkflow(createEmptyWorkflow())}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all text-sm font-bold shadow-lg shadow-emerald-500/20"
        >
          <span className="material-symbols-outlined">add</span>
          创建工作流
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-50 dark:bg-white/[0.02] rounded-[40px] border border-dashed border-slate-200 dark:border-white/5">
          <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mb-6">
            <span className="material-symbols-outlined text-4xl text-emerald-400">account_tree</span>
          </div>
          <h3 className="text-xl font-bold text-slate-400 dark:text-slate-500 mb-2">暂无工作流</h3>
          <p className="text-sm text-slate-400/80 dark:text-slate-500/80">点击「创建工作流」编排多个 Agent / 工具的自动化任务流</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {workflows.map(wf => (
            <div key={wf.id} className="bg-white dark:bg-surface-dark rounded-3xl border border-slate-200 dark:border-white/5 p-6 shadow-sm hover:shadow-md transition-all group">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 flex items-center justify-center">
                    <span className="material-symbols-outlined text-3xl">account_tree</span>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white">{wf.name || '未命名工作流'}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{wf.description || '无描述'}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setTestingWorkflowId(wf.id); setWorkflowTestInput(''); }}
                    className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 rounded-full transition-all"
                    title="运行"
                  >
                    <span className="material-symbols-outlined text-xl">play_arrow</span>
                  </button>
                  <button
                    onClick={() => setEditingWorkflow(wf)}
                    className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-full transition-all"
                  >
                    <span className="material-symbols-outlined text-xl">edit</span>
                  </button>
                  <button
                    onClick={() => handleDeleteWorkflow(wf.id)}
                    className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                  >
                    <span className="material-symbols-outlined text-xl">delete</span>
                  </button>
                </div>
              </div>

              {/* Step DAG preview */}
              <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-gradient-to-b from-slate-50/90 to-slate-100/60 dark:from-white/[0.03] dark:to-white/[0.01] p-2 flex justify-center shadow-inner">
                <div className="w-full">
                  {renderWorkflowGraphPreview(wf.steps || [], wf.initialStepId, true)}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg text-[10px] font-bold">
                  {wf.steps?.length || 0} 个步骤
                </span>
                <span className="text-[10px] text-slate-400 font-mono">ID: {wf.id}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Workflow Editing Modal */}
      <AnimatePresence>
        {editingWorkflow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-8"
            >
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 flex items-center justify-center">
                    <span className="material-symbols-outlined text-2xl">account_tree</span>
                  </div>
                  <h3 className="text-xl font-bold dark:text-white">编排工作流</h3>
                </div>
                <button onClick={() => setEditingWorkflow(null)} className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">名称</label>
                    <input
                      type="text"
                      value={editingWorkflow.name}
                      onChange={e => setEditingWorkflow({ ...editingWorkflow, name: e.target.value })}
                      placeholder="例如: 每日资讯摘要"
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">ID</label>
                    <input type="text" value={editingWorkflow.id} disabled className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm opacity-50 dark:text-slate-400" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">描述</label>
                  <input
                    type="text"
                    value={editingWorkflow.description}
                    onChange={e => setEditingWorkflow({ ...editingWorkflow, description: e.target.value })}
                    placeholder="简短描述此工作流的用途..."
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all dark:text-white"
                  />
                </div>

                {/* Steps Editor */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">步骤编排</label>
                    <button
                      onClick={addWorkflowStep}
                      className="flex items-center gap-1 px-3 py-1.5 text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg text-[11px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-all"
                    >
                      <span className="material-symbols-outlined text-sm">add</span>
                      添加步骤
                    </button>
                  </div>

                  {/* DAG Mini Preview */}
                  <div className="p-3 bg-slate-50 dark:bg-white/[0.02] rounded-2xl border border-slate-200 dark:border-white/5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="material-symbols-outlined text-xs text-emerald-500">account_tree</span>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">执行流程预览</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 normal-case">
                          <span className="material-symbols-outlined text-[10px]">play_arrow</span>start
                        </span>
                        <span className="text-slate-300 dark:text-white/20">→</span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 dark:bg-white/10 text-slate-500 normal-case">
                          <span className="material-symbols-outlined text-[10px]">stop</span>end
                        </span>
                      </div>
                      {renderWorkflowGraphPreview(editingWorkflow.steps, editingWorkflow.initialStepId)}
                    </div>
                  </div>

                  {/* Step Cards */}
                  <div className="space-y-3">
                    {editingWorkflow.steps.map((step, idx) => {
                      const currentNextIds = getNextStepIds(step);
                      const isParallel = currentNextIds.length > 1;
                      return (
                        <div key={step.id} className={`p-4 rounded-2xl border space-y-3 ${
                          step.id === editingWorkflow.initialStepId
                            ? 'bg-emerald-50/50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20'
                            : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/5'
                        }`}>
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-400 flex items-center justify-center text-[10px] font-bold">{idx + 1}</span>
                              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{step.id}</span>
                              {step.id === editingWorkflow.initialStepId && (
                                <span className="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded text-[8px] font-bold">入口</span>
                              )}
                              {isParallel && (
                                <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded text-[8px] font-bold flex items-center gap-0.5">
                                  <span className="material-symbols-outlined text-[10px]">call_split</span>并行分叉
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {step.id !== editingWorkflow.initialStepId && (
                                <button
                                  onClick={() => setEditingWorkflow({ ...editingWorkflow, initialStepId: step.id })}
                                  className="w-7 h-7 inline-flex items-center justify-center text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-full transition-all"
                                  title="设为入口步骤"
                                >
                                  <span className="material-symbols-outlined text-sm">flag</span>
                                </button>
                              )}
                              {editingWorkflow.steps.length > 1 && (
                                <button
                                  onClick={() => removeWorkflowStep(idx)}
                                  className="w-7 h-7 inline-flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                                >
                                  <span className="material-symbols-outlined text-sm">close</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Execution type: Agent */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">执行 Agent</label>
                            <div className="relative">
                              <select
                                value={step.agentId || ''}
                                onChange={e => updateWorkflowStep(idx, { agentId: e.target.value })}
                                className="w-full appearance-none px-3 py-2 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer dark:text-white"
                              >
                                <option value="">选择 Agent</option>
                                {agents.map(a => (
                                  <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                              </select>
                              <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-sm">expand_more</span>
                            </div>
                          </div>

                          {/* Next Steps (multi-select for parallel branching) */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                              后续步骤
                              <span className="text-slate-300 dark:text-white/20 ml-1 normal-case">（可多选，多选 = 并行执行）</span>
                            </label>
                            <div className="flex flex-wrap gap-1.5 p-2 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-lg min-h-[36px]">
                              {editingWorkflow.steps.filter(s => s.id !== step.id).map(s => {
                                const isSelected = currentNextIds.includes(s.id);
                                return (
                                  <button
                                    key={s.id}
                                    onClick={() => {
                                      const updated = isSelected
                                        ? currentNextIds.filter(id => id !== s.id)
                                        : [...currentNextIds, s.id];
                                      updateWorkflowStep(idx, { nextStepIds: updated, nextStepId: undefined });
                                    }}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                                      isSelected
                                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-300 dark:ring-emerald-500/40'
                                        : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
                                    }`}
                                  >
                                    <span className="material-symbols-outlined text-[12px]">
                                      {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                                    </span>
                                    {s.id}
                                  </button>
                                );
                              })}
                              {editingWorkflow.steps.length <= 1 && (
                                <span className="text-[10px] text-slate-400 py-1">添加更多步骤后可选择后续节点</span>
                              )}
                            </div>
                            {currentNextIds.length === 0 && editingWorkflow.steps.length > 1 && (
                              <p className="text-[9px] text-slate-400 ml-1 flex items-center gap-1">
                                <span className="material-symbols-outlined text-[10px]">info</span>
                                未选择后续 = 终止节点（输出为最终结果）
                              </p>
                            )}
                            {currentNextIds.length > 1 && (
                              <p className="text-[9px] text-amber-500 ml-1 flex items-center gap-1">
                                <span className="material-symbols-outlined text-[10px]">call_split</span>
                                已选 {currentNextIds.length} 个后续步骤，将并行执行
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => handleSaveWorkflow(editingWorkflow)}
                    disabled={isSaving || !editingWorkflow.name.trim()}
                    className="flex-1 py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                  >
                    {isSaving ? '保存中...' : '确认保存'}
                  </button>
                  <button
                    onClick={() => setEditingWorkflow(null)}
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

      {/* Workflow Test Modal */}
      <AnimatePresence>
        {testingWorkflowId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-surface-dark rounded-[32px] shadow-2xl w-full max-w-lg p-8"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 flex items-center justify-center">
                    <span className="material-symbols-outlined text-2xl">play_arrow</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold dark:text-white">运行工作流</h3>
                    <p className="text-xs text-slate-400">{workflows.find(w => w.id === testingWorkflowId)?.name}</p>
                  </div>
                </div>
                <button onClick={() => setTestingWorkflowId(null)} className="w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-all">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-4">
                <textarea
                  rows={3}
                  value={workflowTestInput}
                  onChange={e => setWorkflowTestInput(e.target.value)}
                  placeholder="输入初始数据（文本或 JSON）..."
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all dark:text-white resize-none"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleRunWorkflow(testingWorkflowId, workflowTestInput);
                    }
                  }}
                />
                <button
                  onClick={() => handleRunWorkflow(testingWorkflowId, workflowTestInput)}
                  disabled={!workflowTestInput.trim() || workflowTestResult[testingWorkflowId] === '运行中...'}
                  className="w-full py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-xl">
                    {workflowTestResult[testingWorkflowId] === '运行中...' ? 'hourglass_top' : 'send'}
                  </span>
                  {workflowTestResult[testingWorkflowId] === '运行中...' ? '运行中...' : '执行工作流'}
                </button>

                {workflowTestResult[testingWorkflowId] && (
                  <div className="p-4 bg-slate-50 dark:bg-black/20 rounded-xl text-xs text-slate-600 dark:text-slate-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border border-slate-200 dark:border-white/5">
                    {workflowTestResult[testingWorkflowId]}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight mb-2">
            Multi-Agent <span className="text-primary font-medium text-lg ml-2 px-3 py-1 bg-primary/10 rounded-full">Orchestration</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium">定义智能体、管理技能库并编排自动化工作流</p>
        </div>
      </header>

      {/* Tabs Navigation */}
      <nav className="flex items-center p-1.5 bg-white dark:bg-surface-dark rounded-[24px] border border-slate-200 dark:border-white/5 shadow-sm overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-2.5 px-6 py-3 rounded-[20px] transition-all duration-300 whitespace-nowrap
              ${activeTab === tab.id 
                ? 'bg-primary text-white shadow-lg shadow-primary/20 font-bold' 
                : 'text-slate-500 dark:text-slate-400 hover:text-primary dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 font-medium'}
            `}
          >
            <span className={`material-symbols-outlined text-xl ${activeTab === tab.id ? 'animate-pulse-slow' : ''}`}>
              {tab.icon}
            </span>
            <span className="text-sm">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Content Area */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
            </div>
          ) : (
            <>
              {activeTab === 'agents' && renderAgents()}
              {activeTab === 'skills' && renderSkills()}
              {activeTab === 'tools' && renderTools()}
              {activeTab === 'workflows' && renderWorkflows()}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default Agents;
