import type { UnifiedData, AIResponse, AIMessage } from '../types/index.js';

export interface AIProvider {
  name: string;
  dispatcher?: any;
  generateContent(prompt: string, systemInstruction?: string): Promise<AIResponse>;
  generateWithTools(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse>;
  streamContent?(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse>;
  listModels?(): Promise<string[]>;
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
  }

  async generateContent(prompt: string, systemInstruction?: string): Promise<AIResponse> {
    const url = `${this.apiUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    console.log(`[Gemini] API Request: ${url}, Using Proxy: ${!!this.dispatcher}`);
    const payload: any = {
      contents: [{ parts: [{ text: prompt }] }],
    };
    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as any;
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const result: AIResponse = { content };
    if (data.usageMetadata) {
      result.usage = {
        prompt_tokens: data.usageMetadata.promptTokenCount,
        completion_tokens: data.usageMetadata.candidatesTokenCount,
        total_tokens: data.usageMetadata.totalTokenCount
      };
    }
    return result;
  }

  async generateWithTools(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const url = `${this.apiUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    console.log(`[Gemini] API Request (Tools): ${url}, Using Proxy: ${!!this.dispatcher}`);
    
    let contents: any[] = [];
    if (Array.isArray(prompt)) {
      contents = prompt.map(m => {
        // If we have raw parts (e.g. from a previous Gemini response), use them directly
        // This is crucial for preserving thinking process and signatures
        if (m.raw_parts && (m.role === 'assistant' || m.role === 'user')) {
          return {
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: m.raw_parts
          };
        }

        const parts: any[] = [];
        if (m.content) {
          parts.push({ text: m.content });
        }
        if (m.tool_calls) {
          m.tool_calls.forEach(tc => {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments
              }
            });
          });
        }
        if (m.role === 'tool') {
          return {
            role: 'function',
            parts: [{
              functionResponse: {
                name: m.name,
                response: { content: m.content }
              }
            }]
          };
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts
        };
      });
    } else {
      contents = [{ parts: [{ text: prompt }] }];
    }

    const payload: any = {
      contents,
      tools: [
        { google_search: {} },
        { googleMaps: {} },
        { url_context: {} }
      ]
    };

    if (tools && tools.length > 0) {
      payload.tools.push({
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      });
      payload.toolConfig = {
        functionCallingConfig: {
          mode: 'AUTO'
        }
      };
    }

    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as any;
    const parts = data.candidates?.[0]?.content?.parts || [];
    const content = parts
      .filter((p: any) => typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('') || '';

    const functionCalls = parts
      .filter((p: any) => p.functionCall)
      .map((p: any, idx: number) => ({
        id: p.functionCall?.id || `call_${idx}`,
        name: p.functionCall?.name,
        arguments: p.functionCall?.args || {}
      }))
      .filter((tc: any) => tc.name);

    const result: AIResponse = {
      content,
      tool_calls: functionCalls.length > 0 ? functionCalls : undefined,
      raw_parts: parts
    };

    if (data.usageMetadata) {
      result.usage = {
        prompt_tokens: data.usageMetadata.promptTokenCount,
        completion_tokens: data.usageMetadata.candidatesTokenCount,
        total_tokens: data.usageMetadata.totalTokenCount
      };
    }
    return result;
  }

