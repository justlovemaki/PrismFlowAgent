import { ToolDefinition } from '../../types/agent.js';
import { LogService } from '../LogService.js';
import { BaseTool } from '../../plugins/base/BaseTool.js';

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, BaseTool> = new Map();

  private constructor() {}

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * 注册工具插件
   */
  public registerTool(tool: BaseTool) {
    if (this.tools.has(tool.id)) {
      LogService.warn(`Tool with id ${tool.id} already exists, overwriting...`);
    }
    this.tools.set(tool.id, tool);
    LogService.info(`Tool registered: ${tool.id} (${tool.name})`);
  }

  /**
   * 批量注册工具
   */
  public registerTools(tools: BaseTool[]) {
    tools.forEach(tool => this.registerTool(tool));
  }

  public getTool(id: string): BaseTool | undefined {
    return this.tools.get(id);
  }

  public getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      isBuiltin: tool.isBuiltin
    }));
  }

  public async callTool(id: string, args: any) {
    const tool = this.tools.get(id);
    if (!tool) {
      LogService.error(`Tool ${id} not found`);
      throw new Error(`Tool ${id} not found`);
    }
    try {
      return await tool.handler(args);
    } catch (error: any) {
      LogService.error(`Error calling tool ${id}: ${error.message}`);
      throw error;
    }
  }
}
