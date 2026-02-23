export interface UnifiedData {
  id: string;
  title: string;
  url: string;
  description: string;
  published_date: string;
  source: string;
  category: string;
  author?: string;
  status?: string;
  metadata?: Record<string, any> & {
    tags?: string[];
    ai_summary?: string;
    ai_score?: number;
  };
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

export interface AIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface StoreOptions {
  expirationTtl?: number;
}
