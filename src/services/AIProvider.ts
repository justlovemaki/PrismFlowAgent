import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { 
  HumanMessage, 
  AIMessage as LangChainAIMessage, 
  SystemMessage, 
  ToolMessage, 
  BaseMessage 
} from "@langchain/core/messages";
import type { AIResponse, AIMessage } from '../types/index.js';

export interface AIProvider {
  name: string;
  dispatcher?: any;
  generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse>;
  streamContent?(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse>;
  listModels?(): Promise<string[]>;
}

/**
 * Maps our internal AIMessage to LangChain BaseMessage
 */
function toLangChainMessages(prompt: string | AIMessage[], systemInstruction?: string): BaseMessage[] {
  const messages: BaseMessage[] = [];
  if (systemInstruction) {
    messages.push(new SystemMessage(systemInstruction));
  }
  if (typeof prompt === 'string') {
    messages.push(new HumanMessage(prompt));
  } else {
    for (const m of prompt) {
      switch (m.role) {
        case 'system':
          messages.push(new SystemMessage(m.content || ''));
          break;
        case 'user':
          messages.push(new HumanMessage(m.content || ''));
          break;
        case 'assistant':
          messages.push(new LangChainAIMessage({
            content: m.content || '',
            tool_calls: m.tool_calls?.map(tc => ({
              id: tc.id,
              name: tc.name,
              args: tc.arguments
            }))
          }));
          break;
        case 'tool':
          messages.push(new ToolMessage({
            content: m.content || '',
            tool_call_id: m.tool_call_id || '',
            name: m.name
          }));
          break;
      }
    }
  }
  return messages;
}

/**
 * Maps LangChain BaseMessage to our internal AIResponse
 */
function fromLangChainMessage(message: BaseMessage | any): AIResponse {
  // Handle content which can be string or array of parts
  let content = '';
  if (typeof message.content === 'string') {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    content = message.content
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('');
  }

  const tool_calls = (message as LangChainAIMessage).tool_calls?.map(tc => ({
    id: tc.id || '',
    name: tc.name,
    arguments: tc.args
  }));
  
  const result: AIResponse = { content };
  if (tool_calls && tool_calls.length > 0) {
    result.tool_calls = tool_calls;
  }
  
  // Usage tracking
  if (message.usage_metadata) {
    result.usage = {
      prompt_tokens: message.usage_metadata.input_tokens || 0,
      completion_tokens: message.usage_metadata.output_tokens || 0,
      total_tokens: message.usage_metadata.total_tokens || 0
    };
  } else {
    const metadata = message.response_metadata;
    if (metadata && (metadata.tokenUsage || metadata.usage)) {
      const usage = metadata.tokenUsage || metadata.usage;
      result.usage = {
        prompt_tokens: usage.promptTokens || usage.prompt_tokens || usage.input_tokens || 0,
        completion_tokens: usage.completionTokens || usage.completion_tokens || usage.output_tokens || 0,
        total_tokens: usage.totalTokens || usage.total_tokens || 0
      };
    }
  }

  // Preserve raw parts if available (common in Google GenAI)
  if (message.response_metadata?.rawResponse?.candidates?.[0]?.content?.parts) {
    result.raw_parts = message.response_metadata.rawResponse.candidates[0].content.parts;
  }

  return result;
}

const getCustomFetch = (name: string, dispatcher?: any) => {
  return async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === 'string' ? input : (input.url || input.toString());
    console.log(`[${name}] API Request: ${url}, Using Proxy: ${!!dispatcher}`);
    try {
      const res = await fetch(input, { ...init, dispatcher } as any);
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'No error text');
        console.error(`[${name}] API Error: ${res.status} ${errorText}`);
      }
      return res;
    } catch (err: any) {
      console.error(`[${name}] Fetch Failed: ${err.message}`);
      throw err;
    }
  };
};

function normalizeTools(tools?: any[]): any[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => {
    if (tool && typeof tool === 'object' && 'name' in tool && 'parameters' in tool) {
      return {
        name: tool.name,
        description: tool.description || '',
        schema: tool.parameters
      };
    }

    return tool;
  });
}

export class GeminiProvider implements AIProvider {
  name = 'Gemini';
  private apiUrl: string;
  private apiKey: string;
  private model: string;
  public dispatcher?: any;

