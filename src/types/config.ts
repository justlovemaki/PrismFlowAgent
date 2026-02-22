export interface AIProviderConfig {
  id: string;
  name: string;
  type: 'GEMINI' | 'CLAUDE' | 'OPENAI' | 'OLLAMA';
  apiUrl: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
  useProxy: boolean;
}

export interface ImageProcessConfig {
  CONVERT_IMAGES: boolean;
  AVIF_QUALITY: number;
  AVIF_EFFORT: number;
  CONVERT_VIDEOS: boolean;
  VIDEO_CRF: number;
  VIDEO_PRESET: string;
  MAX_VIDEO_SIZE_MB: number;
  TYPEID_PREFIX: string;
}

export interface AdapterItemConfig {
  id: string;
  name: string;
  enabled: boolean;
  useProxy: boolean;
  category?: string;
  since?: string;
  listId?: string;
  feedId?: string;
  fetchPages?: number;
  enableTranslation?: boolean;
}

export interface AdapterConfig {
  id: string;
  name: string;
  category?: string;
  adapterType: 'GitHubTrendingAdapter' | 'FollowApiAdapter';
  enabled: boolean;
  apiUrl: string;
  fetchDays?: number;
  foloCookie?: string;
  items: AdapterItemConfig[];
}

export interface PublisherConfig {
  id: string;
  enabled: boolean;
  config: Record<string, any>;
}

export interface StorageConfig {
  id: string;
  enabled: boolean;
  config: Record<string, any>;
}

export interface CategoryConfig {
  id: string;
  label: string;
  icon: string;
}

export interface SystemSettings {
  ACTIVE_AI_PROVIDER_ID: string;
  AI_PROVIDERS: AIProviderConfig[];
  PUBLISHERS: PublisherConfig[];
  STORAGES: StorageConfig[];
  SYSTEM_PASSWORD?: string;
  AUTH_EXPIRE_TIME: string;
  API_PROXY: string;
  IMAGE_PROXY: string;
  IMAGE_PROCESS_CONFIG: ImageProcessConfig;
  ADAPTERS: AdapterConfig[];
  CLOSED_PLUGINS?: string[];
  CATEGORIES: CategoryConfig[];
  [key: string]: any; // Allow for dynamic extension
}
