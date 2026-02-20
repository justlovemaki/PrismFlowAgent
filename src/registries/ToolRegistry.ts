import { BaseTool } from '../plugins/tools/base/BaseTool.js';

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, typeof BaseTool> = new Map();

  private constructor() {}

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  public register(id: string, toolClass: typeof BaseTool) {
    this.tools.set(id, toolClass);
  }

  public get(id: string): typeof BaseTool | undefined {
    return this.tools.get(id);
  }

  public getAll(): string[] {
    return Array.from(this.tools.keys());
  }
}
