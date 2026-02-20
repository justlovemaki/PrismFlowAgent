import { WorkflowDefinition, WorkflowStep } from '../../types/agent.js';
import { LocalStore } from '../LocalStore.js';
import { AgentService } from './AgentService.js';
import { AIProvider } from '../AIProvider.js';
import { LogService } from '../LogService.js';

export class WorkflowEngine {
  private store: LocalStore;
  private agentService: AgentService;
  private aiProvider: AIProvider;

  constructor(store: LocalStore, agentService: AgentService, aiProvider: AIProvider) {
    this.store = store;
    this.agentService = agentService;
    this.aiProvider = aiProvider;
  }

  async runWorkflow(workflowId: string, initialInput: any, date?: string): Promise<any> {
    const workflow = await this.store.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    LogService.info(`Starting workflow: ${workflow.name}${date ? ` for date: ${date}` : ''}`);

    const stepMap = new Map<string, WorkflowStep>();
    for (const step of workflow.steps) {
      stepMap.set(step.id, step);
    }

    // Build dependency graph: for each step, collect which step IDs it depends on
    const dependencies = this.buildDependencyGraph(workflow);
    // Build reverse map: step -> list of steps that follow it
    const successors = this.buildSuccessorMap(workflow);

    const stepResults: Record<string, any> = { 'start': initialInput };
    const completed = new Set<string>();
    // Track in-degree (number of unresolved dependencies) for each step
    const inDegree = new Map<string, number>();

    for (const step of workflow.steps) {
      inDegree.set(step.id, (dependencies.get(step.id) || []).length);
    }

    // Collect initial ready steps (zero dependencies)
    let readyQueue: string[] = [];
    for (const step of workflow.steps) {
      if ((inDegree.get(step.id) || 0) === 0) {
        readyQueue.push(step.id);
      }
    }

    let finalOutput: any = null;

    while (readyQueue.length > 0) {
      LogService.info(`Parallel batch: [${readyQueue.join(', ')}]`);

      // Execute all ready steps in parallel
      const batchResults = await Promise.allSettled(
        readyQueue.map(stepId => this.executeStep(stepMap.get(stepId)!, stepResults, dependencies.get(stepId) || [], date))
      );

      // Process results and find next ready steps
      const nextReady: string[] = [];

      for (let i = 0; i < readyQueue.length; i++) {
        const stepId = readyQueue[i];
        const result = batchResults[i];

        if (result.status === 'fulfilled') {
          stepResults[stepId] = result.value;
          finalOutput = result.value;
        } else {
          LogService.error(`Workflow step ${stepId} failed: ${result.reason}`);
          stepResults[stepId] = { error: String(result.reason) };
        }

        completed.add(stepId);

        // Decrease in-degree for all successors
        const succs = successors.get(stepId) || [];
        for (const nextId of succs) {
          const newDeg = (inDegree.get(nextId) || 1) - 1;
          inDegree.set(nextId, newDeg);
          if (newDeg === 0 && !completed.has(nextId)) {
            nextReady.push(nextId);
          }
        }
      }

      readyQueue = nextReady;
    }

    return finalOutput;
  }

  /**
   * Build dependency graph from nextStepIds edges AND inputMap references.
   * stepId -> list of predecessor step IDs
   */
  private buildDependencyGraph(workflow: WorkflowDefinition): Map<string, string[]> {
    const stepIds = new Set(workflow.steps.map(s => s.id));
    const deps = new Map<string, string[]>();

    for (const step of workflow.steps) {
      deps.set(step.id, []);
    }

    // Edges from nextStepIds
    for (const step of workflow.steps) {
      const nextIds = step.nextStepIds || (step.nextStepId ? [step.nextStepId] : []);
      for (const nextId of nextIds) {
        if (stepIds.has(nextId)) {
          const list = deps.get(nextId) || [];
          if (!list.includes(step.id)) {
            list.push(step.id);
            deps.set(nextId, list);
          }
        }
      }
    }

    // Edges from inputMap: if a step's inputMap references another step, that's a dependency
    for (const step of workflow.steps) {
      if (!step.inputMap) continue;
      const list = deps.get(step.id) || [];
      for (const sourceStepId of Object.values(step.inputMap)) {
        if (!sourceStepId || sourceStepId === 'start') continue;
        if (stepIds.has(sourceStepId) && !list.includes(sourceStepId)) {
          list.push(sourceStepId);
          deps.set(step.id, list);
        }
      }
    }

    return deps;
  }