  constructor(apiUrl: string, apiKey: string, model: string, dispatcher?: any) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.dispatcher = dispatcher;
    console.log(`[Gemini] Initialized with apiUrl: ${apiUrl}, model: ${model}, proxy: ${!!dispatcher}`);
  }

  private getLLM(tools?: any[]) {
    const llm = new ChatGoogleGenerativeAI({
      apiKey: this.apiKey,
      model: this.model,
      baseUrl: this.apiUrl || undefined,
    });

    const geminiBuiltinTools = [
      { google_search: {} },
      { googleMaps: {} },
      { url_context: {} }
    ];
    const customTools = normalizeTools(tools) || [];

    return llm.bindTools([
      ...geminiBuiltinTools,
      ...customTools
    ] as any);
  }

  private toGeminiInput(prompt: string | AIMessage[], systemInstruction?: string): string | BaseMessage[] {
    if (typeof prompt === 'string') {
      return toLangChainMessages(prompt, systemInstruction);
    }

    const transcript: string[] = [];
    if (systemInstruction) {
      transcript.push(`System: ${systemInstruction}`);
    }

    for (const message of prompt) {
      if (message.role === 'system') {
        transcript.push(`System: ${message.content || ''}`);
        continue;
      }

      if (message.role === 'assistant') {
        const toolCallsText = (message.tool_calls || [])
          .map((toolCall: any) => `ToolCall ${toolCall.name}: ${JSON.stringify(toolCall.arguments || {})}`)
          .join('\n');
        transcript.push(`Assistant: ${message.content || ''}${toolCallsText ? `\n${toolCallsText}` : ''}`);
        continue;
      }

      if (message.role === 'tool') {
        transcript.push(`Tool ${message.name || message.tool_call_id || 'unknown'} Result: ${message.content || ''}`);
        continue;
      }

      transcript.push(`User: ${message.content || ''}`);
    }

    return transcript.join('\n\n');
  }

  async generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const input = this.toGeminiInput(prompt, systemInstruction);
    const res = await this.getLLM(tools).invoke(input as any);
    return fromLangChainMessage(res);
  }

  async *streamContent(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse> {
    const input = this.toGeminiInput(prompt, systemInstruction);
    const stream = await this.getLLM(tools).stream(input as any);
    for await (const chunk of stream) {
      yield fromLangChainMessage(chunk);
    }
  }

  async listModels(): Promise<string[]> {
    const url = `${this.apiUrl}/v1beta/models?key=${this.apiKey}`;
    const response = await fetch(url, { dispatcher: this.dispatcher } as any);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }
    const data = await response.json() as any;
    return (data.models || [])
      .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => m.name.replace('models/', ''));
  }
}

export class OpenAIProvider implements AIProvider {
  name = 'OpenAI';
  private apiUrl: string;
  private apiKey: string;
  private model: string;
  public dispatcher?: any;

  constructor(apiUrl: string, apiKey: string, model: string, dispatcher?: any) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.dispatcher = dispatcher;
    console.log(`[OpenAI] Initialized with apiUrl: ${apiUrl}, model: ${model}, proxy: ${!!dispatcher}`);
  }

  private getLLM(tools?: any[]) {
    // OpenAI SDK expects baseURL to point to the base of the API (usually including /v1)
    const baseURL = this.apiUrl.endsWith('/v1') ? this.apiUrl : `${this.apiUrl.replace(/\/$/, '')}/v1`;
    const llm = new ChatOpenAI({
      apiKey: this.apiKey,
      model: this.model,
      configuration: {
        baseURL: baseURL,
        fetch: getCustomFetch('OpenAI', this.dispatcher)
      }
    });

    if (tools && tools.length > 0) {
      return llm.bindTools(normalizeTools(tools)!);
    }
    return llm;
  }

  async generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const messages = toLangChainMessages(prompt, systemInstruction);
    const res = await this.getLLM(tools).invoke(messages);
    return fromLangChainMessage(res);
  }

  async *streamContent(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse> {
    const messages = toLangChainMessages(prompt, systemInstruction);
    const stream = await this.getLLM(tools).stream(messages);
    for await (const chunk of stream) {
      yield fromLangChainMessage(chunk);
    }
  }

  async listModels(): Promise<string[]> {
    const url = `${this.apiUrl}/v1/models`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      dispatcher: this.dispatcher
    } as any);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }
    const data = await response.json() as any;
    return (data.data || []).map((m: any) => m.id).sort();
  }
}

