import { AgentDefinition, SkillDefinition, AgentExecutionResult } from '../../types/agent.js';
import { LocalStore } from '../LocalStore.js';
import { AIProvider, createAIProvider } from '../AIProvider.js';
import { ToolRegistry } from './ToolRegistry.js';
import { LogService } from '../LogService.js';
import { SkillService } from './SkillService.js';

export class AgentService {
  private store: LocalStore;
  private aiProvider: AIProvider;
  private skillService: SkillService;
  private toolRegistry: ToolRegistry;
  private proxyAgent?: any;

  constructor(store: LocalStore, aiProvider: AIProvider, skillService: SkillService, proxyAgent?: any) {
    this.store = store;
    this.aiProvider = aiProvider;
    this.skillService = skillService;
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
      .filter(Boolean);

    // 3. Construct System Message
    let systemInstruction = `${combinedSkillInstructions}\n${agentDef.systemPrompt}`;
    if (date) {
      systemInstruction += `\n\n当前处理日期为: ${date}`;
    }

    if (!options.silent) {
      LogService.info(`[Agent ${agentDef.name}] System Instruction: ${systemInstruction.slice(0, 500)}...`);
    }

    // 4. Execution Loop (Simplified for now: max 3 rounds of tool calls)
    let currentInput = input;
    let finalContent = '';
    let lastToolResult: any = null;
    let rounds = 0;
    const maxRounds = 3;

    while (rounds < maxRounds) {
      if (!options.silent) {
        LogService.info(`[Agent ${agentDef.name}] Round ${rounds + 1} Input: ${currentInput.slice(0, 500)}${currentInput.length > 500 ? '...' : ''}`);
      }

      const response = await provider.generateWithTools(currentInput, tools, systemInstruction);
      
      const responseContent = response.content || '';
      if (!options.silent) {
        LogService.info(`[Agent ${agentDef.name}] Round ${rounds + 1} AI Response: "${responseContent.slice(0, 500)}${responseContent.length > 500 ? '...' : ''}"`);
      }

      if (response.tool_calls && response.tool_calls.length > 0) {
        if (!options.silent) {
          LogService.info(`Agent ${agentDef.name} calling tools: ${response.tool_calls.map(tc => tc.name).join(', ')}`);
        }
        
        const toolResults = [];
        for (const tc of response.tool_calls) {
          try {
            if (!options.silent) {
              LogService.info(`[Agent ${agentDef.name}] Round ${rounds + 1} Tool Call: ${tc.name} with args: ${JSON.stringify(tc.arguments)}`);
            }
            const result = await this.toolRegistry.callTool(tc.name, tc.arguments);
            if (!options.silent) {
              LogService.info(`[Agent ${agentDef.name}] Round ${rounds + 1} Tool Result: ${typeof result === 'string' ? result.slice(0, 500) : 'object'}`);
            }
            toolResults.push({ tool_call_id: tc.id, result });
            lastToolResult = result; // 记录最后一个工具结果
          } catch (error: any) {
            LogService.error(`[Agent ${agentDef.name}] Tool ${tc.name} failed: ${error.message}`);
            toolResults.push({ tool_call_id: tc.id, error: error.message });
          }
        }

        // Inform the AI about tool results and continue
        currentInput = `Tool results:\n${JSON.stringify(toolResults)}\n\nPlease continue based on these results.`;
        rounds++;
      } else {
        finalContent = responseContent;
        if (!finalContent.trim()) {
          if (!options.silent) {
            LogService.warn(`[Agent ${agentDef.name}] Round ${rounds + 1} received empty content and no tool calls.`);
          }
        }
        break;
      }
    }

    // 如果 AI 没有返回最终内容，但有工具执行结果，尝试使用最后一个工具的结果作为内容
    if (!finalContent.trim() && lastToolResult) {
      if (!options.silent) {
        LogService.info(`[Agent ${agentDef.name}] Final content is empty, using last tool result as fallback.`);
      }
      if (typeof lastToolResult === 'string') {
        finalContent = lastToolResult;
      } else if (typeof lastToolResult === 'object' && lastToolResult !== null) {
        // 某些工具可能返回 { content: '...' } 或 { html: '...' }
        finalContent = lastToolResult.content || lastToolResult.html || lastToolResult.summary || JSON.stringify(lastToolResult);
      }
    }

    if (!finalContent.trim()) {
      LogService.error(`[Agent ${agentDef.name}] Failed to generate any content after ${rounds + 1} rounds.`);
    }

    return { 
      content: finalContent || 'No response generated (AI returned empty content)',
      data: lastToolResult // 返回最后一个工具的执行结果
    };
  }
}
