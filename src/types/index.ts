export interface UnifiedData {
  id: string;
  title: string;
  url: string;
  description: string;
  published_date: string;
  source: string;
  category: string;
  author?: string;
  tags?: string[];
  ai_summary?: string; // AI 处理后的摘要或评论
  metadata?: Record<string, any>;
}


export interface DataCategory {
  id: string;
  name: string;
}

export interface AIResponse {
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: any;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StoreOptions {
  expirationTtl?: number;
}
