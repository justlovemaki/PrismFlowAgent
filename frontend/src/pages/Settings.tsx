import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSettings, saveSettings, getModels, getPluginMetadata } from '../services/settingsService';
import IconPicker from '../components/UI/IconPicker';
import { useToast } from '../context/ToastContext.js';

const Settings: React.FC = () => {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const [activeTab, setActiveTab] = useState('ai');
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [pluginMetadata, setPluginMetadata] = useState<{ adapters: any[], publishers: any[], storages: any[], aiProviders: any[] }>({ adapters: [], publishers: [], storages: [], aiProviders: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [isFetchingModels, setIsFetchingModels] = useState<Record<string, boolean>>({});
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});


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
      const [data, metadata] = await Promise.all([
        getSettings(),
        getPluginMetadata()
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
      await saveSettings(settings);
      toastSuccess('配置保存成功！');
    } catch (error) {
      console.error('Failed to save settings:', error);
      toastError('保存配置失败，请检查网络或控制台。');
    } finally {
      setIsSaving(false);
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


  const tabs = [
    ...(pluginMetadata.aiProviders.length > 0 ? [{ id: 'ai', label: 'AI 模型', icon: 'psychology' }] : []),
    ...(pluginMetadata.publishers.length > 0 || pluginMetadata.storages.length > 0 ? [{ id: 'publishers', label: '发布与存储', icon: 'send' }] : []),
    { id: 'media', label: '媒体处理', icon: 'auto_fix_high' },
    ...(pluginMetadata.adapters.length > 0 ? [{ id: 'sources', label: '数据源管理', icon: 'database' }] : []),
    { id: 'categories', label: '分类管理', icon: 'label' },
    { id: 'network', label: '网络设置', icon: 'language' },
    { id: 'security', label: '安全', icon: 'security' },
  ];

  const sections = [
    {
      id: 'ai',
      title: 'AI 模型配置',
      description: '配置 AI 平台、模型参数及翻译功能',
      fields: [
        { label: '生效 AI 提供商', key: 'ACTIVE_AI_PROVIDER_ID', type: 'select', 
          options: (settings.AI_PROVIDERS || [])
            .filter((p: any) => !(settings.CLOSED_PLUGINS || []).includes(p.id))
            .map((p: any) => ({ label: p.name, value: p.id })), 
          defaultValue: 'default-gemini' 
        },
        { label: '开启自动翻译', key: 'TRANSLATE_ENABLED', type: 'select', options: ['true', 'false'], defaultValue: 'true' },
        { label: 'AI 提供商列表', key: 'AI_PROVIDERS', type: 'custom' },
      ]
    },

    {
      id: 'publishers',
      title: '发布与存储管理',
      description: '配置内容分发平台及图片/视频存储插件',
      fields: [
        { label: '发布渠道列表', key: 'PUBLISHERS', type: 'custom' },
        { label: '存储插件配置', key: 'STORAGES', type: 'custom' },
      ]
    },

    {
      id: 'media',
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
      id: 'sources',
      title: '数据源管理',
      description: '管理数据适配器及其子数据源项',
      fields: [
        { label: '定时任务抓取频率', key: 'FETCH_INTERVAL', type: 'select', options: ['每小时', '每 4 小时', '每天', '手动'], defaultValue: '每天' },
        { label: '适配器配置', key: 'ADAPTERS', type: 'custom' },
      ]
    },
    {
      id: 'categories',
      title: '分类标签管理',
      description: '管理全局分类标签，用于数据源归类',
      fields: [
        { label: '分类配置', key: 'CATEGORIES', type: 'custom' },
      ]
    },
    {
      id: 'network',
      title: '网络与代理设置',
      description: '配置接口代理与图片代理，解决访问限制问题',
      fields: [
        { label: 'API 接口代理', key: 'API_PROXY', type: 'text', placeholder: '例如: http://127.0.0.1:7890' },
        { label: '图片代理模板', key: 'IMAGE_PROXY', type: 'text', placeholder: '例如: https://i0.wp.com/{url} 或 /api/proxy/image?url={url}' },
      ]
    },
    {
      id: 'security',
      title: '安全设置',
      description: '管理系统访问权限与密码',
      fields: [
        { label: '系统访问密码', key: 'SYSTEM_PASSWORD', type: 'password', placeholder: '在此设置新的系统密码' },
        { label: '登录过期时间', key: 'AUTH_EXPIRE_TIME', type: 'text', placeholder: '例如: 7d, 24h, 1h' },
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

      return (
        <div key={field.key} className="space-y-1.5 flex-1 min-w-[150px]">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          {field.type === 'select' ? (
            <select
              value={currentValues[field.key] ?? field.default ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              className="w-full px-3 py-1.5 bg-white dark:bg-surface-dark border border-slate-200 dark:border-white/5 rounded-lg text-xs text-slate-600 dark:text-slate-300 focus:ring-1 focus:ring-primary outline-none transition-all"
            >
              {field.options?.map((opt: any) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <div className="relative">
              <input
                type={isPassword ? (showPassword ? 'text' : 'password') : (field.type === 'number' ? 'number' : 'text')}
                value={currentValues[field.key] ?? field.default ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange(field.key, field.type === 'number' ? (val === '' ? 0 : parseInt(val)) : val);
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
            {providers.map((provider: any) => {
              const isActive = settings.ACTIVE_AI_PROVIDER_ID === provider.id;
              const isExpanded = expandedProviders[provider.id] ?? isActive;
              
              return (
                <div 
                  key={provider.id} 
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
                      {isActive ? (
                        <span className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 text-green-500 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                          Active
                        </span>
                      ) : (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFieldChange('ACTIVE_AI_PROVIDER_ID', provider.id);
                          }}
                          className="text-[10px] px-3 py-1 bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-primary hover:text-white rounded-full font-bold uppercase tracking-wider transition-all"
                        >
                          设为默认
                        </button>
                      )}
                      <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1"></div>
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
                                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] ml-1">API Endpoint</label>
                                  <input 
                                    type="text"
                                    value={provider.apiUrl || ''}
                                    onChange={(e) => handleAIProviderChange(provider.id, 'apiUrl', e.target.value)}
                                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 rounded-xl text-xs text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-mono"
                                  />
                                </div>
                                
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] ml-1">Access Token / Key</label>
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
            {adapters.map((adapter: any) => (
              <div 
                key={adapter.id} 
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
                    {adapter.items.map((item: any) => (
                      <div 
                        key={item.id} 
                        className={`
                          group flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-xl border transition-all duration-200
                          ${item.enabled 
                            ? 'bg-white dark:bg-surface-darker border-slate-200 dark:border-white/10 shadow-sm' 
                            : 'bg-slate-50/30 dark:bg-black/10 border-slate-100 dark:border-white/5 opacity-60'}
                        `}
                      >
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-3">
                            <input 
                              type="text"
                              value={item.name}
                              onChange={(e) => handleAdapterChange(adapter.id, item.id, 'name', e.target.value)}
                              className={`font-semibold bg-transparent border-none p-0 focus:ring-0 w-24 ${item.enabled ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}
                            />
                             <select 
                                value={item.category || ''}
                                onChange={(e) => handleAdapterChange(adapter.id, item.id, 'category', e.target.value)}
                                className={`text-[10px] px-1.5 py-0.5 rounded uppercase border-none focus:ring-0 cursor-pointer ${item.enabled ? 'bg-primary/10 text-primary' : 'bg-slate-200 dark:bg-white/10 text-slate-500'}`}
                              >
                                {(settings.CATEGORIES || []).map((cat: any) => (
                                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                                ))}
                              </select>

                            <label className="flex items-center gap-1.5 cursor-pointer group">
                              <input 
                                type="checkbox"
                                checked={item.useProxy ?? false}
                                onChange={(e) => handleAdapterChange(adapter.id, item.id, 'useProxy', e.target.checked)}
                                className="w-3 h-3 rounded border-slate-300 dark:border-white/20 text-primary focus:ring-primary/20 bg-transparent"
                              />
                              <span className="text-[9px] font-bold text-slate-400 group-hover:text-primary transition-colors uppercase tracking-wider">代理</span>
                            </label>
                          </div>
                          <div className="flex flex-wrap gap-4 items-end">
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
                        <div className="flex items-center gap-4">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              className="sr-only peer"
                              checked={item.enabled}
                              onChange={(e) => handleAdapterChange(adapter.id, item.id, 'enabled', e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                          </label>
                          <button 
                            onClick={() => handleDeleteItem(adapter.id, item.id)}
                            className="w-8 h-8 inline-flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full transition-all"
                          >
                            <span className="material-symbols-outlined text-lg">delete</span>
                          </button>
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
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">图标 (Material Icon Name)</label>
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

  const activeSection = sections.find(s => s.id === activeTab) || sections[0];

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
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl w-fit">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
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

      <div className="relative min-height-[400px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-surface-dark rounded-2xl border border-slate-200 dark:border-white/5 overflow-hidden shadow-sm"
          >
            <div className="px-8 py-6 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{activeSection.title}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm">{activeSection.description}</p>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {activeSection.fields.map((field) => (
                  <React.Fragment key={field.key}>
                    {renderField(field)}
                  </React.Fragment>
                ))}
              </div>
            </div>
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

