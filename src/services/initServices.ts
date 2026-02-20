import { LocalStore } from './LocalStore.js';
import { ConfigService } from './ConfigService.js';
import { TaskService } from './TaskService.js';
import { AIService } from './AIService.js';
import { ImageService } from './ImageService.js';
import { PromptService } from './PromptService.js';
import { GeminiProvider, OpenAIProvider, AnthropicProvider, OllamaProvider, AIProvider } from './AIProvider.js';
import { AgentService } from './agents/AgentService.js';
import { SkillService } from './agents/SkillService.js';
import { ToolRegistry } from './agents/ToolRegistry.js';
import { WorkflowEngine } from './agents/WorkflowEngine.js';
import { ProxyAgent } from 'undici';
import { SystemSettings } from '../types/config.js';
import { initRegistries } from '../registries/PluginInit.js';
import { AdapterRegistry } from '../registries/AdapterRegistry.js';
import { PublisherRegistry } from '../registries/PublisherRegistry.js';
import { StorageRegistry } from '../registries/StorageRegistry.js';
import { IPublisher, IStorageProvider } from '../types/plugin.js';

export interface AppServices {
  settings: SystemSettings;
  configService: ConfigService;
  aiProvider: AIProvider | undefined;
  aiService: AIService | null;
  promptService: PromptService;
  imageService: ImageService;
  taskService: TaskService;
  agentService: AgentService | null;
  workflowEngine: WorkflowEngine | null;
  skillService: SkillService;
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
  const imageService = new ImageService();

  // 4. Initialize Adapters & Publishers & Storages
  const adapterInstances = initAdapters(settings, proxyAgent);
  const publisherInstances = initPublishers(settings);
  const storageInstances = initStorages(settings);

  // 5. Initialize Task Service
  const taskService = new TaskService(adapterInstances, store, aiProvider, publisherInstances);
  
  // 6. Initialize Agent Ecosystem
  const skillService = new SkillService();
  await skillService.init();

  // Initialize Tool Registry from Global Registry
  const { ToolRegistry: GlobalToolRegistry } = await import('../registries/ToolRegistry.js');
  const toolRegistry = ToolRegistry.getInstance();
  const globalToolRegistry = GlobalToolRegistry.getInstance();
  for (const toolId of globalToolRegistry.getAll()) {
    const ToolClass = globalToolRegistry.get(toolId);
    if (ToolClass) {
      toolRegistry.registerTool(new (ToolClass as any)());
    }
  }

  const agentService = aiProvider ? new AgentService(store, aiProvider, skillService, proxyAgent) : null;
  const workflowEngine = (agentService && aiProvider) ? new WorkflowEngine(store, agentService, aiProvider) : null;

  // 7. Seed Data
  if (agentService) {
    await seedDefaultAgents(store, agentService, settings);
  }

  // Restore status
  taskService.initStatus().catch(err => console.error('Failed to init task status:', err));

  return {
    settings,
    configService,
    aiProvider,
    aiService,
    promptService,
    imageService,
    taskService,
    agentService,
    workflowEngine,
    skillService,
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

function initAdapters(settings: SystemSettings, proxyAgent?: ProxyAgent): any[] {
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
        // 构造函数参数：name, category, ...其他字段
        // 由于不同适配器构造函数签名可能不同，这里通过 config 对象传递更灵活
        // 但为了兼容现有实现，我们尝试映射参数
        let adapter: any;
        if (config.adapterType === 'GitHubTrendingAdapter') {
          adapter = new (AdapterClass as any)(item.name, item.category || 'githubTrending', item.since || 'daily');
        } else if (config.adapterType === 'FollowApiAdapter') {
          adapter = new (AdapterClass as any)(
            item.name, 
            item.category || 'news', 
            item.listId || '', 
            item.feedId,
            config.fetchDays || 3,
            item.fetchPages || 1
          );
        } else {
          // 通用实例化逻辑：尝试传入 item 配置对象
          adapter = new (AdapterClass as any)(item.name, item.category, item);
        }

        adapter.apiUrl = config.apiUrl;
        if (config.foloCookie) adapter.foloCookie = config.foloCookie;
        adapter.dispatcher = item.useProxy ? proxyAgent : undefined;
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
  if (agents.length > 0) return;

  const activeProviderConfig = settings.AI_PROVIDERS.find(p => p.id === settings.ACTIVE_AI_PROVIDER_ID);
  const defaultModel = activeProviderConfig?.models?.[0] || '';

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
