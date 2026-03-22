import { LocalStore } from './LocalStore.js';
import { LogService } from './LogService.js';
import { ConfigService } from './ConfigService.js';
import { TaskService } from './TaskService.js';
import { AIService } from './AIService.js';
import { PromptService } from './PromptService.js';
import { SchedulerService } from './SchedulerService.js';
import { GeminiProvider, OpenAIProvider, AnthropicProvider, OllamaProvider, AIProvider, createAIProvider } from './AIProvider.js';
import { AgentService } from './agents/AgentService.js';
import { MCPService } from './agents/MCPService.js';
import { SkillStoreService } from './agents/SkillStoreService.js';

import { SkillService } from './agents/SkillService.js';
import { MemoryService } from './agents/MemoryService.js';
import { KnowledgeBaseService } from './knowledge/KnowledgeBaseService.js';
import { ToolRegistry } from '../registries/ToolRegistry.js';
import { WorkflowEngine } from './agents/WorkflowEngine.js';
import { ProxyAgent } from 'undici';
import { SystemSettings } from '../types/config.js';
import { initRegistries } from '../registries/PluginInit.js';
import { AdapterRegistry } from '../registries/AdapterRegistry.js';
import { PublisherRegistry } from '../registries/PublisherRegistry.js';
import { StorageRegistry } from '../registries/StorageRegistry.js';
import { IPublisher, IStorageProvider } from '../types/plugin.js';

import { TranslationService } from './TranslationService.js';
import { ImportService } from './ImportService.js';

export interface AppServices {
  settings: SystemSettings;
  configService: ConfigService;
  aiProvider: AIProvider | undefined;
  aiService: AIService | null;
  translationService: TranslationService;
  importService: ImportService;
  promptService: PromptService;
  taskService: TaskService;
  schedulerService: SchedulerService;
  agentService: AgentService | null;
  memoryService: MemoryService;
  knowledgeBaseService: KnowledgeBaseService;
  mcpService: MCPService;

  workflowEngine: WorkflowEngine | null;
  skillService: SkillService;
  skillStoreService: SkillStoreService;
  adapterInstances: any[];
  publisherInstances: IPublisher[];
  storageInstances: IStorageProvider[];
  proxyAgent?: ProxyAgent;
}