  /**
   * Build successor map from nextStepIds edges AND inputMap references.
   * stepId -> list of steps that follow it
   */
  private buildSuccessorMap(workflow: WorkflowDefinition): Map<string, string[]> {
    const succs = new Map<string, string[]>();
    const stepIds = new Set(workflow.steps.map(s => s.id));

    for (const step of workflow.steps) {
      succs.set(step.id, []);
    }

    // Edges from nextStepIds
    for (const step of workflow.steps) {
      const nextIds = step.nextStepIds || (step.nextStepId ? [step.nextStepId] : []);
      for (const nextId of nextIds) {
        if (stepIds.has(nextId)) {
          const list = succs.get(step.id) || [];
          if (!list.includes(nextId)) {
            list.push(nextId);
            succs.set(step.id, list);
          }
        }
      }
    }

    // Edges from inputMap: sourceStepId -> current step
    for (const step of workflow.steps) {
      if (!step.inputMap) continue;
      for (const sourceStepId of Object.values(step.inputMap)) {
        if (!sourceStepId || sourceStepId === 'start') continue;
        if (stepIds.has(sourceStepId)) {
          const list = succs.get(sourceStepId) || [];
          if (!list.includes(step.id)) {
            list.push(step.id);
            succs.set(sourceStepId, list);
          }
        }
      }
    }

    return succs;
  }

  /**
   * Execute a single workflow step (agent or skill).
   * Input is auto-derived from predecessors in the DAG:
   *  - 0 predecessors: use workflow initial input (start)
   *  - 1 predecessor: pass its output directly
   *  - N predecessors: merge outputs into { [stepId]: output }
   */
  private async executeStep(
    step: WorkflowStep,
    stepResults: Record<string, any>,
    predecessors: string[],
    date?: string
  ): Promise<any> {
    LogService.info(`Executing workflow step: ${step.id}`);

    // Derive input: prefer explicit inputMap, fallback to auto-derive from predecessors
    let stepInput: any;
    // Filter out empty/invalid inputMap entries
    const validInputMap = step.inputMap
      ? Object.fromEntries(Object.entries(step.inputMap).filter(([k, v]) => k && v))
      : {};
    if (Object.keys(validInputMap).length > 0) {
      // inputMap: { paramName: sourceStepId } — build named input object
      const mapped: Record<string, any> = {};
      for (const [paramName, sourceStepId] of Object.entries(validInputMap)) {
        mapped[paramName] = stepResults[sourceStepId];
      }
      // If only one key, pass the value directly for simpler downstream consumption
      const keys = Object.keys(mapped);
      stepInput = keys.length === 1 ? mapped[keys[0]] : mapped;
    } else if (predecessors.length === 0) {
      stepInput = stepResults['start'];
    } else if (predecessors.length === 1) {
      stepInput = stepResults[predecessors[0]];
    } else {
      stepInput = {};
      for (const predId of predecessors) {
        stepInput[predId] = stepResults[predId];
      }
    }

    const inputText = typeof stepInput === 'string' ? stepInput : (JSON.stringify(stepInput) ?? '');
    LogService.info(`[Workflow ${step.id}] Input: ${inputText.slice(0, 1000)}${inputText.length > 1000 ? '...(truncated)' : ''}`);

    // Execute Agent
    let output: any = null;
    if (step.agentId) {
      const agentResult = await this.agentService.runAgent(step.agentId, inputText, date, { silent: true });
      output = agentResult.content;
    }

    const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
    LogService.info(`[Workflow ${step.id}] Output: ${outputStr?.slice(0, 1000)}${(outputStr?.length || 0) > 1000 ? '...(truncated)' : ''}`);
    return output;
  }
}
