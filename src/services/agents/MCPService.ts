import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCPServerConfig, ToolDefinition } from '../../types/agent.js';
import { LogService } from '../LogService.js';

// 清理 schema 中不兼容的字段，特别是针对 Claude API
function cleanMCPSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  
  const newSchema = { ...schema };
  
  // 删除 Claude API 不支持的字段
  delete newSchema.$schema;
  delete newSchema.$id;
  delete newSchema.$ref;
  delete newSchema.$defs;
  delete newSchema.definitions;
  delete newSchema.additionalProperties; // Claude 不支持此字段
  delete newSchema.unevaluatedProperties;
  delete newSchema.minimum;
  delete newSchema.maximum;
  delete newSchema.default;
  delete newSchema.enum;
  
  // 递归清理 properties
  if (newSchema.properties) {
    const newProperties: any = {};
    for (const [key, value] of Object.entries(newSchema.properties)) {
      newProperties[key] = cleanMCPSchema(value);
    }
    newSchema.properties = newProperties;
  }
  
  // 递归清理 items
  if (newSchema.items) {
    newSchema.items = cleanMCPSchema(newSchema.items);
  }
  
  // 递归清理 anyOf/oneOf/allOf
  if (newSchema.anyOf) {
    newSchema.anyOf = newSchema.anyOf.map((s: any) => cleanMCPSchema(s));
  }
  if (newSchema.oneOf) {
    newSchema.oneOf = newSchema.oneOf.map((s: any) => cleanMCPSchema(s));
  }
  if (newSchema.allOf) {
    newSchema.allOf = newSchema.allOf.map((s: any) => cleanMCPSchema(s));
  }

  return newSchema;
}

/**
 * 使名称符合 Claude API 要求：必须以字母开头，只能包含字母、数字、下划线和连字符
 * @param name 原始名称
 * @returns 符合规范的名称
 */
function sanitizeName(name: string): string {
  // 替换所有非字母、数字、下划线、连字符为下划线
  let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  // 确保以字母开头
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = 'mcp_' + sanitized;
  }
  return sanitized;
}

export class MCPService {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, any> = new Map();
  private proxyAgent?: any;

  constructor(proxyAgent?: any) {
    this.proxyAgent = proxyAgent;
  }

  async getTools(configs: MCPServerConfig[]): Promise<ToolDefinition[]> {
    const allTools: ToolDefinition[] = [];

    for (const config of configs) {
      if (!config.enabled) continue;

      try {
        LogService.info(`Connecting to MCP server ${config.name} (${config.id}) at ${config.url || 'stdio'}`);
        const client = await this.getOrCreateClient(config);
        const response = await client.listTools();
        
        const tools = (response.tools || []).map((tool: any) => {
          // 清理 schema 以兼容 Claude API
          const cleanedSchema = cleanMCPSchema(tool.inputSchema);
          
          const safeId = sanitizeName(config.id);
          const safeToolName = sanitizeName(tool.name);

          return {
            id: `${config.id}:${tool.name}`,
            name: `${safeId}__${safeToolName}`, // 使用 __ 作为分隔符，并确保名称合法
            description: tool.description || '',
            parameters: cleanedSchema,
            isBuiltin: false
          };
        });

        allTools.push(...tools);
        LogService.info(`Successfully loaded ${tools.length} tools from ${config.name}`);
      } catch (error: any) {
        LogService.error(`Failed to get tools from MCP server ${config.name} (${config.id}): ${error.message}`);
        if (error.stack) {
          LogService.error(error.stack);
        }
      }
    }

    return allTools;
  }

  async callTool(config: MCPServerConfig, toolName: string, args: any): Promise<any> {
    try {
      const client = await this.getOrCreateClient(config);
      
      // 注意：toolName 应该是原始名称。
      // 在 AgentService 中，我们现在已经先通过 toolDef.id 解析出原始名称再传进来了。
      let finalToolName = toolName;
      
      // 这里的逻辑作为兼容性保留，以防万一有其他地方还在用旧的格式
      if (toolName.includes(':') && !toolName.includes('__')) {
        finalToolName = toolName.split(':').slice(1).join(':');
      }
      
      const result = await client.callTool({
        name: finalToolName,
        arguments: args
      });
      
      return result;
    } catch (error: any) {
      LogService.error(`Failed to call MCP tool ${toolName} on server ${config.name}: ${error.message}`);
      throw error;
    }
  }

  private async getOrCreateClient(config: MCPServerConfig): Promise<Client> {
    if (this.clients.has(config.id)) {
      return this.clients.get(config.id)!;
    }

    let transport: any;
    if (config.transportType === 'stdio') {
      transport = new StdioClientTransport({
        command: config.command!,
        args: config.args || [],
        env: Object.entries({ ...process.env, ...(config.env || {}) }).reduce((acc, [k, v]) => {
          if (v !== undefined) acc[k] = v;
          return acc;
        }, {} as Record<string, string>)
      });
    } else if (config.transportType === 'sse') {
      transport = new SSEClientTransport(new URL(config.url!), {
        eventSourceInit: {
          headers: config.headers
        } as any,
        requestInit: {
          headers: config.headers,
          // @ts-ignore - undici fetch supports dispatcher
          dispatcher: this.proxyAgent
        }
      });
    } else if (config.transportType === 'streamable-http') {
      transport = new StreamableHTTPClientTransport(new URL(config.url!), {
        requestInit: {
          headers: config.headers,
          // @ts-ignore - undici fetch supports dispatcher
          dispatcher: this.proxyAgent
        }
      });
    } else {
      throw new Error(`Unsupported transport type: ${config.transportType}`);
    }

    const client = new Client({
      name: 'PrismFlowAgent',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await client.connect(transport);
    
    this.clients.set(config.id, client);
    this.transports.set(config.id, transport);

    return client;
  }

  async disconnectAll() {
    for (const [id, client] of this.clients.entries()) {
      try {
        await client.close();
      } catch (error: any) {
        LogService.error(`Error closing MCP client ${id}: ${error.message}`);
      }
    }
    this.clients.clear();
    this.transports.clear();
  }
}