export async function initServices(store: LocalStore): Promise<AppServices> {
  // 0. Initialize Registries
  await initRegistries();

  // 0.1. Initialize Prompts
  const promptService = PromptService.getInstance();
  await promptService.loadTemplates();

  const configService = await ConfigService.getInstance(store);
  const settings = configService.getSettings();

  // 1. Initialize Proxy
  const proxyAgent = initProxyAgent(settings);

  // 2. Initialize AI Provider
  const aiProvider: AIProvider | undefined = initAIProvider(settings, proxyAgent);

  // 3. Initialize Core Services
  const aiService = aiProvider ? new AIService(aiProvider, settings) : null;
  const translationService = new TranslationService(aiProvider);
  const importService = new ImportService(store);

  // 4. Initialize Agent Ecosystem
  const skillService = new SkillService();
  await skillService.init();

  const skillStoreService = new SkillStoreService(settings.SKILL_STORE_API_KEY || '', proxyAgent);

  const toolRegistry = ToolRegistry.getInstance();
  for (const toolId of toolRegistry.getAll()) {
    const ToolClass = toolRegistry.get(toolId);
    const metadata = toolRegistry.getMetadata(toolId);
    if (ToolClass) {
      const instance = new (ToolClass as any)();
      if (metadata) {
        instance.isBuiltin = metadata.isBuiltin;
      }
      toolRegistry.registerTool(instance);
    }
  }

  const mcpService = new MCPService(proxyAgent);
  const agentService = aiProvider ? new AgentService(store, aiProvider, skillService, mcpService, proxyAgent) : null;
  const memoryService = new MemoryService(store, agentService);
  const knowledgeBaseService = new KnowledgeBaseService(store, agentService);
  
  // 根据配置切换记忆系统
  const memoryType = settings.MEMORY_SYSTEM_TYPE || 'hierarchical';
  await memoryService.switchSystem(memoryType);

  // 根据配置切换知识库系统
  const kbType = settings.KNOWLEDGE_SYSTEM_TYPE || 'hierarchical';
  await knowledgeBaseService.switchSystem(kbType);

  const workflowEngine = (agentService && aiProvider) ? new WorkflowEngine(store, agentService, aiProvider) : null;

  // 5. Initialize Adapters & Publishers & Storages
  const adapterInstances = initAdapters(settings, proxyAgent, translationService, agentService, workflowEngine);
  const publisherInstances = initPublishers(settings);
  const storageInstances = initStorages(settings);

  // 6. Initialize Task Service
  const taskService = new TaskService(adapterInstances, store, aiProvider, publisherInstances, settings);
  
  // 6.1. Initialize Scheduler Service (Now that WorkflowEngine exists)
  const schedulerService = new SchedulerService(store, taskService, agentService, workflowEngine, aiService);


  // 7. Seed Data
  if (agentService) {
    await seedDefaultAgents(store, agentService, settings);
    
    // 如果启用层级方案，执行记忆系统迁移 (如果需要)
    if (settings.MEMORY_SYSTEM_TYPE === 'hierarchical') {
      memoryService.migrateFromSqlite().catch(err => LogService.error(`Memory migration failed: ${err.message}`));
    }
  }

  // Seed Default Schedules if none exist
  await seedDefaultSchedules(store, adapterInstances);

  // Seed Default Skills from filesystem
  await seedDefaultSkills(store, skillService);

  // Restore status
  taskService.initStatus().catch(err => console.error('Failed to init task status:', err));
  
  // Start Scheduler
  schedulerService.init().catch(err => console.error('Failed to init scheduler:', err));

  return {
    settings,
    configService,
    aiProvider,
    aiService,
    translationService,
    importService,
    promptService,
    taskService,
    schedulerService,
    agentService,
    memoryService,
    knowledgeBaseService,
    mcpService,
    workflowEngine,
    skillService,
    skillStoreService,
    adapterInstances,
    publisherInstances,
    storageInstances,
    proxyAgent
  };
}


function initProxyAgent(settings: SystemSettings): ProxyAgent | undefined {
  if (settings.API_PROXY) {
    try {
      const agent = new ProxyAgent(settings.API_PROXY);
      console.log(`Proxy agent initialized with: ${settings.API_PROXY}`);
      return agent;
    } catch (e) {
      console.error('Failed to initialize proxy agent:', e);
    }
  }
  return undefined;
}

function initAIProvider(settings: SystemSettings, proxyAgent?: ProxyAgent) {
  const providers = settings.AI_PROVIDERS || [];
  const activeProviderConfig = providers.find((p: any) => p.id === settings.ACTIVE_AI_PROVIDER_ID);

  if (!activeProviderConfig) return undefined;

  const model = activeProviderConfig.models?.[0];
  const dispatcher = activeProviderConfig.useProxy === true ? proxyAgent : undefined;
  
  switch (activeProviderConfig.type) {
    case 'OPENAI':
      return new OpenAIProvider(activeProviderConfig.apiUrl, activeProviderConfig.apiKey, model, dispatcher);
    case 'CLAUDE':
      return new AnthropicProvider(activeProviderConfig.apiUrl, activeProviderConfig.apiKey, model, dispatcher);
    case 'OLLAMA':
      return new OllamaProvider(activeProviderConfig.apiUrl, model, dispatcher);
    case 'GEMINI':
      return new GeminiProvider(activeProviderConfig.apiUrl, activeProviderConfig.apiKey, model, dispatcher);
    default:
      return undefined;
  }
}

