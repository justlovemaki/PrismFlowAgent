import { BaseTool } from '../base/BaseTool.js';
import { ExecApprovals } from '../../../infra/exec-approvals.js';

export class ExecuteCommandTool extends BaseTool {
  readonly id = 'execute_command';
  readonly name = 'execute_command';
  readonly description = '执行系统命令行指令。使用此工具运行 Skill 中定义的脚本或系统命令。';
  readonly parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的完整命令行指令' },
      cwd: { type: 'string', description: '执行命令的工作目录 (可选)' }
    },
    required: ['command']
  };

  async handler(args: { command: string; cwd?: string }) {
    return await ExecApprovals.execute(args.command, args.cwd);
  }
}
