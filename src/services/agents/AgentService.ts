import { AgentDefinition, SkillDefinition, AgentExecutionResult } from '../../types/agent.js';
import { LocalStore } from '../LocalStore.js';
import { AIProvider, createAIProvider } from '../AIProvider.js';
import { MCPService } from './MCPService.js';
import { ToolRegistry } from '../../registries/ToolRegistry.js';
import { LogService } from '../LogService.js';
import { SkillService } from './SkillService.js';
import { AIMessage } from '../../types/index.js';

export class AgentService {
  private store: LocalStore;
  private aiProvider: AIProvider;
  private skillService: SkillService;
  private mcpService: MCPService;
  private toolRegistry: ToolRegistry;
  private proxyAgent?: any;

  constructor(store: LocalStore, aiProvider: AIProvider, skillService: SkillService, mcpService: MCPService, proxyAgent?: any) {
    this.store = store;
    this.aiProvider = aiProvider;
    this.skillService = skillService;
    this.mcpService = mcpService;
    this.toolRegistry = ToolRegistry.getInstance();
    this.proxyAgent = proxyAgent;
  }

  async runAgent(agentId: string, input: string, date?: string, options: { silent?: boolean } = {}): Promise<AgentExecutionResult> {
    const agentDef = await this.store.getAgent(agentId);
    if (!agentDef) throw new Error(`Agent ${agentId} not found`);

    if (!options.silent) {
      LogService.info(`Running agent: ${agentDef.name}${date ? ` for date: ${date}` : ''}`);
    }

    // 0. Resolve AI Provider from agent's own config
    let provider: AIProvider = this.aiProvider;
    if (agentDef.providerId) {
      const settings = await this.store.get('system_settings');
      const providers = settings?.AI_PROVIDERS || [];
      const providerConfig = providers.find((p: any) => p.id === agentDef.providerId);
      if (providerConfig) {
        const model = agentDef.model || providerConfig.models?.[0];
        // 确保从 ServiceContext 或设置中获取代理 Agent
        const dispatcher = providerConfig.useProxy === true ? (this as any).proxyAgent : undefined;
        if (!options.silent) {
          LogService.info(`Initializing AI provider ${providerConfig.id} for agent ${agentDef.name}. Using Proxy: ${!!dispatcher}`);
        }
        const created = createAIProvider({ ...providerConfig, model }, dispatcher);
        if (created) provider = created;
      }
    }

    // 1. Prepare Skills
    const combinedSkillInstructions = await this.skillService.buildSkillsPrompt(agentDef.skillIds || []);

    // 2. Prepare Tools
    const toolIds = new Set<string>([
      ...(agentDef.toolIds || [])
    ]);

    // If skills are present, ensure execute_command is available
    if ((agentDef.skillIds || []).length > 0) {
      toolIds.add('execute_command');
    }

    const settings = await this.store.get('system_settings');
    const closedPlugins = settings?.CLOSED_PLUGINS || [];

    const tools = Array.from(toolIds)
      .filter(id => !closedPlugins.includes(id)) // 过滤已禁用的工具
      .map(id => this.toolRegistry.getTool(id))
      .filter(Boolean) as any[];

    // 2.1 Prepare MCP Tools
    const mcpConfigs = [];
    if (agentDef.mcpServerIds && agentDef.mcpServerIds.length > 0) {
      for (const id of agentDef.mcpServerIds) {
        const config = await this.store.getMCPConfig(id);
        if (config) {
          mcpConfigs.push(config);
        }
      }
    }

    const mcpTools = await this.mcpService.getTools(mcpConfigs);
    const combinedTools = [...tools, ...mcpTools];

    // 3. Construct System Message
    let systemInstruction = `${combinedSkillInstructions}\n${agentDef.systemPrompt}`;
    if (date) {
      systemInstruction += `\n\n当前处理日期为: ${date}`;
    }

    if (!options.silent) {
      LogService.info(`[Agent ${agentDef.name}] System Instruction: ${systemInstruction.slice(0, 500)}...`);
    }

    // 4. Execution Loop (Maintain message history to avoid repeated tool calls)
    const messages: AIMessage[] = [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: input }
    ];

    let finalContent = '';
    let lastToolResult: any = null;
    let rounds = 0;
    const maxRounds = 5; // Increased slightly as some complex tasks might need more steps