function initAdapters(settings: SystemSettings, proxyAgent?: ProxyAgent, translationService?: TranslationService, agentService?: AgentService | null, workflowEngine?: WorkflowEngine | null): any[] {
  const instances: any[] = [];
  const configs = settings.ADAPTERS || [];
  const registry = AdapterRegistry.getInstance();
  const closedPlugins = settings.CLOSED_PLUGINS || [];

  for (const config of configs) {
    if (!config.enabled) continue;

    // 检查适配器类型是否被禁用
    if (closedPlugins.includes(config.adapterType)) {
      console.log(`Adapter type ${config.adapterType} is disabled in CLOSED_PLUGINS, skipping`);
      continue;
    }

    const AdapterClass = registry.get(config.adapterType);
    if (!AdapterClass) {
      console.warn(`Adapter type ${config.adapterType} not found in registry`);
      continue;
    }

    for (const item of config.items) {
      if (!item.enabled) continue;
      try {
        // 动态实例化适配器
        // 统一构造函数参数：name, category, itemConfig
        const adapter = new (AdapterClass as any)(
          item.name, 
          item.category, 
          { ...item, fetchDays: config.fetchDays } // 合并全局配置到 itemConfig
        );

        // 注入依赖 (如果适配器需要)
        if (typeof (adapter as any).setAgentService === 'function' && agentService) {
          (adapter as any).setAgentService(agentService);
        }
        if (typeof (adapter as any).setWorkflowEngine === 'function' && workflowEngine) {
          (adapter as any).setWorkflowEngine(workflowEngine);
        }

        adapter.apiUrl = config.apiUrl;
        if (config.foloCookie) adapter.foloCookie = config.foloCookie;
        adapter.dispatcher = item.useProxy ? proxyAgent : undefined;
        
        // 注入翻译服务和翻译配置
        if (translationService) {
          adapter.translationService = translationService;
          adapter.enableTranslation = item.enableTranslation;
        }

        instances.push(adapter);
      } catch (e) {
        console.error(`Failed to init adapter ${item.name} of type ${config.adapterType}:`, e);
      }
    }
  }
  return instances;
}

function initPublishers(settings: SystemSettings): IPublisher[] {
  const instances: IPublisher[] = [];
  const registry = PublisherRegistry.getInstance();
  const configs = settings.PUBLISHERS || [];
  const closedPlugins = settings.CLOSED_PLUGINS || [];

  for (const pubConfig of configs) {
    if (!pubConfig.enabled) continue;

    // 检查发布器是否被禁用
    if (closedPlugins.includes(pubConfig.id)) {
      console.log(`Publisher ${pubConfig.id} is disabled in CLOSED_PLUGINS, skipping`);
      continue;
    }

    const PublisherClass = registry.get(pubConfig.id);
    if (PublisherClass) {
      try {
        instances.push(new PublisherClass(pubConfig.config));
      } catch (e) {
        console.error(`Failed to init publisher ${pubConfig.id}:`, e);
      }
    }
  }

  return instances;
}

function initStorages(settings: SystemSettings): IStorageProvider[] {
  const instances: IStorageProvider[] = [];
  const registry = StorageRegistry.getInstance();
  const configs = settings.STORAGES || [];
  const closedPlugins = settings.CLOSED_PLUGINS || [];

  for (const storageConfig of configs) {
    if (!storageConfig.enabled) continue;

    // 检查存储插件是否被禁用
    if (closedPlugins.includes(storageConfig.id)) {
      console.log(`Storage ${storageConfig.id} is disabled in CLOSED_PLUGINS, skipping`);
      continue;
    }

    const StorageClass = registry.get(storageConfig.id);
    if (StorageClass) {
      try {
        instances.push(new StorageClass(storageConfig.config));
      } catch (e) {
        console.error(`Failed to init storage ${storageConfig.id}:`, e);
      }
    }
  }

  return instances;
}

