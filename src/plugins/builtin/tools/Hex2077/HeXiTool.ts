import { BaseTool } from '../../../base/BaseTool.js';
import { ServiceContext } from '../../../../services/ServiceContext.js';
import { LogService } from '../../../../services/LogService.js';
import { persona } from './prompts/persona.js';
import { style } from './prompts/style.js';
import { knowledge } from './prompts/knowledge.js';
import { projects } from './prompts/projects.js';
import { strategy } from './prompts/strategy.js';
import { orchestrator } from './prompts/orchestrator.js';

export class HeXiTool extends BaseTool {
  readonly id = 'hexi_2077_persona';
  readonly name = '何夕2077 分身 (6-Agent 版)';
  readonly description = '调用何夕2077的 AI 分身，采用完整的 6-Agent 深度编排架构：策略师、知识专家、档案馆、人格守护者、风格执行者、主协调器。';
  readonly parameters = {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: '对话输入内容'
      }
    },
    required: ['input']
  };

  async handler(args: { input: string }): Promise<{ strategy: string; content: string; steps: any[] }> {
    let { input } = args;

    // 清洗输入：移除可能存在的系统噪声或 XML 标签（如 <system-reminder>）
    input = input.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim();

    const steps: any[] = [];
    LogService.info(`[HeXiTool] Initiating 6-Agent Orchestration for: ${input.slice(0, 50)}...`);

    const context = await ServiceContext.getInstance();
    const aiProvider = context.aiProvider;

    if (!aiProvider) {
      throw new Error('AI Provider not initialized in ServiceContext');
    }

    try {
      // --- Agent 1: Response Strategist (策略分类) ---
      LogService.info('[HeXiTool] Agent 1 (Strategist) working...');
      const strategyPrompt = `${strategy}\n请判断问题类型（A-F），并以 "[Strategy: 类型X]" 格式输出。`;
      const strategyRes = await aiProvider.generateContent(input, [], strategyPrompt);
      const strategyTag = strategyRes.content?.match(/\[Strategy: 类型.\]/)?.[0] || '[Strategy: 类型E]';
      const typeCode = strategyTag.slice(-2, -1);
      steps.push({ agent: 'Response Strategist', output: strategyTag });

      // --- Agent 2 & 3: Knowledge Expert & Project Archivist (干货提取 - 并行) ---
      LogService.info('[HeXiTool] Agent 2 & 3 (Knowledge & Project) working in parallel...');
      const knowledgeTask = (['A', 'B', 'C', 'D'].includes(typeCode))
        ? aiProvider.generateContent(input, [], knowledge)
        : Promise.resolve({ content: 'Skip (Non-technical query)' });

      const projectTask = (['A', 'F'].includes(typeCode))
        ? aiProvider.generateContent(input, [], projects)
        : Promise.resolve({ content: 'Skip (No project needed)' });

      const [knowledgeRes, projectRes] = await Promise.all([knowledgeTask, projectTask]);
      steps.push({ agent: 'Knowledge Expert', output: knowledgeRes.content });
      steps.push({ agent: 'Project Archivist', output: projectRes.content });

      // --- Agent 4: Persona Keeper (人格与价值观审核) ---
      LogService.info('[HeXiTool] Agent 4 (Persona Keeper) reviewing content...');
      const personaPrompt = `
${persona}
任务：审查以下收集到的干货内容。
1. 剔除任何空谈趋势、贩卖焦虑、吹捧模型的内容。
2. 确保立场为“AI 驾驭者”，强调程序员的真实价值。
3. 整合干货，输出一份符合价值观的精简事实稿。

收集到的干货：
${knowledgeRes.content}
${projectRes.content}
`;
      const personaRes = await aiProvider.generateContent(`针对用户输入 "${input}"，整合上述干货并确保价值观一致。`, [], personaPrompt);
      const factDraft = personaRes.content || '';
      steps.push({ agent: 'Persona Keeper', output: factDraft });

      // --- Agent 5: Style Enforcer (风格执行重写) ---
      LogService.info('[HeXiTool] Agent 5 (Style Enforcer) rewriting...');
      const stylePrompt = `
${style}
任务：将以下事实稿重写为何夕2077的风格。
要求：短句、反问、极简 emoji、傲娇工程师语气。
事实稿：
${factDraft}
`;
      const styleRes = await aiProvider.generateContent(`重写这段内容，确保包含对用户 "${input}" 的直接回应。`, [], stylePrompt);
      const styledContent = styleRes.content || factDraft;
      steps.push({ agent: 'Style Enforcer', output: styledContent });

      // --- Agent 6: Orchestrator (最终汇总与元数据管理) ---
      LogService.info('[HeXiTool] Agent 6 (Orchestrator) finalizing...');
      // 这里的 Orchestrator 负责最后的清洗和格式化输出
      const finalContent = styledContent.replace(/\[Strategy: 类型.\]/g, '').trim();

      steps.push({ agent: 'Orchestrator', status: 'Completed', finalStrategy: strategyTag });

      return {
        strategy: strategyTag,
        content: finalContent,
        steps: steps
      };
    } catch (error: any) {
      LogService.error(`[HeXiTool] 6-Agent Orchestration failed: ${error.message}`);
      throw error;
    }
  }
}
