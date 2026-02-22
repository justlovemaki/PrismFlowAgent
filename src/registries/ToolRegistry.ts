import { BaseTool } from '../plugins/base/BaseTool.js';
import { LogService } from '../services/LogService.js';
import { ToolDefinition } from '../types/agent.js';

export interface ToolMetadata {
  id: string;
  name: string;
  description?: string;
  isBuiltin?: boolean;
}

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, { constructor?: typeof BaseTool; instance?: BaseTool; metadata: ToolMetadata }> = new Map();

  private constructor() {}

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * 注册工具类（用于发现和元数据）
   */
  public register(id: string, toolClass: typeof BaseTool, metadata?: ToolMetadata) {
    const existing = this.tools.get(id);
    this.tools.set(id, {
      ...existing,
      constructor: toolClass,
      metadata: metadata || existing?.metadata || { id, name: id, isBuiltin: false }
    });
  }

  /**
   * 注册工具实例（用于执行）
   */
  public registerTool(tool: BaseTool) {
    const existing = this.tools.get(tool.id);
    this.tools.set(tool.id, {
      ...existing,
      instance: tool,
      metadata: existing?.metadata || { 
        id: tool.id, 
        name: tool.name, 
        description: tool.description, 
        isBuiltin: tool.isBuiltin 
      }
    });
    LogService.info(`Tool registered: ${tool.id} (${tool.name})`);
  }

  /**
   * 批量注册工具实例
   */
  public registerTools(tools: BaseTool[]) {
    tools.forEach(tool => this.registerTool(tool));
  }

  /**
   * 获取工具类
   */
  public get(id: string): typeof BaseTool | undefined {
    return this.tools.get(id)?.constructor;
  }

  /**
   * 获取工具实例
   */
  public getTool(id: string): BaseTool | undefined {
    return this.tools.get(id)?.instance;
  }

  /**
   * 获取工具元数据
   */
  public getMetadata(id: string): ToolMetadata | undefined {
    return this.tools.get(id)?.metadata;
  }

  /**
   * 获取所有注册的工具 ID
   */
  public getAll(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 列出所有工具元数据
   */
  public listMetadata(): ToolMetadata[] {
    return Array.from(this.tools.values()).map(t => t.metadata);
  }

  /**
   * 获取所有已实例化的工具定义（用于 Agent/API）
   */
  public getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(t => t.instance)
      .map(t => {
        const tool = t.instance!;
        return {
          id: tool.id,
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters,
          isBuiltin: tool.isBuiltin
        };
      });
  }

  /**
   * 调用工具
   */
  public async callTool(id: string, args: any) {
    const tool = this.getTool(id);
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