async function seedDefaultAgents(store: LocalStore, agentService: AgentService, settings: SystemSettings) {
  const agents = await store.listAgents();

  const activeProviderConfig = settings.AI_PROVIDERS.find(p => p.id === settings.ACTIVE_AI_PROVIDER_ID);
  const defaultModel = activeProviderConfig?.models?.[0] || '';

  if (!agents.find(a => a.id === 'default_summarizer')) {
    await store.saveAgent({
      id: 'default_summarizer',
      name: '基础摘要员',
      description: '负责生成每日资讯摘要',
      systemPrompt: '你是一个专业的科技博主，请根据提供的资讯内容生成简洁、有深度的每日摘要。',
      providerId: settings.ACTIVE_AI_PROVIDER_ID,
      model: defaultModel,
      temperature: 1.0,
      toolIds: [],
      skillIds: [],
      mcpServerIds: []
    });
  }

  if (!agents.find(a => a.id === 'ai_summary_agent')) {
    const aiSummaryPrompt = PromptService.getInstance().getPrompt('ai_summary_agent');
    await store.saveAgent({
      id: 'ai_summary_agent',
      name: 'AI内容主编',
      description: '负责将Markdown文本重塑为结构化的中文AI资讯摘要，并进行多维度打分。',
      systemPrompt: aiSummaryPrompt,
      providerId: settings.ACTIVE_AI_PROVIDER_ID,
      model: defaultModel,
      temperature: 0.7,
      toolIds: [],
      skillIds: [],
      mcpServerIds: []
    });
  }

  const memoryAssistant = agents.find(a => a.id === 'memory_assistant');
  if (!memoryAssistant) {
    await store.saveAgent({
      id: 'memory_assistant',
      name: '流光记忆助手',
      description: '一个拥有长期记忆能力的智能助手，能够通过渐进式披露回顾之前的对话内容。',
      systemPrompt: '你是一个拥有记忆能力的助手。请随时在对话中使用 `save_memory` 记录重要信息，并在需要时通过 `query_memory` 回顾。保持对话的连贯性和针对性。',
      providerId: settings.ACTIVE_AI_PROVIDER_ID,
      model: defaultModel,
      temperature: 0.7,
      toolIds: ['save_memory', 'query_memory'],
      skillIds: ['memory'],
      mcpServerIds: [],
      isHidden: true
    });
  } else if (!memoryAssistant.isHidden) {
    memoryAssistant.isHidden = true;
    await store.saveAgent(memoryAssistant);
  }

  const knowledgeAssistant = agents.find(a => a.id === 'knowledge_assistant');
  if (!knowledgeAssistant) {
    await store.saveAgent({
      id: 'knowledge_assistant',
      name: '知识库助手',
      description: '负责分析、分类和检索知识库中的专业文档（PDF, Word, Markdown）。',
      systemPrompt: `你是一个极度严谨的知识库管理助手。

你的核心原则：
1. **绝对忠实于文档**：在回答用户查询时，必须完全依赖 \`query_knowledge\` 工具返回的内容。
2. **禁止过度发挥**：如果工具返回的结果中没有相关信息，或者信息不足以回答用户的问题，你必须诚实地告知用户："抱歉，知识库中没有关于此问题的相关记录。"
3. **禁止使用内部知识**：严禁使用你自己的预训练知识来回答知识库中不存在的事实。
4. **时间敏感性**：注意查询中的时间范围（如"上周"）。如果检索到的文档日期不匹配，请明确指出。

你负责从用户上传的专业文档中提取核心信息，进行准确的总结和分类，并在用户查询时提供精准的知识检索。`,
      providerId: settings.ACTIVE_AI_PROVIDER_ID,
      model: defaultModel,
      temperature: 0.1,
      toolIds: ['query_knowledge'],
      skillIds: [],
      mcpServerIds: [],
      isHidden: true
    });
  } else if (!knowledgeAssistant.isHidden) {
    knowledgeAssistant.isHidden = true;
    await store.saveAgent(knowledgeAssistant);
  }
}

async function seedDefaultSchedules(store: LocalStore, adapters: any[]) {
  const existingSchedules = await store.listSchedules();
  if (existingSchedules.length > 0) return;

  console.log('Seeding default schedules...');

  // Create individual schedules for each adapter (initially disabled)
  for (const adapter of adapters) {
    await store.saveSchedule({
      id: `sync_${adapter.name}`,
      name: `${adapter.name} 定时同步`,
      cron: '30 9 * * *', 
      type: 'ADAPTER',
      targetId: adapter.name,
      enabled: false
    });
  }
}

async function seedDefaultSkills(store: LocalStore, skillService: SkillService) {
  const existingSkills = await store.listSkills();
  const fsSkills = skillService.listSkills();

  for (const skill of fsSkills) {
    if (!existingSkills.find(s => s.id === skill.id)) {
      console.log(`Seeding skill from filesystem: ${skill.name} (${skill.id})`);
      await store.saveSkill({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        files: [],
        dirPath: skill.dirPath,
        isBuiltin: true
      });
    }
  }
}