export class AnthropicProvider implements AIProvider {
  name = 'Anthropic';
  private apiUrl: string;
  private apiKey: string;
  private model: string;
  public dispatcher?: any;

  constructor(apiUrl: string, apiKey: string, model: string, dispatcher?: any) {
    this.apiUrl = apiUrl || 'https://api.anthropic.com';
    this.apiKey = apiKey;
    this.model = model;
    this.dispatcher = dispatcher;
    console.log(`[Anthropic] Initialized with apiUrl: ${this.apiUrl}, model: ${model}, proxy: ${!!dispatcher}`);
  }

  private getLLM(tools?: any[]) {
    const llm = new ChatAnthropic({
      anthropicApiKey: this.apiKey,
      model: this.model,
      clientOptions: {
        baseURL: this.apiUrl,
        fetch: getCustomFetch('Anthropic', this.dispatcher)
      }
    });

    if (tools && tools.length > 0) {
      return llm.bindTools(normalizeTools(tools)!);
    }
    return llm;
  }

  async generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const messages = toLangChainMessages(prompt, systemInstruction);
    const res = await this.getLLM(tools).invoke(messages);
    return fromLangChainMessage(res);
  }

  async *streamContent(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse> {
    const messages = toLangChainMessages(prompt, systemInstruction);
    const stream = await this.getLLM(tools).stream(messages);
    for await (const chunk of stream) {
      yield fromLangChainMessage(chunk);
    }
  }

  async listModels(): Promise<string[]> {
    const url = `${this.apiUrl}/v1/models`;
    const response = await fetch(url, {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      dispatcher: this.dispatcher
    } as any);
    if (!response.ok) {
      return [];
    }
    const data = await response.json() as any;
    return (data.data || []).map((m: any) => m.id);
  }
}

export class OllamaProvider implements AIProvider {
  name = 'Ollama';
  private apiUrl: string;
  private model: string;
  public dispatcher?: any;

  constructor(apiUrl: string, model: string, dispatcher?: any) {
    this.apiUrl = apiUrl.replace(/\/$/, '') || 'http://localhost:11434';
    this.model = model;
    this.dispatcher = dispatcher;
    console.log(`[Ollama] Initialized with apiUrl: ${this.apiUrl}, model: ${model}, proxy: ${!!dispatcher}`);
  }

  private getLLM(tools?: any[]) {
    const llm = new ChatOllama({
      baseUrl: this.apiUrl,
      model: this.model,
    });

    if (tools && tools.length > 0) {
      return llm.bindTools(normalizeTools(tools)!);
    }
    return llm;
  }

  async generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const messages = toLangChainMessages(prompt, systemInstruction);
    const res = await this.getLLM(tools).invoke(messages);
    return fromLangChainMessage(res);
  }

  async *streamContent(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse> {
    const messages = toLangChainMessages(prompt, systemInstruction);
    const stream = await this.getLLM(tools).stream(messages);
    for await (const chunk of stream) {
      yield fromLangChainMessage(chunk);
    }
  }

  async listModels(): Promise<string[]> {
    const url = `${this.apiUrl}/api/tags`;
    const response = await fetch(url, { dispatcher: this.dispatcher } as any);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama error: ${response.status} ${errorText}`);
    }
    const data = await response.json() as any;
    return (data.models || []).map((m: any) => m.name);
  }
}

export function createAIProvider(config: any, dispatcher?: any): AIProvider | null {
  if (!config) return null;
  const model = config.model || config.models?.[0];
  
  switch (config.type) {
    case 'OPENAI':
      return new OpenAIProvider(config.apiUrl, config.apiKey, model, dispatcher);
    case 'CLAUDE':
      return new AnthropicProvider(config.apiUrl, config.apiKey, model, dispatcher);
    case 'OLLAMA':
      return new OllamaProvider(config.apiUrl, model, dispatcher);
    case 'GEMINI':
      return new GeminiProvider(config.apiUrl, config.apiKey, model, dispatcher);
    default:
      return null;
  }
}
