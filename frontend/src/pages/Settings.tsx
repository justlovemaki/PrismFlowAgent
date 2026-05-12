import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSettings, saveSettings, getModels, getPluginMetadata, testProvider, importOPML, getApiKeys, deleteApiKey, createApiKey, updateApiKey } from '../services/settingsService';
import { agentService } from '../services/agentService';
import IconPicker from '../components/UI/IconPicker';
import { useToast } from '../context/ToastContext.js';

const Settings: React.FC = () => {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const [activeTab, setActiveTab] = useState('ai');
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [pluginMetadata, setPluginMetadata] = useState<{ adapters: any[], publishers: any[], storages: any[], aiProviders: any[] }>({ adapters: [], publishers: [], storages: [], aiProviders: [] });
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [deletedApiKeyIds, setDeletedApiKeyIds] = useState<Set<string>>(new Set());
  const [updatedApiKeyIds, setUpdatedApiKeyIds] = useState<Set<string>>(new Set());
  const [agents, setAgents] = useState<any[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [isFetchingModels, setIsFetchingModels] = useState<Record<string, boolean>>({});
  const [isTestingProvider, setIsTestingProvider] = useState<Record<string, boolean>>({});
  const [isImportingOPML, setIsImportingOPML] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{ name: string; key: string } | null>(null);


  const [iconPickerState, setIconPickerState] = useState<{ isOpen: boolean; catId: string | null; currentIcon: string }>({
    isOpen: false,
    catId: null,
    currentIcon: ''
  });


  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const [data, metadata, agentsData, workflowsData, apiKeysData] = await Promise.all([
        getSettings(),
        getPluginMetadata(),
        agentService.getAgents(),
        agentService.getWorkflows(),
        getApiKeys()
      ]);
      
      const closedPlugins = data?.CLOSED_PLUGINS || [];
      
      const filteredMetadata = {
        adapters: (metadata.adapters || []).filter((a: any) => !closedPlugins.includes(a.type)),
        publishers: (metadata.publishers || []).filter((p: any) => !closedPlugins.includes(p.id)),
        storages: (metadata.storages || []).filter((s: any) => !closedPlugins.includes(s.id)),
        aiProviders: (data?.AI_PROVIDERS || []).filter((p: any) => !closedPlugins.includes(p.id))
      };

      setPluginMetadata(filteredMetadata);
      setSettings(data || {});
      setAgents(agentsData || []);
      setWorkflows(workflowsData || []);
      setApiKeys(apiKeysData || []);
      setDeletedApiKeyIds(new Set());
      setUpdatedApiKeyIds(new Set());


    } catch (error) {
      console.error('Failed to load settings:', error);
      toastError('加载配置失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };


  const handleSave = async () => {
    try {
      setIsSaving(true);
      
      // 1. 保存全局设置
      await saveSettings(settings);

      // 2. 处理被删除的 API Key
      if (deletedApiKeyIds.size > 0) {
        await Promise.all(Array.from(deletedApiKeyIds).map(id => deleteApiKey(id)));
      }

      // 3. 处理更新的 API Key (名称或状态)
      if (updatedApiKeyIds.size > 0) {
        await Promise.all(Array.from(updatedApiKeyIds).map(id => {
          const key = apiKeys.find(k => k.id === id);
          if (key) {
            return updateApiKey(id, { name: key.name, status: key.status });
          }
          return Promise.resolve();
        }));
      }

      toastSuccess('配置保存成功！');
      await loadSettings(); // 重新加载以清理暂存状态并同步后端
    } catch (error) {
      console.error('Failed to save settings:', error);
      toastError('保存配置失败，请检查网络或控制台。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportOPML = (adapterId?: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsImportingOPML(true);
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string;
          const result = await importOPML(content, adapterId);
          toastSuccess(`导入成功！共发现 ${result.count} 个订阅源，新增 ${result.added} 个。`);
          loadSettings(); // 重新加载以显示新导入的项
        } catch (error: any) {
          toastError('导入失败：' + (error.message || '格式不正确'));
        } finally {
          setIsImportingOPML(false);
          // 清除 input
          e.target.value = '';
        }
      };
      reader.readAsText(file);
    } catch (error) {
      toastError('读取文件失败');
      setIsImportingOPML(false);
    }
  };

  const fetchModels = async (provider: any) => {
    if (!provider.apiUrl || !provider.apiKey && provider.type !== 'OLLAMA') {
      toastInfo('请先填写 API 地址和 API Key');
      return;
    }

    try {
      setIsFetchingModels(prev => ({ ...prev, [provider.id]: true }));
      const models = await getModels(provider);
      setProviderModels(prev => ({ ...prev, [provider.id]: models }));
      toastSuccess('模型列表同步成功');
    } catch (error: any) {
      console.error('Failed to fetch models:', error);
      toastError('获取模型列表失败: ' + error.message);
    } finally {
      setIsFetchingModels(prev => ({ ...prev, [provider.id]: false }));
    }
  };

  const handleTestProvider = async (provider: any) => {
    if (!provider.apiUrl || (!provider.apiKey && provider.type !== 'OLLAMA')) {
      toastInfo('请先填写 API 地址和 API Key');
      return;
    }

    try {
      setIsTestingProvider(prev => ({ ...prev, [provider.id]: true }));
      const result = await testProvider(provider);
      if (result.status === 'healthy') {
        toastSuccess('连接成功: ' + result.message);
      } else {
        toastError('连接失败: ' + result.message);
      }
    } catch (error: any) {
      console.error('Failed to test provider:', error);
      toastError('测试连接失败: ' + error.message);
    } finally {
      setIsTestingProvider(prev => ({ ...prev, [provider.id]: false }));
    }
  };


  const handleFieldChange = (key: string, value: any) => {
    setSettings(prev => {
      if (key.includes('.')) {
        const [parent, child] = key.split('.');
        return {
          ...prev,
          [parent]: {
            ...prev[parent],
            [child]: value
          }
        };
      }
      return {
        ...prev,
        [key]: value
      };
    });
  };

  const getFieldValue = (key: string, defaultValue?: any) => {
    if (!key) return defaultValue;
    if (key.includes('.')) {
      const [parent, child] = key.split('.');
      return settings[parent]?.[child] ?? defaultValue;
    }
    return settings[key] ?? defaultValue;
  };

  const handlePublisherChange = (id: string, field: string, value: any) => {
    setSettings(prev => {
      const publishers = [...(prev.PUBLISHERS || [])];
      let idx = publishers.findIndex(p => p.id === id);
      
      if (idx === -1) {
        // 如果不存在，添加一个基础配置项
        publishers.push({ id, enabled: false, config: {} });
        idx = publishers.length - 1;
      }

      if (field === 'enabled') {
        publishers[idx] = { ...publishers[idx], enabled: value };
      } else {
        publishers[idx] = {
          ...publishers[idx],
          config: { ...(publishers[idx].config || {}), [field]: value }
        };
      }
      return { ...prev, PUBLISHERS: publishers };
    });
  };

  const handleStorageChange = (id: string, field: string, value: any) => {
    setSettings(prev => {
      const storages = [...(prev.STORAGES || [])];
      let idx = storages.findIndex(s => s.id === id);

      if (idx === -1) {
        // 如果不存在，添加一个基础配置项
        storages.push({ id, enabled: false, config: {} });
        idx = storages.length - 1;
      }

      if (field === 'enabled') {
        storages[idx] = { ...storages[idx], enabled: value };
      } else {
        storages[idx] = {
          ...storages[idx],
          config: { ...(storages[idx].config || {}), [field]: value }
        };
      }
      return { ...prev, STORAGES: storages };
    });
  };


  const handleDeleteApiKey = async (id: string) => {
    if (!window.confirm('确定要移除此 API Key 吗？修改将在点击“保存配置”后生效。')) return;
    setApiKeys(prev => prev.filter(k => k.id !== id));
    setDeletedApiKeyIds(prev => new Set(prev).add(id));
    // 如果该 ID 也在更新队列中，移除它
    setUpdatedApiKeyIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleCreateApiKey = async () => {
    const name = window.prompt('请输入 API Key 名称 (例如: 外部助手)');
    if (!name) return;
    
    if (!window.confirm('生成新的 API Key 将立即写入数据库并生效，是否继续？')) return;

    try {
      const result = await createApiKey(name);
      setNewlyCreatedKey({ name, key: result.key });
      
      // 重新从后端获取最新列表，但要保留当前已经在前端做的“暂存”修改
      const latestFromBackend = await getApiKeys();
      
      setApiKeys(prev => {
        // 以最新的后端数据为基础，叠加还没保存的本地修改
        return latestFromBackend.map((bk: any) => {
          const pendingUpdate = prev.find(pk => pk.id === bk.id);
          if (pendingUpdate && updatedApiKeyIds.has(bk.id)) {
            return { ...bk, ...pendingUpdate };
          }
          return bk;
        }).filter((bk: any) => !deletedApiKeyIds.has(bk.id));
      });

      toastSuccess('API Key 已即时生成并生效');
    } catch (error: any) {
      toastError('生成失败: ' + error.message);
    }
  };

  const handleUpdateApiKey = (id: string, data: any) => {
    setApiKeys(prev => prev.map(k => k.id === id ? { ...k, ...data } : k));
    setUpdatedApiKeyIds(prev => new Set(prev).add(id));
  };


  const tabs = [
    ...(pluginMetadata.aiProviders.length > 0 ? [{ id: 'ai', label: 'AI 模型', icon: 'psychology' }] : []),
    ...(pluginMetadata.adapters.length > 0 ? [{ id: 'sources', label: '数据源管理', icon: 'database' }] : []),
    { id: 'categories', label: '分类管理', icon: 'label' },
    ...(pluginMetadata.publishers.length > 0 || pluginMetadata.storages.length > 0 ? [{ id: 'publishers', label: '发布与存储', icon: 'send' }] : []),
    { id: 'interop', label: 'AI 互联', icon: 'hub' },
    { id: 'system', label: '系统', icon: 'settings' },
  ];

  const sections = [
    {
      id: 'interop',
      tab: 'interop',
      title: 'AI 互联管理',
      description: '管理已授权的其他 AI 系统接入。在此可以撤销已生成的 API Key。',
      fields: [
        { label: '互联 API Key 列表', key: 'INTEROP_KEYS', type: 'custom' },
      ]
    },
    {
      id: 'ai',
      tab: 'ai',
      title: 'AI 模型配置',
      description: '配置 AI 平台、模型参数及翻译功能',
      fields: [
        { label: '生效 AI 提供商', key: 'ACTIVE_AI_PROVIDER_ID', type: 'select', 
          options: (settings.AI_PROVIDERS || [])
            .filter((p: any) => !(settings.CLOSED_PLUGINS || []).includes(p.id))
            .map((p: any) => ({ label: p.name, value: p.id })), 
          defaultValue: 'default-gemini' 
        },
        { label: 'AI 提供商列表', key: 'AI_PROVIDERS', type: 'custom' },
      ]
    },

    {
      id: 'publishers',
      tab: 'publishers',
      title: '发布与存储管理',
      description: '配置内容分发平台及图片/视频存储插件',
      fields: [
        { label: '发布渠道列表', key: 'PUBLISHERS', type: 'custom' },
        { label: '存储插件配置', key: 'STORAGES', type: 'custom' },
      ]
    },

    {
      id: 'sources',
      tab: 'sources',
      title: '数据源管理',
      description: '管理数据适配器及其子数据源项',
      fields: [
        { label: '适配器配置', key: 'ADAPTERS', type: 'custom' },
      ]
    },
    {
      id: 'categories',
      tab: 'categories',
      title: '分类标签管理',
      description: '管理全局分类标签，用于数据源归类',
      fields: [
        { label: '分类配置', key: 'CATEGORIES', type: 'custom' },
      ]
    },
    {
      id: 'network',
      tab: 'system',
      title: '网络与代理设置',
      description: '配置接口代理与图片代理，解决访问限制问题',
      fields: [
        { label: 'API 接口代理', key: 'API_PROXY', type: 'text', placeholder: '例如: http://127.0.0.1:7890' },
        { label: '图片代理模板', key: 'IMAGE_PROXY', type: 'text', placeholder: '例如: https://i0.wp.com/{url} 或 /api/proxy/image?url={url}' },
      ]
    },
    {
      id: 'selection',
      tab: 'system',
      title: '内容筛选设置',
      description: '配置内容筛选页面的数据获取范围与查询方式',
      fields: [
        {
          label: '数据获取天数',
          key: 'SELECTION_FETCH_DAYS',
          type: 'number',
          defaultValue: 2,
          placeholder: '设置从选定日期起回溯的天数'
        },
        {
          label: '筛选查询字段',
          key: 'SELECTION_QUERY_FIELD',
          type: 'select',
          options: [
            { label: '抓取日期 (ingestion_date)', value: 'ingestion_date' },
            { label: '发布日期 (published_date)', value: 'published_date' }
          ],
          defaultValue: 'published_date'
        },
      ]
    },
    {
      id: 'memory-knowledge',
      tab: 'system',
      title: '知识库与记忆系统设置',
      description: '配置知识库文档与 AI 长期记忆的存储与检索方案',
      fields: [
        {
          label: '知识库系统类型',
          key: 'KNOWLEDGE_SYSTEM_TYPE',
          type: 'select',
          options: [
            { label: 'SQLite (高性能全文检索)', value: 'sqlite' },
            { label: 'Hierarchical (层级推理/文件索引)', value: 'hierarchical' }
          ],
          defaultValue: 'hierarchical'
        },
        {
          label: '记忆系统类型',
          key: 'MEMORY_SYSTEM_TYPE',
          type: 'select',
          options: [
            { label: 'SQLite (基础关键词匹配)', value: 'sqlite' },
            { label: 'Hierarchical (语义推理/文件索引)', value: 'hierarchical' }
          ],
          defaultValue: 'hierarchical'
        },
      ]
    },
    {
      id: 'media',
      tab: 'system',
      title: '媒体处理设置',
      description: '配置图片转换 AVIF、视频压缩及 TypeID 前缀等参数',
      fields: [
        { label: '图片转换 (AVIF)', key: 'IMAGE_PROCESS_CONFIG.CONVERT_IMAGES', type: 'select', options: [{ label: '开启', value: true }, { label: '关闭', value: false }], defaultValue: true },
        { label: 'AVIF 质量 (1-100)', key: 'IMAGE_PROCESS_CONFIG.AVIF_QUALITY', type: 'number', defaultValue: 70 },
        { label: 'AVIF 压缩耗时 (1-9)', key: 'IMAGE_PROCESS_CONFIG.AVIF_EFFORT', type: 'number', defaultValue: 5 },
        { label: '视频转换 (MP4)', key: 'IMAGE_PROCESS_CONFIG.CONVERT_VIDEOS', type: 'select', options: [{ label: '开启', value: true }, { label: '关闭', value: false }], defaultValue: true },
        { label: '视频 CRF (18-51)', key: 'IMAGE_PROCESS_CONFIG.VIDEO_CRF', type: 'number', defaultValue: 28 },
        { label: '视频 Preset', key: 'IMAGE_PROCESS_CONFIG.VIDEO_PRESET', type: 'select', options: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'], defaultValue: 'slow' },
        { label: '最大视频大小 (MB)', key: 'IMAGE_PROCESS_CONFIG.MAX_VIDEO_SIZE_MB', type: 'number', defaultValue: 25 },
        { label: 'TypeID 前缀', key: 'IMAGE_PROCESS_CONFIG.TYPEID_PREFIX', type: 'text', defaultValue: 'news' },
      ]
    },
    {
      id: 'security',
      tab: 'system',
      title: '安全与 API 密钥',
      description: '管理系统访问权限、密码以及第三方平台 API 密钥',
      fields: [
        { label: '系统访问密码', key: 'SYSTEM_PASSWORD', type: 'password', placeholder: '在此设置新的系统密码' },
        { label: '登录过期时间', key: 'AUTH_EXPIRE_TIME', type: 'text', placeholder: '例如: 7d, 24h, 1h' },
        { label: 'Skill Store API Key', key: 'SKILL_STORE_API_KEY', type: 'password', placeholder: '用于在线安装技能' },
        { label: 'Global GitHub Token', key: 'GLOBAL_GITHUB_TOKEN', type: 'password', placeholder: '全局 GitHub 访问令牌，用于 GitHub 导入及发布' },
        { label: 'Ark API Key (豆包图片生成)', key: 'ARK_API_KEY', type: 'password', placeholder: '用于调用豆包图片生成接口' },
      ]
    }
  ];



  const handleAdapterChange = (adapterId: string, itemId: string | null, field: string, value: any) => {
    setSettings(prev => {
      const adapters = [...(prev.ADAPTERS || [])];
      const adapterIdx = adapters.findIndex(a => a.id === adapterId);
      if (adapterIdx === -1) return prev;

      const updatedAdapter = { ...adapters[adapterIdx] };
      if (itemId === null) {
        // Update adapter level
        (updatedAdapter as any)[field] = value;
      } else {
        // Update item level
        const items = [...(updatedAdapter.items || [])];
        const itemIdx = items.findIndex(i => i.id === itemId);
        if (itemIdx !== -1) {
          items[itemIdx] = { ...items[itemIdx], [field]: value };
          updatedAdapter.items = items;
        }
      }

      adapters[adapterIdx] = updatedAdapter;
      return { ...prev, ADAPTERS: adapters };
    });
  };

  const handleAddItem = (adapterId: string) => {
    setSettings(prev => {
      const adapters = [...(prev.ADAPTERS || [])];
      const adapterIdx = adapters.findIndex(a => a.id === adapterId);
      if (adapterIdx === -1) return prev;

      const adapter = adapters[adapterIdx];
      const adapterMeta = pluginMetadata.adapters.find(a => a.type === adapter.adapterType);
      
      const newItemId = Math.random().toString(36).substr(2, 9);
      
      // 确保获取有效的默认分类
      const categories = prev.CATEGORIES || [];
      let defaultCategory = categories[0]?.id || 'news';
      if (adapter.adapterType === 'GitHubTrendingAdapter') {
        const ghCat = categories.find((c: any) => c.id?.toLowerCase().includes('github'));
        if (ghCat) defaultCategory = ghCat.id;
      }

      // 动态生成初始值
      const newItem: any = { 
        id: newItemId, 
        name: '新数据项', 
        category: defaultCategory, 
        enabled: true, 
        useProxy: false 
      };

      // 从元数据中填充默认字段 (仅限 item 作用域)
      if (adapterMeta && adapterMeta.configFields) {
        adapterMeta.configFields.forEach((f: any) => {
          if (f.default !== undefined && (f.scope === 'item' || !f.scope)) {
            newItem[f.key] = f.default;
          }
        });
      }

      adapters[adapterIdx] = {
        ...adapter,
        items: [...(adapter.items || []), newItem]
      };
      return { ...prev, ADAPTERS: adapters };
    });
  };


  const handleDeleteItem = (adapterId: string, itemId: string) => {
    setSettings(prev => {
      const adapters = [...(prev.ADAPTERS || [])];
      const adapterIdx = adapters.findIndex(a => a.id === adapterId);
      if (adapterIdx === -1) return prev;

      const adapter = adapters[adapterIdx];
      adapters[adapterIdx] = {
        ...adapter,
        items: (adapter.items || []).filter((i: any) => i.id !== itemId)
      };
      return { ...prev, ADAPTERS: adapters };
    });
  };

  const handleAddAdapter = (type: string) => {
    const meta = pluginMetadata.adapters.find(a => a.type === type);
    if (!meta) return;

    setSettings(prev => {
      const adapters = [...(prev.ADAPTERS || [])];
      const newAdapter = {
        id: `adapter-${Math.random().toString(36).substr(2, 5)}`,
        name: meta.name,
        adapterType: type as any,
        enabled: true,
        apiUrl: '',
        items: []
      };
      return { ...prev, ADAPTERS: [...adapters, newAdapter] };
    });
  };

  const handleDeleteAdapter = (id: string) => {
    if (!window.confirm('确定要删除整个适配器组及其所有子项吗？')) return;
    setSettings(prev => ({
      ...prev,
      ADAPTERS: (prev.ADAPTERS || []).filter((a: any) => a.id !== id)
    }));
  };

  const handleCategoryChange = (id: string, field: string, value: any) => {
    setSettings(prev => {
      const categories = [...(prev.CATEGORIES || [])];
      const idx = categories.findIndex(c => c.id === id);
      if (idx === -1) return prev;

      const oldId = categories[idx].id;
      categories[idx] = { ...categories[idx], [field]: value };

      // 如果修改的是 ID，需要同步更新所有适配器子项的 category 引用
      if (field === 'id' && oldId !== value) {
        const adapters = (prev.ADAPTERS || []).map((adapter: any) => ({
          ...adapter,
          items: (adapter.items || []).map((item: any) => 
            item.category === oldId ? { ...item, category: value } : item
          )
        }));
        return { ...prev, CATEGORIES: categories, ADAPTERS: adapters };
      }

      return { ...prev, CATEGORIES: categories };
    });
  };

  const handleAIProviderChange = (id: string, field: string, value: any) => {
    if (field === 'model' && value === 'custom-input') {
      // 切换回手动输入模式：清空该提供商的模型列表缓存
      setProviderModels(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }

    setSettings(prev => {
      const providers = [...(prev.AI_PROVIDERS || [])];
      const idx = providers.findIndex(p => p.id === id);
      if (idx === -1) return prev;

      // 如果是多选模型
      if (field === 'models') {
        const currentModels = providers[idx].models || [];
        const newModels = currentModels.includes(value)
          ? currentModels.filter((m: string) => m !== value)
          : [...currentModels, value];
        providers[idx] = { ...providers[idx], models: newModels };
      } else {
        providers[idx] = { ...providers[idx], [field]: value };
      }
      
      return { ...prev, AI_PROVIDERS: providers };
    });
  };


  const handleAddAIProvider = () => {
    setSettings(prev => {
      const providers = [...(prev.AI_PROVIDERS || [])];
      const newId = `ai-${Math.random().toString(36).substr(2, 5)}`;
      const newProvider = {
        id: newId,
        name: '新 AI 提供商',
        type: 'GEMINI',
        apiUrl: 'https://generativelanguage.googleapis.com',
        apiKey: '',
        enabled: true
      };
      return { ...prev, AI_PROVIDERS: [...providers, newProvider] };
    });
  };

  const handleDeleteAIProvider = (id: string) => {
    if (settings.ACTIVE_AI_PROVIDER_ID === id) {
      toastInfo('不能删除当前正在使用的提供商。请先切换到其他提供商。');
      return;
    }
    setSettings(prev => ({
      ...prev,
      AI_PROVIDERS: (prev.AI_PROVIDERS || []).filter((p: any) => p.id !== id)
    }));
  };

  const handleMoveAIProvider = (id: string, direction: 'up' | 'down') => {
    setSettings(prev => {
      const originalProviders = [...(prev.AI_PROVIDERS || [])];
      const closedPlugins = prev.CLOSED_PLUGINS || [];
      const visibleIdxs = originalProviders
        .map((p, i) => !closedPlugins.includes(p.id) ? i : -1)
        .filter(i => i !== -1);
      
      const currentIdxInOriginal = originalProviders.findIndex(p => p.id === id);
      if (currentIdxInOriginal === -1) return prev;
      
      const currentIdxInVisible = visibleIdxs.indexOf(currentIdxInOriginal);
      if (currentIdxInVisible === -1) return prev;
      
      const targetIdxInVisible = direction === 'up' ? currentIdxInVisible - 1 : currentIdxInVisible + 1;
      if (targetIdxInVisible < 0 || targetIdxInVisible >= visibleIdxs.length) return prev;
      
      const targetIdxInOriginal = visibleIdxs[targetIdxInVisible];
      
      [originalProviders[currentIdxInOriginal], originalProviders[targetIdxInOriginal]] = [originalProviders[targetIdxInOriginal], originalProviders[currentIdxInOriginal]];
      
      return { ...prev, AI_PROVIDERS: originalProviders };
    });
  };

  const handleMoveCategory = (id: string, direction: 'up' | 'down') => {
    setSettings(prev => {
      const categories = [...(prev.CATEGORIES || [])];
      const idx = categories.findIndex(c => c.id === id);
      if (idx === -1) return prev;
      
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= categories.length) return prev;
      
      [categories[idx], categories[targetIdx]] = [categories[targetIdx], categories[idx]];
      return { ...prev, CATEGORIES: categories };
    });
  };

  const handleMoveAdapter = (id: string, direction: 'up' | 'down') => {
    setSettings(prev => {
      const originalAdapters = [...(prev.ADAPTERS || [])];
      const closedPlugins = prev.CLOSED_PLUGINS || [];
      const visibleIdxs = originalAdapters
        .map((a, i) => !closedPlugins.includes(a.adapterType) ? i : -1)
        .filter(i => i !== -1);
      
      const currentIdxInOriginal = originalAdapters.findIndex(a => a.id === id);
      if (currentIdxInOriginal === -1) return prev;
      
      const currentIdxInVisible = visibleIdxs.indexOf(currentIdxInOriginal);
      if (currentIdxInVisible === -1) return prev;
      
      const targetIdxInVisible = direction === 'up' ? currentIdxInVisible - 1 : currentIdxInVisible + 1;
      if (targetIdxInVisible < 0 || targetIdxInVisible >= visibleIdxs.length) return prev;
      
      const targetIdxInOriginal = visibleIdxs[targetIdxInVisible];
      
      [originalAdapters[currentIdxInOriginal], originalAdapters[targetIdxInOriginal]] = [originalAdapters[targetIdxInOriginal], originalAdapters[currentIdxInOriginal]];
      
      return { ...prev, ADAPTERS: originalAdapters };
    });
  };

  const handleMoveAdapterItem = (adapterId: string, itemId: string, direction: 'up' | 'down') => {
    setSettings(prev => {
      const adapters = [...(prev.ADAPTERS || [])];
      const adapterIdx = adapters.findIndex(a => a.id === adapterId);
      if (adapterIdx === -1) return prev;
      
      const items = [...(adapters[adapterIdx].items || [])];
      const itemIdx = items.findIndex(i => i.id === itemId);
      if (itemIdx === -1) return prev;
      
      const targetIdx = direction === 'up' ? itemIdx - 1 : itemIdx + 1;
      if (targetIdx < 0 || targetIdx >= items.length) return prev;
      
      [items[itemIdx], items[targetIdx]] = [items[targetIdx], items[itemIdx]];
      
      adapters[adapterIdx] = { ...adapters[adapterIdx], items };
      return { ...prev, ADAPTERS: adapters };
    });
  };


  const handleAddCategory = () => {
    setSettings(prev => {
      const categories = [...(prev.CATEGORIES || [])];
      // 生成一个简单的序号 ID，避免随机字符串看起来像“乱码”
      const nextIndex = categories.length + 1;
      const newId = `category_${nextIndex}`;
      return {
        ...prev,
        CATEGORIES: [...categories, { id: newId, label: `新分类 ${nextIndex}`, icon: 'label' }]
      };
    });
  };

  const handleDeleteCategory = (id: string) => {
    // 检查是否有适配器正在使用该分类
    const usingAdapters = (settings.ADAPTERS || []).filter((adapter: any) => 
      (adapter.items || []).some((item: any) => item.category === id)
    );

    if (usingAdapters.length > 0) {
      const adapterNames = usingAdapters.map((a: any) => a.name).join(', ');
      if (!window.confirm(`分类 "${id}" 正在被适配器 [${adapterNames}] 使用。删除分类将导致这些数据源在筛选页面被隐藏（除非重新指定分类）。是否确定删除？`)) {
        return;
      }
    }

    setSettings(prev => ({
      ...prev,
      CATEGORIES: (prev.CATEGORIES || []).filter((c: any) => c.id !== id)
    }));
  };

  const handleIconSelect = (icon: string) => {
    if (iconPickerState.catId) {
      handleCategoryChange(iconPickerState.catId, 'icon', icon);
    }
  };

  const renderDynamicConfigFields = (fields: any[], currentValues: any, onChange: (key: string, value: any) => void, scope?: 'adapter' | 'item', idPrefix?: string) => {
    const filteredFields = scope ? fields.filter(f => f.scope === scope || (!f.scope && scope === 'item')) : fields;
    
    return filteredFields.map(field => {
      const fieldId = idPrefix ? `${idPrefix}-${field.key}` : field.key;
      const isPassword = field.type === 'password';
      const showPassword = showPasswords[fieldId];

      // 特殊处理：如果字段是 executorId，将其转换为选择框
      let fieldType = field.type;
      let fieldOptions = field.options;

      if (field.type === 'executor') {
        fieldType = 'select';
        fieldOptions = [
          '', 
          ...agents.map((a: any) => `agent:${a.id}`),
          ...workflows.map((w: any) => `workflow:${w.id}`)
        ];
      }

      return (
        <div key={field.key} className="space-y-1.5 flex-1 min-w-[150px]">
          <div className="flex items-center gap-1.5 ml-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
          </div>
          {fieldType === 'select' ? (
            <select
              value={currentValues[field.key] ?? field.default ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              className="w-full px-3 py-1.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-lg text-xs text-slate-600 dark:text-slate-300 focus:ring-1 focus:ring-primary outline-none transition-all"
            >
              {fieldOptions?.map((opt: any) => {
                let displayLabel = opt || '使用默认';
                if (field.type === 'executor' && opt) {
                  if (opt.startsWith('agent:')) {
                    const id = opt.replace('agent:', '');
                    const agent = agents.find(a => a.id === id);
                    displayLabel = `[Agent] ${agent ? agent.name : id}`;
                  } else if (opt.startsWith('workflow:')) {
                    const id = opt.replace('workflow:', '');
                    const workflow = workflows.find(w => w.id === id);
                    displayLabel = `[工作流] ${workflow ? workflow.name : id}`;
                  }
                }
                return <option key={opt} value={opt}>{displayLabel}</option>;
              })}
            </select>
          ) : fieldType === 'textarea' ? (
            <textarea
              value={currentValues[field.key] ?? field.default ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              rows={3}
              className="w-full px-3 py-1.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-lg text-xs text-slate-600 dark:text-slate-300 focus:ring-1 focus:ring-primary outline-none transition-all resize-none"
            />
          ) : (
            <div className="relative">
              <input
                type={isPassword ? (showPassword ? 'text' : 'password') : (fieldType === 'number' ? 'number' : 'text')}
                value={currentValues[field.key] ?? field.default ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange(field.key, fieldType === 'number' ? (val === '' ? 0 : parseInt(val)) : val);
                }}
                className={`w-full px-3 py-1.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-lg text-xs text-slate-600 dark:text-slate-300 focus:ring-1 focus:ring-primary outline-none transition-all ${isPassword ? 'pr-9' : ''}`}
              />
              {isPassword && (
                <button
                  type="button"
                  onClick={() => setShowPasswords(prev => ({ ...prev, [fieldId]: !prev[fieldId] }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-base">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      );
    });
  };

  const renderField = (field: any) => {
    const currentValue = getFieldValue(field.key);

    if (field.key === 'STORAGES') {
      if (pluginMetadata.storages.length === 0) return null;
      const closedPlugins = settings.CLOSED_PLUGINS || [];
      const storages = (settings.STORAGES || []).filter((s: any) => !closedPlugins.includes(s.id));
      
      if (isLoading && (!pluginMetadata.storages || pluginMetadata.storages.length === 0)) {
        return (
          <div className="col-span-full p-8 text-center bg-slate-50 dark:bg-white/5 rounded-2xl border border-dashed border-slate-200 dark:border-white/10">
            <p className="text-slate-400 text-sm">正在加载存储元数据...</p>
          </div>
        );
      }

      return (
        <div className="col-span-full space-y-6">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest border-t border-slate-100 dark:border-white/5 pt-6">可用存储插件</p>
          {pluginMetadata.storages.map((storageMeta: any) => {
            const storageData = storages.find((s: any) => s.id === storageMeta.id) || { id: storageMeta.id, enabled: false, config: {} };
            return (
              <div key={storageMeta.id} className="p-6 bg-slate-50 dark:bg-white/[0.02] rounded-xl border border-slate-200 dark:border-white/5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary">{storageMeta.icon || 'cloud_upload'}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{storageMeta.name}</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={storageData.enabled}
                      onChange={(e) => handleStorageChange(storageMeta.id, 'enabled', e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                  </label>
                </div>
                {storageData.enabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-200 dark:border-white/5">
                    {renderDynamicConfigFields(
                      storageMeta.configFields || [],
                      storageData.config || {},
                      (key, value) => handleStorageChange(storageMeta.id, key, value),
                      undefined,
                      `storage-${storageMeta.id}`
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    if (field.key === 'PUBLISHERS') {
      if (pluginMetadata.publishers.length === 0) return null;
      const closedPlugins = settings.CLOSED_PLUGINS || [];
      const publishers = (settings.PUBLISHERS || []).filter((p: any) => !closedPlugins.includes(p.id));
      
      if (isLoading && (!pluginMetadata.publishers || pluginMetadata.publishers.length === 0)) {
        return (
          <div className="col-span-full p-8 text-center bg-slate-50 dark:bg-white/5 rounded-2xl border border-dashed border-slate-200 dark:border-white/10">
            <p className="text-slate-400 text-sm">正在加载发布器元数据...</p>
          </div>
        );
      }

      return (
        <div className="col-span-full space-y-6">
          {pluginMetadata.publishers.map((pubMeta: any) => {
            const pubData = publishers.find((p: any) => p.id === pubMeta.id) || { id: pubMeta.id, enabled: false, config: {} };
            return (
              <div key={pubMeta.id} className="p-6 bg-slate-50 dark:bg-white/[0.02] rounded-xl border border-slate-200 dark:border-white/5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary">{pubMeta.icon || 'send'}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{pubMeta.name}</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={pubData.enabled}
                      onChange={(e) => handlePublisherChange(pubMeta.id, 'enabled', e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                  </label>
                </div>
                {pubData.enabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-200 dark:border-white/5">
                    {renderDynamicConfigFields(
                      pubMeta.configFields || [],
                      pubData.config || {},
                      (key, value) => handlePublisherChange(pubMeta.id, key, value),
                      undefined,
                      `publisher-${pubMeta.id}`
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    if (field.key === 'AI_PROVIDERS') {
      const closedPlugins = settings.CLOSED_PLUGINS || [];
      const providers = (settings.AI_PROVIDERS || []).filter((p: any) => !closedPlugins.includes(p.id));
      
      return (
        <div className="col-span-full space-y-8">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">配置提供商</h4>
          </div>
          
          <div className="space-y-6">
            {providers.map((provider: any, idx: number) => {
              const isActive = settings.ACTIVE_AI_PROVIDER_ID === provider.id;
              const isExpanded = expandedProviders[provider.id] ?? isActive;
              
              return (
                <div 
                  key={`${provider.id}-${idx}`} 
                  className={`
                    relative bg-white dark:bg-surface-dark rounded-[24px] border transition-all duration-300
                    ${isActive 
                      ? 'border-primary/40 shadow-lg shadow-primary/5 ring-1 ring-primary/20' 
                      : 'border-slate-200 dark:border-white/5 shadow-sm hover:border-slate-300 dark:hover:border-white/10'}
                  `}
                >
                  {/* Header Section - Click to Toggle */}
                  <div 
                    onClick={() => setExpandedProviders(prev => ({ ...prev, [provider.id]: !isExpanded }))}
                    className="px-6 py-5 border-b border-slate-100 dark:border-white/5 flex flex-wrap items-center justify-between gap-4 cursor-pointer group/header"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`
                        w-10 h-10 rounded-xl flex items-center justify-center transition-all
                        ${isActive 
                          ? 'bg-primary text-white shadow-md shadow-primary/20' 
                          : 'bg-slate-100 dark:bg-white/5 text-slate-500 group-hover/header:bg-slate-200 dark:group-hover/header:bg-white/10'}
                      `}>
                        <span className="material-symbols-outlined text-2xl">
                          {provider.type === 'OLLAMA' ? 'terminal' : 'psychology'}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <input 
                            type="text"
                            value={provider.name}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleAIProviderChange(provider.id, 'name', e.target.value)}
                            className="block font-bold text-slate-900 dark:text-white bg-transparent border-none p-0 focus:ring-0 text-base mb-0.5 pointer-events-auto"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <select 
                            value={provider.type}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleAIProviderChange(provider.id, 'type', e.target.value)}
                            className="text-[10px] uppercase tracking-widest font-bold text-slate-400 bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:text-primary transition-colors pointer-events-auto"
                          >
                            <option value="OPENAI">OpenAI Compatible</option>
                            <option value="CLAUDE">Anthropic Claude</option>
                            <option value="GEMINI">Google Gemini</option>
                            <option value="OLLAMA">Ollama Local</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-4 mt-2">
                          <label className="flex items-center gap-2 cursor-pointer group">
                            <input 
                              type="checkbox"
                              checked={provider.useProxy ?? false}
                              onChange={(e) => handleAIProviderChange(provider.id, 'useProxy', e.target.checked)}
                              className="w-3.5 h-3.5 rounded border-slate-300 dark:border-white/20 text-primary focus:ring-primary/20 bg-transparent"
                            />
                            <span className="text-[10px] font-bold text-slate-400 group-hover:text-primary transition-colors uppercase tracking-wider">使用全局代理</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTestProvider(provider);
                        }}
                        disabled={isTestingProvider[provider.id]}
                        className="flex items-center gap-1.5 px-3 py-1 bg-primary/10 text-primary hover:bg-primary hover:text-white rounded-full text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 h-7"
                      >
                        <span className={`material-symbols-outlined text-[14px] ${isTestingProvider[provider.id] ? 'animate-spin' : ''}`}>
                          {isTestingProvider[provider.id] ? 'hourglass_top' : 'bolt'}
                        </span>
                        测试连接
                      </button>
                      <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-0.5"></div>
                      {isActive ? (
                        <span className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 text-green-500 rounded-full text-[10px] font-bold uppercase tracking-wider h-7">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                          已激活
                        </span>
                      ) : (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFieldChange('ACTIVE_AI_PROVIDER_ID', provider.id);
                          }}
                          className="flex items-center px-3 py-1 bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-primary hover:text-white rounded-full text-[10px] font-bold uppercase tracking-wider transition-all h-7"
                        >
                          设为默认
                        </button>
                      )}
                      <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-0.5"></div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveAIProvider(provider.id, 'up');
                          }}
                          disabled={idx === 0}
                          title="上移"
                          className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-primary hover:bg-primary/10 rounded-full transition-all disabled:opacity-10 disabled:cursor-not-allowed"
                        >
                          <span className="material-symbols-outlined text-xl">arrow_upward</span>
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveAIProvider(provider.id, 'down');
                          }}
                          disabled={idx === providers.length - 1}
                          title="下移"
                          className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-primary hover:bg-primary/10 rounded-full transition-all disabled:opacity-10 disabled:cursor-not-allowed"
                        >
                          <span className="material-symbols-outlined text-xl">arrow_downward</span>
                        </button>
                      </div>
                      <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-0.5"></div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAIProvider(provider.id);
                        }}
                        className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                      >
                        <span className="material-symbols-outlined text-xl">delete</span>
                      </button>
                      <span className={`material-symbols-outlined text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                        expand_more
                      </span>
                    </div>
                  </div>
                  
                  {/* Content Section - Animated Collapse */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="p-6">
                          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                            
                            {/* Left: Connection Settings */}
                            <div className="lg:col-span-5 space-y-5">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="material-symbols-outlined text-sm text-primary">link</span>
                                  <h5 className="text-[11px] font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">连接设置</h5>
                                </div>
<div className="space-y-4">
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] ml-1">API 地址</label>
                                  <input 
                                    type="text"
                                    value={provider.apiUrl || ''}
                                    onChange={(e) => handleAIProviderChange(provider.id, 'apiUrl', e.target.value)}
                                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 rounded-xl text-xs text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-mono"
                                  />
                                </div>
                                
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] ml-1">API 密钥 (API Key)</label>
                                  <div className="relative group">
                                    <input 
                                      type={showApiKeys[provider.id] ? "text" : "password"}
                                      value={provider.apiKey || ''}
                                      placeholder="sk-..."
                                      onChange={(e) => handleAIProviderChange(provider.id, 'apiKey', e.target.value)}
                                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 rounded-xl text-xs text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all pr-12 font-mono"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setShowApiKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors"
                                    >
                                      <span className="material-symbols-outlined text-lg">
                                        {showApiKeys[provider.id] ? 'visibility_off' : 'visibility'}
                                      </span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Right: Models Management */}
                            <div className="lg:col-span-7 space-y-5">
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <span className="material-symbols-outlined text-sm text-primary">model_training</span>
                                  <h5 className="text-[11px] font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">模型管理</h5>
                                </div>
                                <button 
                                  onClick={() => fetchModels(provider)}
                                  disabled={isFetchingModels[provider.id]}
                                  className="flex items-center gap-1.5 text-[10px] font-bold text-primary hover:bg-primary/10 px-2 py-1 rounded-md transition-all disabled:opacity-50"
                                >
                                  <span className={`material-symbols-outlined text-sm ${isFetchingModels[provider.id] ? 'animate-spin' : ''}`}>
                                    refresh
                                  </span>
                                  同步列表
                                </button>
                              </div>

                              <div className="space-y-4">
                                {/* Selected Models Area */}
                                <div className="flex flex-wrap gap-2 p-3 bg-slate-50 dark:bg-white/[0.03] rounded-2xl border border-slate-100 dark:border-white/5 min-h-[50px]">
                                  {(!provider.models || provider.models.length === 0) ? (
                                    <div className="flex items-center gap-2 text-slate-400 px-2 text-[10px] italic py-1">
                                      <span className="material-symbols-outlined text-sm">info</span>
                                      未选择模型，系统将尝试调用默认模型
                                    </div>
                                  ) : (
                                    provider.models.map((m: string) => (
                                      <div key={m} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary text-white rounded-lg text-[10px] font-bold shadow-sm shadow-primary/20 group">
                                        <span>{m}</span>
                                        <button 
                                          onClick={() => handleAIProviderChange(provider.id, 'models', m)}
                                          className="w-4 h-4 flex items-center justify-center bg-white/20 hover:bg-white/40 rounded-full transition-colors"
                                        >
                                          <span className="material-symbols-outlined text-[10px]">close</span>
                                        </button>
                                      </div>
                                    ))
                                  )}
                                </div>

                                {/* Model Browser */}
                                <div className="grid grid-cols-1 gap-2">
                                  <div className="relative">
                                    <input 
                                      type="text"
                                      placeholder="手动输入模型 ID 并回车添加..."
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          const val = (e.target as HTMLInputElement).value.trim();
                                          if (val) {
                                            handleAIProviderChange(provider.id, 'models', val);
                                            (e.target as HTMLInputElement).value = '';
                                          }
                                        }
                                      }}
                                      className="w-full pl-10 pr-4 py-2 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-xs text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all shadow-inner"
                                    />
                                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">add</span>
                                  </div>

                                  {providerModels[provider.id] && providerModels[provider.id].length > 0 && (
                                    <div className="mt-2 p-1.5 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-2xl">
                                      <div className="max-h-[160px] overflow-y-auto px-2 py-1 space-y-1 custom-scrollbar">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                          {providerModels[provider.id].map(m => (
                                            <label 
                                              key={m} 
                                              className={`
                                                flex items-center gap-2.5 p-2 rounded-xl cursor-pointer transition-all border
                                                ${(provider.models || []).includes(m) 
                                                  ? 'bg-primary/5 border-primary/20' 
                                                  : 'bg-white dark:bg-surface-dark border-transparent hover:border-slate-200 dark:hover:border-white/10'}
                                              `}
                                            >
                                              <div className={`
                                                w-4 h-4 rounded border flex items-center justify-center transition-all
                                                ${(provider.models || []).includes(m) 
                                                  ? 'bg-primary border-primary' 
                                                  : 'bg-white dark:bg-transparent border-slate-300 dark:border-white/20'}
                                              `}>
                                                {(provider.models || []).includes(m) && (
                                                  <span className="material-symbols-outlined text-white text-[12px] font-bold">check</span>
                                                )}
                                              </div>
                                              <span className={`text-[10px] font-medium transition-colors ${(provider.models || []).includes(m) ? 'text-primary' : 'text-slate-600 dark:text-slate-400'}`}>
                                                {m}
                                              </span>
                                              <input 
                                                type="checkbox"
                                                className="hidden"
                                                checked={(provider.models || []).includes(m)}
                                                onChange={() => handleAIProviderChange(provider.id, 'models', m)}
                                              />
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            <button 
              onClick={handleAddAIProvider}
              className="w-full py-5 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-[24px] text-slate-400 hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all text-sm font-bold flex items-center justify-center gap-3 group"
            >
              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-all">
                <span className="material-symbols-outlined">add</span>
              </div>
              新增 AI 提供商配置
            </button>
          </div>
        </div>
      );
    }

    if (field.key === 'INTEROP_KEYS') {
      return (
        <div className="col-span-full space-y-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">已授权的 API Key</h4>
            <button 
              onClick={handleCreateApiKey}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all text-xs font-bold shadow-lg shadow-primary/20"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              手动新增 Key
            </button>
          </div>

          {newlyCreatedKey && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 bg-amber-50 dark:bg-amber-500/10 border-2 border-dashed border-amber-200 dark:border-amber-500/30 rounded-3xl space-y-4"
            >
              <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
                <span className="material-symbols-outlined font-bold">warning</span>
                <h5 className="font-bold">请立即保存您的 API Key</h5>
              </div>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/80">出于安全考虑，该 Key 仅显示一次。如果您丢失了它，将无法找回，只能重新生成。</p>
              <div className="flex items-center gap-3 bg-white dark:bg-black/20 p-4 rounded-xl border border-amber-200 dark:border-amber-500/20">
                <code className="flex-1 font-mono text-sm break-all select-all">{newlyCreatedKey.key}</code>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(newlyCreatedKey.key);
                    toastSuccess('已复制到剪贴板');
                  }}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors text-primary"
                  title="复制到剪贴板"
                >
                  <span className="material-symbols-outlined text-xl">content_copy</span>
                </button>
              </div>
              <button 
                onClick={() => setNewlyCreatedKey(null)}
                className="w-full py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition-colors"
              >
                我已保存，关闭提示
              </button>
            </motion.div>
          )}

          {apiKeys.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 dark:bg-white/[0.02] rounded-3xl border-2 border-dashed border-slate-200 dark:border-white/10">
              <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">key_off</span>
              <p className="text-slate-400 text-sm">暂无已授权的互联 API Key</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {apiKeys.map((keyRecord: any) => (
                <div key={keyRecord.id} className={`p-5 bg-white dark:bg-surface-dark border rounded-2xl shadow-sm flex items-center justify-between gap-4 transition-all ${keyRecord.status === 'active' ? 'border-slate-200 dark:border-white/5' : 'border-slate-100 dark:border-white/5 opacity-60 grayscale-[0.5]'}`}>
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${keyRecord.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-slate-500/10 text-slate-500'}`}>
                      <span className="material-symbols-outlined">
                        {keyRecord.status === 'active' ? 'vpn_key' : 'key_off'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <input 
                          type="text"
                          value={keyRecord.name}
                          onChange={(e) => {
                            // 仅用于本地显示，失去焦点或回车才触发更新
                            const newName = e.target.value;
                            setApiKeys(prev => prev.map(k => k.id === keyRecord.id ? { ...k, name: newName } : k));
                          }}
                          onBlur={(e) => handleUpdateApiKey(keyRecord.id, { name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleUpdateApiKey(keyRecord.id, { name: (e.target as HTMLInputElement).value });
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="font-bold text-slate-900 dark:text-white bg-transparent border-none p-0 focus:ring-0 text-sm truncate w-full max-w-[240px] hover:bg-slate-50 dark:hover:bg-white/5 rounded px-1 -ml-1 transition-colors cursor-text"
                          title="点击重命名"
                        />
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                          Prefix: <span className="bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">{keyRecord.prefix}</span>
                        </p>
                        <div className="flex items-center gap-1.5">
                          {keyRecord.status === 'active' ? (
                            <span className="px-1.5 py-0.5 bg-green-500/10 text-green-500 text-[9px] font-bold rounded uppercase">已启用</span>
                          ) : keyRecord.status === 'pending' ? (
                            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-500 text-[9px] font-bold rounded uppercase">待验证</span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-slate-500/10 text-slate-500 text-[9px] font-bold rounded uppercase">已禁用</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="hidden sm:block text-right mr-2">
                      <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">最后使用</div>
                      <div className="text-[10px] text-slate-600 dark:text-slate-300">
                        {keyRecord.lastUsedAt ? new Date(keyRecord.lastUsedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '从未使用'}
                      </div>
                    </div>
                    
                    <button 
                      onClick={() => handleUpdateApiKey(keyRecord.id, { status: keyRecord.status === 'active' ? 'disabled' : 'active' })}
                      className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${keyRecord.status === 'active' ? 'text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'text-primary hover:bg-primary/10'}`}
                      title={keyRecord.status === 'active' ? '禁用此 Key' : '启用/激活此 Key'}
                    >
                      <span className="material-symbols-outlined">
                        {keyRecord.status === 'active' ? 'pause_circle' : 'play_circle'}
                      </span>
                    </button>

                    <button 
                      onClick={() => handleDeleteApiKey(keyRecord.id)}
                      className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                      title="撤销此 Key (永久删除)"
                    >
                      <span className="material-symbols-outlined">delete_forever</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
            <div className="flex gap-3">
              <span className="material-symbols-outlined text-primary">info</span>
              <p className="text-xs text-primary/80 leading-relaxed">
                这里的 API Key 是由外部 AI 系统（如其他部署的流光实例）通过接入流程自动生成的。它们允许受信任的系统访问您的数据抓取、任务执行及技能系统。撤销后，对方将立即失去所有访问权限。
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (field.key === 'ADAPTERS') {
      const closedPlugins = settings.CLOSED_PLUGINS || [];
      const adapters = (settings.ADAPTERS || []).filter((a: any) => !closedPlugins.includes(a.adapterType));
      
      if (adapters.length === 0 && pluginMetadata.adapters.length === 0) {
        return <div className="col-span-full text-slate-400 text-xs italic p-4 bg-slate-50 dark:bg-white/5 rounded-xl">暂无可用适配器（插件已全部禁用）</div>;
      }

      return (
        <div className="col-span-full space-y-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">适配器列表</h4>
          </div>
          <div className="grid gap-6">
            {adapters.map((adapter: any, idx: number) => (
              <div 
                key={`${adapter.id}-${idx}`} 
                className={`
                  rounded-2xl border transition-all duration-300 overflow-hidden
                  ${adapter.enabled 
                    ? 'bg-white dark:bg-surface-dark border-primary/20 shadow-md shadow-primary/5' 
                    : 'bg-slate-50/50 dark:bg-white/[0.01] border-slate-200 dark:border-white/5 opacity-80'}
                `}
              >
                <div className={`
                  px-6 py-4 border-b flex flex-col gap-4 transition-colors
                  ${adapter.enabled 
                    ? 'bg-primary/5 border-primary/10 dark:bg-primary/5' 
                    : 'bg-slate-100/50 dark:bg-white/[0.03] border-slate-200 dark:border-white/5'}
                `}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`material-symbols-outlined ${adapter.enabled ? 'text-primary' : 'text-slate-400'}`}>
                        extension
                      </span>
                      <span className={`font-bold ${adapter.enabled ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>
                        {adapter.name}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-slate-200 dark:bg-white/10 rounded text-slate-600 dark:text-slate-400 font-mono">
                        {adapter.adapterType}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => handleMoveAdapter(adapter.id, 'up')}
                          disabled={idx === 0}
                          title="上移适配器组"
                          className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-primary hover:bg-primary/10 rounded-full transition-all disabled:opacity-10 disabled:cursor-not-allowed"
                        >
                          <span className="material-symbols-outlined text-xl">arrow_upward</span>
                        </button>
                        <button 
                          onClick={() => handleMoveAdapter(adapter.id, 'down')}
                          disabled={idx === adapters.length - 1}
                          title="下移适配器组"
                          className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-primary hover:bg-primary/10 rounded-full transition-all disabled:opacity-10 disabled:cursor-not-allowed"
                        >
                          <span className="material-symbols-outlined text-xl">arrow_downward</span>
                        </button>
                      </div>
                      <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-0.5"></div>
                      {adapter.adapterType === 'RSSAdapter' && (
                        <label className={`
                          flex items-center gap-2 px-3 py-1 bg-primary/10 text-primary hover:bg-primary hover:text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer
                          ${isImportingOPML ? 'opacity-50 cursor-not-allowed' : ''}
                        `}>
                          <span className="material-symbols-outlined text-sm">
                            {isImportingOPML ? 'hourglass_top' : 'upload_file'}
                          </span>
                          {isImportingOPML ? '正在解析...' : '导入 OPML'}
                          <input 
                            type="file" 
                            accept=".opml,.xml" 
                            className="hidden" 
                            onChange={handleImportOPML(adapter.id)}
                            disabled={isImportingOPML}
                          />
                        </label>
                      )}
                      <button 
                        onClick={() => handleDeleteAdapter(adapter.id)}
                        className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                        title="删除整个适配器组"
                      >
                        <span className="material-symbols-outlined text-xl">delete</span>
                      </button>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer"
                          checked={adapter.enabled}
                          onChange={(e) => handleAdapterChange(adapter.id, null, 'enabled', e.target.checked)}
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                      </label>
                    </div>
                  </div>
                  {adapter.enabled && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(() => {
                          const adapterMeta = pluginMetadata.adapters.find(a => a.type === adapter.adapterType);
                          return adapterMeta ? renderDynamicConfigFields(
                            adapterMeta.configFields || [],
                            adapter,
                            (key, value) => handleAdapterChange(adapter.id, null, key, value),
                            'adapter',
                            `adapter-${adapter.id}`
                          ) : null;
                        })()}
                      </div>
                    </div>
                  )}

                </div>
                
                {adapter.enabled && adapter.items && (
                  <div className="p-6 space-y-4">
                    {adapter.items.map((item: any, idx: number) => (
                      <div 
                        key={`${item.id}-${idx}`} 
                        className={`
                          group flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-xl border transition-all duration-200
                          ${item.enabled 
                            ? 'bg-white dark:bg-surface-darker border-slate-200 dark:border-white/10 shadow-sm' 
                            : 'bg-slate-50/30 dark:bg-black/10 border-slate-100 dark:border-white/5 opacity-60'}
                        `}
                      >
                        <div className="flex-1 space-y-4">
                          <div className="flex flex-wrap items-center gap-3">
                            <input 
                              type="text"
                              value={item.name}
                              onChange={(e) => handleAdapterChange(adapter.id, item.id, 'name', e.target.value)}
                              placeholder="数据项名称"
                              className={`font-semibold bg-transparent border-none p-0 focus:ring-0 min-w-[120px] flex-1 sm:flex-initial ${item.enabled ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}
                            />
                            <div className="flex flex-wrap items-center gap-3">
                              <select 
                                value={item.category || ''}
                                onChange={(e) => handleAdapterChange(adapter.id, item.id, 'category', e.target.value)}
                                className={`text-[10px] px-2 py-1 rounded-lg uppercase border-none focus:ring-0 cursor-pointer ${item.enabled ? 'bg-primary/10 text-primary' : 'bg-slate-200 dark:bg-white/10 text-slate-500'}`}
                              >
                                {(settings.CATEGORIES || []).map((cat: any) => (
                                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                                ))}
                              </select>

                              <div className="flex items-center gap-4">
                                <label className="flex items-center gap-1.5 cursor-pointer group">
                                  <input 
                                    type="checkbox"
                                    checked={item.useProxy ?? false}
                                    onChange={(e) => handleAdapterChange(adapter.id, item.id, 'useProxy', e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-slate-300 dark:border-white/20 text-primary focus:ring-primary/20 bg-transparent"
                                  />
                                  <span className="text-[10px] font-bold text-slate-400 group-hover:text-primary transition-colors uppercase tracking-wider">代理</span>
                                </label>

                                <label className="flex items-center gap-1.5 cursor-pointer group">
                                  <input 
                                    type="checkbox"
                                    checked={item.enableTranslation ?? false}
                                    onChange={(e) => handleAdapterChange(adapter.id, item.id, 'enableTranslation', e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-slate-300 dark:border-white/20 text-primary focus:ring-primary/20 bg-transparent"
                                  />
                                  <span className="text-[10px] font-bold text-slate-400 group-hover:text-primary transition-colors uppercase tracking-wider">翻译</span>
                                </label>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-4 items-end pt-2 border-t border-slate-100 dark:border-white/5">
                            {(() => {
                              const adapterMeta = pluginMetadata.adapters.find(a => a.type === adapter.adapterType);
                              return adapterMeta ? renderDynamicConfigFields(
                                adapterMeta.configFields || [],
                                item,
                                (key, value) => handleAdapterChange(adapter.id, item.id, key, value),
                                'item',
                                `item-${item.id}`
                              ) : null;
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center justify-between md:justify-end gap-6 pt-4 md:pt-0 border-t md:border-none border-slate-100 dark:border-white/5">
                          <div className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest">状态与操作</div>
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col gap-0">
                              <button 
                                onClick={() => handleMoveAdapterItem(adapter.id, item.id, 'up')}
                                disabled={idx === 0}
                                title="上移此项"
                                className="w-6 h-4 flex items-center justify-center text-slate-300 hover:text-primary transition-all disabled:opacity-10 disabled:cursor-not-allowed"
                              >
                                <span className="material-symbols-outlined text-base">expand_less</span>
                              </button>
                              <button 
                                onClick={() => handleMoveAdapterItem(adapter.id, item.id, 'down')}
                                disabled={idx === adapter.items.length - 1}
                                title="下移此项"
                                className="w-6 h-4 flex items-center justify-center text-slate-300 hover:text-primary transition-all disabled:opacity-10 disabled:cursor-not-allowed"
                              >
                                <span className="material-symbols-outlined text-base">expand_more</span>
                              </button>
                            </div>
                            <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-0.5"></div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={item.enabled}
                                onChange={(e) => handleAdapterChange(adapter.id, item.id, 'enabled', e.target.checked)}
                              />
                              <div className="w-10 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                            </label>
                            <button 
                              onClick={() => handleDeleteItem(adapter.id, item.id)}
                              className="w-9 h-9 inline-flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                              title="删除此项"
                            >
                              <span className="material-symbols-outlined text-xl">delete</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    <button 
                      onClick={() => handleAddItem(adapter.id)}
                      className="w-full py-3 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-xl text-slate-400 hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all text-sm font-medium flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-lg">add_circle</span>
                      添加子项数据源
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 p-6 bg-slate-50/50 dark:bg-white/[0.02] border-2 border-dashed border-slate-200 dark:border-white/10 rounded-2xl">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">新增适配器组：</div>
            <div className="flex flex-1 gap-2 w-full">
              <select 
                id="new-adapter-type"
                className="flex-1 px-4 py-2 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              >
                {pluginMetadata.adapters.map(meta => (
                  <option key={meta.type} value={meta.type}>{meta.name} ({meta.type})</option>
                ))}
              </select>
              <button 
                onClick={() => {
                  const select = document.getElementById('new-adapter-type') as HTMLSelectElement;
                  if (select) handleAddAdapter(select.value);
                }}
                className="px-6 py-2 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl shadow-md shadow-primary/20 transition-all active:scale-95 flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">add</span>
                添加
              </button>
            </div>
          </div>
        </div>
      );
    }


    if (field.key === 'CATEGORIES') {
      const categories = settings.CATEGORIES || [];
      return (
        <div className="col-span-full space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categories.map((cat: any, index: number) => (
              <div key={cat._tempId || index} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-white/[0.02] rounded-xl border border-slate-200 dark:border-white/5">
                <div className="flex flex-col gap-1">
                  <button 
                    onClick={() => handleMoveCategory(cat.id, 'up')}
                    disabled={index === 0}
                    title="上移"
                    className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-primary transition-all disabled:opacity-10 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-base">expand_less</span>
                  </button>
                  <button 
                    onClick={() => handleMoveCategory(cat.id, 'down')}
                    disabled={index === categories.length - 1}
                    title="下移"
                    className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-primary transition-all disabled:opacity-10 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-base">expand_more</span>
                  </button>
                </div>
                <div className="flex-1 space-y-4">
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">分类名称</label>
                      <input 
                        type="text"
                        value={cat.label}
                        onChange={(e) => handleCategoryChange(cat.id, 'label', e.target.value)}
                        className="w-full px-3 py-1.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-lg text-xs text-slate-900 dark:text-white focus:ring-1 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="w-24 space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">ID (英文)</label>
                      <input 
                        type="text"
                        value={cat.id}
                        onChange={(e) => handleCategoryChange(cat.id, 'id', e.target.value)}
                        className="w-full px-3 py-1.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-lg text-xs text-slate-500 font-mono focus:ring-1 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">图标名称</label>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setIconPickerState({ isOpen: true, catId: cat.id, currentIcon: cat.icon || 'label' })}
                        className="flex items-center justify-center w-10 h-10 rounded-lg bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 text-primary hover:border-primary/50 transition-all active:scale-95"
                        title="点击选择图标"
                      >
                        <span className="material-symbols-outlined text-xl">{cat.icon || 'label'}</span>
                      </button>
                      <input 
                        type="text"
                        value={cat.icon || ''}
                        placeholder="article, trending_up, etc."
                        onChange={(e) => handleCategoryChange(cat.id, 'icon', e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-lg text-xs text-slate-600 dark:text-slate-300 focus:ring-1 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                  </div>

                </div>
                <button 
                  onClick={() => handleDeleteCategory(cat.id)}
                  className="w-9 h-9 inline-flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                >
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </div>
            ))}
          </div>
          <button 
            onClick={handleAddCategory}
            className="w-full py-4 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-xl text-slate-400 hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all text-sm font-medium flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined">add_circle</span>
            添加新分类标签
          </button>
        </div>
      );
    }


    return (
      <div key={field.key} className="space-y-2.5">
        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {field.label}
        </label>
        {field.type === 'select' ? (
          <div className="relative">
            <select 
              value={currentValue ?? field.defaultValue}
              onChange={(e) => handleFieldChange(field.key!, e.target.value)}
              className="w-full appearance-none px-4 py-2.5 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-border-dark rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all cursor-pointer"
            >
              {field.options?.map((opt: any) => {
                const label = typeof opt === 'string' ? opt : opt.label;
                const value = typeof opt === 'string' ? opt : opt.value;
                return <option key={field.key + value} value={value}>{label}</option>;
              })}
            </select>
            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              expand_more
            </span>
          </div>
        ) : field.type === 'textarea' ? (

          <textarea
            rows={3}
            placeholder={(field as any).placeholder}
            value={currentValue || ''}
            onChange={(e) => handleFieldChange(field.key!, e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-border-dark rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"
          />
        ) : (
          <div className="relative">
            <input
              type={field.type === 'password' ? (showPasswords[field.key] ? 'text' : 'password') : field.type}
              placeholder={(field as any).placeholder}
              value={currentValue || ''}
              onChange={(e) => handleFieldChange(field.key!, field.type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)}
              className={`w-full px-4 py-2.5 bg-slate-50 dark:bg-surface-darker border border-slate-200 dark:border-border-dark rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all ${field.type === 'password' ? 'pr-12' : ''}`}
            />
            {field.type === 'password' && (
              <button
                type="button"
                onClick={() => setShowPasswords(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-lg">
                  {showPasswords[field.key] ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    );

  };

  const activeSections = sections.filter((section) => {
    if (!section) {
      return false;
    }

    return section.tab === activeTab || section.id === activeTab;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-slate-900 dark:text-white text-3xl font-bold tracking-tight mb-1">系统设置</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm">配置 AI 模型、存储密钥及系统运行参数</p>
      </div>

      {/* Tabs Navigation */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl w-full overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap
              ${activeTab === tab.id 
                ? 'bg-white dark:bg-white/10 text-primary shadow-sm' 
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}
            `}
          >
            <span className="material-symbols-outlined text-[20px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative min-height-[400px] space-y-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-8"
          >
            {activeSections.map((section) => {
              if (!section) {
                return null;
              }

              return (
              <div
                key={section.id}
                className="bg-white dark:bg-surface-dark rounded-2xl border border-slate-200 dark:border-white/5 overflow-hidden shadow-sm"
              >
                <div className="px-4 py-5 md:px-8 md:py-6 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{section.title}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">{section.description}</p>
                </div>
                
                <div className="p-4 md:p-8 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                    {section.fields.map((field) => (
                      <React.Fragment key={field.key}>
                        {renderField(field)}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex justify-end gap-4 pt-4">
        <button 
          onClick={loadSettings}
          className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 font-medium transition-colors"
        >
          重置修改
        </button>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="px-10 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? '正在保存...' : '保存配置'}
        </button>
      </div>

      <IconPicker 
        isOpen={iconPickerState.isOpen}
        currentIcon={iconPickerState.currentIcon}
        onClose={() => setIconPickerState({ ...iconPickerState, isOpen: false })}
        onSelect={handleIconSelect}
      />
    </div>
  );
};


export default Settings;