    while (rounds < maxRounds) {
      if (!options.silent) {
        LogService.info(`[Agent ${agentDef.name}] Round ${rounds + 1} starting...`);
      }

      const response = await provider.generateWithTools(messages, combinedTools);
      
      const responseContent = response.content || '';
      if (!options.silent && responseContent) {
        LogService.info(`[Agent ${agentDef.name}] Round ${rounds + 1} AI Response: "${responseContent.slice(0, 500)}${responseContent.length > 500 ? '...' : ''}"`);
      }

      // Add assistant response to history
      messages.push({
        role: 'assistant',
        content: responseContent || null,
        tool_calls: response.tool_calls
      });

      if (response.tool_calls && response.tool_calls.length > 0) {
        if (!options.silent) {
          LogService.info(`Agent ${agentDef.name} calling tools: ${response.tool_calls.map(tc => tc.name).join(', ')}`);
        }
        
        for (const tc of response.tool_calls) {
          try {
            if (!options.silent) {
              LogService.info(`[Agent ${agentDef.name}] Round ${rounds + 1} Tool Call: ${tc.name} with args: ${JSON.stringify(tc.arguments)}`);
            }
            
            let result: any;
            
            // 优先从本地工具注册中心查找
            const localTool = this.toolRegistry.getTool(tc.name);
            
            if (localTool) {
              // 内置工具或插件工具（包括自定义插件）
              result = await this.toolRegistry.callTool(tc.name, tc.arguments);
            } else {
              // 查找工具定义以确定是否为 MCP 工具
              const toolDef = combinedTools.find(t => t.name === tc.name);
              
              if (toolDef) {
                // 是 MCP 工具。toolDef.id 包含 "configId:toolName" (原始名称)
                const [configId, ...nameParts] = toolDef.id.split(':');
                const originalToolName = nameParts.join(':');
                const mcpConfig = mcpConfigs.find(cfg => cfg.id === configId);
                
                if (mcpConfig) {
                  result = await this.mcpService.callTool(mcpConfig, originalToolName, tc.arguments);
                } else {
                  // 回退逻辑：如果找不到配置，尝试直接调用（可能 toolName 已经是原始名称）
                  result = await this.mcpService.callTool({ id: configId } as any, originalToolName, tc.arguments);
                }
              } else {
                throw new Error(`未找到工具定义: ${tc.name}`);
              }
            }

            if (!options.silent) {
              LogService.info(`[Agent ${agentDef.name}] Round ${rounds + 1} Tool Result Success`);
            }
            
            // Add tool result to history
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: typeof result === 'string' ? result : JSON.stringify(result)
            });
            
            lastToolResult = result;
          } catch (error: any) {
            LogService.error(`[Agent ${agentDef.name}] Tool ${tc.name} failed: ${error.message}`);
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: `Error: ${error.message}`
            });
          }
        }
        rounds++;
      } else {
        finalContent = typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent);
        if (!finalContent || (typeof finalContent === 'string' && !finalContent.trim())) {
          if (!options.silent) {
            LogService.warn(`[Agent ${agentDef.name}] Round ${rounds + 1} received empty content and no tool calls.`);
          }
        }
        break;
      }
    }

    // 如果 AI 没有返回最终内容，但有工具执行结果，尝试使用最后一个工具的结果作为内容
    let finalString = typeof finalContent === 'string' ? finalContent : JSON.stringify(finalContent);
    
    if (!finalString.trim() && lastToolResult) {
      if (!options.silent) {
        LogService.info(`[Agent ${agentDef.name}] Final content is empty, using last tool result as fallback.`);
      }
      
      if (typeof lastToolResult === 'string') {
        finalString = lastToolResult;
      } else if (typeof lastToolResult === 'object' && lastToolResult !== null) {
        // 处理标准 MCP 响应格式: { content: [{ type: 'text', text: '...' }] }
        if (Array.isArray(lastToolResult.content)) {
          finalString = lastToolResult.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
          
          if (!finalString.trim()) {
            finalString = JSON.stringify(lastToolResult.content);
          }
        } else {
          // 某些工具可能返回 { content: '...' } 或 { html: '...' }
          const fallback = lastToolResult.content || lastToolResult.html || lastToolResult.summary || JSON.stringify(lastToolResult);
          finalString = typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
        }
      }
    }

    if (!finalString.trim()) {
      LogService.error(`[Agent ${agentDef.name}] Failed to generate any content after ${rounds + 1} rounds.`);
    }

    return { 
      content: finalString || 'No response generated (AI returned empty content)',
      data: lastToolResult // 返回最后一个工具的执行结果
    };
  }
}