  async *streamContent(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse> {
    const url = `${this.apiUrl}/v1beta/models/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;
    console.log(`[Gemini] API Request (Stream): ${url}, Using Proxy: ${!!this.dispatcher}`);

    let contents: any[] = [];
    if (Array.isArray(prompt)) {
      contents = prompt.map(m => {
        if (m.raw_parts && (m.role === 'assistant' || m.role === 'user')) {
          return {
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: m.raw_parts
          };
        }
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.tool_calls) {
          m.tool_calls.forEach(tc => {
            parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          });
        }
        if (m.role === 'tool') {
          return {
            role: 'function',
            parts: [{ functionResponse: { name: m.name, response: { content: m.content } } }]
          };
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts };
      });
    } else {
      contents = [{ parts: [{ text: prompt }] }];
    }

    const payload: any = {
      contents,
      tools: [
        { google_search: {} },
        { googleMaps: {} },
        { url_context: {} }
      ]
    };

    if (tools && tools.length > 0) {
      payload.tools.push({
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      });
      payload.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }

    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const parts = data.candidates?.[0]?.content?.parts || [];
            const content = parts
              .filter((p: any) => typeof p.text === 'string')
              .map((p: any) => p.text)
              .join('') || '';

            const functionCalls = parts
              .filter((p: any) => p.functionCall)
              .map((p: any, idx: number) => ({
                id: p.functionCall?.id || `call_${idx}`,
                name: p.functionCall?.name,
                arguments: p.functionCall?.args || {}
              }))
              .filter((tc: any) => tc.name);

            if (content || functionCalls.length > 0) {
              const result: AIResponse = {
                content,
                tool_calls: functionCalls.length > 0 ? functionCalls : undefined,
                raw_parts: parts
              };
              if (data.usageMetadata) {
                result.usage = {
                  prompt_tokens: data.usageMetadata.promptTokenCount,
                  completion_tokens: data.usageMetadata.candidatesTokenCount,
                  total_tokens: data.usageMetadata.totalTokenCount
                };
              }
              yield result;
            }
          } catch (e) {
            console.error('[Gemini] Stream Parse Error:', e);
          }
        }
      }
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
  }

  async generateContent(prompt: string, systemInstruction?: string): Promise<AIResponse> {
    const url = `${this.apiUrl}/v1/chat/completions`;
    console.log(`[OpenAI] API Request: ${url}, Using Proxy: ${!!this.dispatcher}`);
    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages
      }),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as any;
    const result: AIResponse = {
      content: data.choices?.[0]?.message?.content || '',
      tool_calls: data.choices?.[0]?.message?.tool_calls
    };
    if (data.usage) {
      result.usage = {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens
      };
    }
    return result;
  }

  async generateWithTools(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const url = `${this.apiUrl}/v1/chat/completions`;
    console.log(`[OpenAI] API Request (Tools): ${url}, Using Proxy: ${!!this.dispatcher}`);
    let messages: any[] = [];

    if (Array.isArray(prompt)) {
      messages = prompt.map(m => {
        const msg: any = { role: m.role, content: m.content };
        if (m.tool_calls) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }));
        }
        if (m.tool_call_id) {
          msg.tool_call_id = m.tool_call_id;
        }
        return msg;
      });
    } else {
      if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
      }
      messages.push({ role: 'user', content: prompt });
    }

    const body: any = {
      model: this.model,
      messages
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
      body.tool_choice = 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as any;
    const message = data.choices?.[0]?.message;
    
    const result: AIResponse = {
      content: message?.content || '',
      tool_calls: message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
      }))
    };
    
    if (data.usage) {
      result.usage = {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens
      };
    }
    return result;
  }

  async *streamContent(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse> {
    const url = `${this.apiUrl}/v1/chat/completions`;
    console.log(`[OpenAI] API Request (Stream): ${url}, Using Proxy: ${!!this.dispatcher}`);
    let messages: any[] = [];

    if (Array.isArray(prompt)) {
      messages = prompt.map(m => {
        const msg: any = { role: m.role, content: m.content };
        if (m.tool_calls) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }));
        }
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        return msg;
      });
    } else {
      if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
      messages.push({ role: 'user', content: prompt });
    }

    const body: any = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
      body.tool_choice = 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const choice = data.choices?.[0];
            const content = choice?.delta?.content || '';
            const tool_calls = choice?.delta?.tool_calls?.map((tc: any) => ({
              id: tc.id,
              name: tc.function?.name,
              arguments: tc.function?.arguments // Note: arguments come in chunks here too
            }));

            if (content || tool_calls || data.usage) {
              const result: AIResponse = { content };
              if (tool_calls) result.tool_calls = tool_calls;
              if (data.usage) {
                result.usage = {
                  prompt_tokens: data.usage.prompt_tokens,
                  completion_tokens: data.usage.completion_tokens,
                  total_tokens: data.usage.total_tokens
                };
              }
              yield result;
            }
          } catch (e) {
            console.error('[OpenAI] Stream Parse Error:', e);
          }
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    const url = `${this.apiUrl}/v1/models`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      },
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
  }

  async generateContent(prompt: string, systemInstruction?: string): Promise<AIResponse> {
    const url = `${this.apiUrl}/v1/messages`;
    console.log(`[Anthropic] API Request: ${url}, Using Proxy: ${!!this.dispatcher}`);
    const payload: any = {
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    };

    if (systemInstruction) {
      payload.system = systemInstruction;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as any;
    const content = data.content?.[0]?.text || '';
    
    const result: AIResponse = { content };
    if (data.usage) {
      result.usage = {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens
      };
    }
    return result;
  }

  async generateWithTools(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const url = `${this.apiUrl}/v1/messages`;
    console.log(`[Anthropic] API Request (Tools): ${url}, Using Proxy: ${!!this.dispatcher}`);
    
    let messages: any[] = [];
    let system = systemInstruction;

    if (Array.isArray(prompt)) {
      messages = prompt.filter(m => m.role !== 'system').map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content
            }]
          };
        }
        
        const content: any[] = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content });
        }
        if (m.tool_calls) {
          m.tool_calls.forEach(tc => {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments
            });
          });
        }
        return { role: m.role, content };
      });
      
      const sysMsg = prompt.find(m => m.role === 'system');
      if (sysMsg) system = sysMsg.content || systemInstruction;
    } else {
      messages = [{ role: 'user', content: prompt }];
    }

    const payload: any = {
      model: this.model,
      max_tokens: 4096,
      messages
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
      payload.tool_choice = { type: 'auto' };
    }

    if (system) {
      payload.system = system;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as any;
    const blocks = data.content || [];
    const content = blocks
      .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('') || '';

    const toolCalls = blocks
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any, idx: number) => ({
        id: b.id || `call_${idx}`,
        name: b.name,
        arguments: b.input
      }))
      .filter((tc: any) => tc.name);

    const result: AIResponse = {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    };
    if (data.usage) {
      result.usage = {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens
      };
    }
    return result;
  }

  async *streamContent(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse> {
    const url = `${this.apiUrl}/v1/messages`;
    console.log(`[Anthropic] API Request (Stream): ${url}, Using Proxy: ${!!this.dispatcher}`);
    
    let messages: any[] = [];
    let system = systemInstruction;

    if (Array.isArray(prompt)) {
      messages = prompt.filter(m => m.role !== 'system').map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content
            }]
          };
        }
        const content: any[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        if (m.tool_calls) {
          m.tool_calls.forEach(tc => {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments
            });
          });
        }
        return { role: m.role, content };
      });
      const sysMsg = prompt.find(m => m.role === 'system');
      if (sysMsg) system = sysMsg.content || systemInstruction;
    } else {
      messages = [{ role: 'user', content: prompt }];
    }

    const payload: any = {
      model: this.model,
      max_tokens: 4096,
      messages,
      stream: true
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
      payload.tool_choice = { type: 'auto' };
    }

    if (system) payload.system = system;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content_block_delta') {
              if (data.delta?.type === 'text_delta') {
                yield { content: data.delta.text };
              } else if (data.delta?.type === 'input_json_delta') {
                // Partial JSON for tool input
                yield { content: '', tool_calls: [{ id: '', name: '', arguments: data.delta.partial_json }] };
              }
            } else if (data.type === 'message_delta' && data.usage) {
              yield { content: '', usage: {
                prompt_tokens: 0, // Anthropic doesn't provide prompt_tokens in message_delta usually
                completion_tokens: data.usage.output_tokens,
                total_tokens: data.usage.output_tokens
              }};
            } else if (data.type === 'message_start' && data.message?.usage) {
                yield { content: '', usage: {
                    prompt_tokens: data.message.usage.input_tokens,
                    completion_tokens: 0,
                    total_tokens: data.message.usage.input_tokens
                }};
            }
          } catch (e) {
            console.error('[Anthropic] Stream Parse Error:', e);
          }
        }
      }
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
      // Some proxy or older API might not support /v1/models, fallback to a hardcoded list if it fails
      return ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'];
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
    // 确保 URL 不以 / 结尾
    this.apiUrl = apiUrl.replace(/\/$/, '') || 'http://localhost:11434';
    this.model = model;
    this.dispatcher = dispatcher;
  }

  async generateContent(prompt: string, systemInstruction?: string): Promise<AIResponse> {
    const url = `${this.apiUrl}/api/generate`;
    const payload: any = {
      model: this.model,
      prompt: prompt,
      stream: false
    };

    if (systemInstruction) {
      payload.system = systemInstruction;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as any;
    const content = data.response || '';
    
    const result: AIResponse = { content };
    if (data.prompt_eval_count) {
      result.usage = {
        prompt_tokens: data.prompt_eval_count,
        completion_tokens: data.eval_count,
        total_tokens: data.prompt_eval_count + data.eval_count
      };
    }
    return result;
  }

  async generateWithTools(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const url = `${this.apiUrl}/api/chat`;
    let messages: any[] = [];
    
    if (Array.isArray(prompt)) {
      messages = prompt.map(m => {
        const msg: any = { role: m.role, content: m.content };
        if (m.tool_calls) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            function: {
              name: tc.name,
              arguments: tc.arguments
            }
          }));
        }
        return msg;
      });
    } else {
      if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
      }
      messages.push({ role: 'user', content: prompt });
    }

    const payload: any = {
      model: this.model,
      messages,
      stream: false,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
      payload.tool_choice = 'auto';
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        dispatcher: this.dispatcher
      } as any);

      if (response.ok) {
        const data = await response.json() as any;
        const message = data.message;
        const toolCalls = message?.tool_calls
          ?.map((tc: any, idx: number) => {
            let args: any = {};
            const rawArgs = tc.function?.arguments;
            if (typeof rawArgs === 'string') {
              try {
                args = JSON.parse(rawArgs);
              } catch {
                args = {};
              }
            } else if (rawArgs && typeof rawArgs === 'object') {
              args = rawArgs;
            }

            return {
              id: tc.id || `call_${idx}`,
              name: tc.function?.name,
              arguments: args
            };
          })
          ?.filter((tc: any) => tc.name);

        const result: AIResponse = {
          content: message?.content || '',
          tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined
        };

        if (data.prompt_eval_count) {
          result.usage = {
            prompt_tokens: data.prompt_eval_count,
            completion_tokens: data.eval_count,
            total_tokens: data.prompt_eval_count + data.eval_count
          };
        }
        return result;
      }
    } catch {
      // ignore and fallback
    }

    if (typeof prompt === 'string') {
      return await this.generateContent(prompt, systemInstruction);
    }
    
    return { content: 'Ollama generateWithTools failed with message history' };
  }

  async *streamContent(prompt: string | AIMessage[], tools?: any[], systemInstruction?: string): AsyncIterable<AIResponse> {
    const url = `${this.apiUrl}/api/chat`;
    let messages: any[] = [];
    
    if (Array.isArray(prompt)) {
      messages = prompt.map(m => {
        const msg: any = { role: m.role, content: m.content };
        if (m.tool_calls) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            function: { name: tc.name, arguments: tc.arguments }
          }));
        }
        return msg;
      });
    } else {
      if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
      messages.push({ role: 'user', content: prompt });
    }

    const payload: any = {
      model: this.model,
      messages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      dispatcher: this.dispatcher
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama error: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          const message = data.message;
          const content = message?.content || '';
          const tool_calls = message?.tool_calls?.map((tc: any, idx: number) => ({
            id: tc.id || `call_${idx}`,
            name: tc.function?.name,
            arguments: tc.function?.arguments
          }));

          if (content || tool_calls || data.done) {
            const result: AIResponse = { content };
            if (tool_calls) result.tool_calls = tool_calls;
            if (data.done) {
              result.usage = {
                prompt_tokens: data.prompt_eval_count || 0,
                completion_tokens: data.eval_count || 0,
                total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
              };
            }
            yield result;
          }
        } catch (e) {
          console.error('[Ollama] Stream Parse Error:', e);
        }
      }
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
