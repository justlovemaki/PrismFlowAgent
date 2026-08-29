import type { WorkflowDefinition, WorkflowStep } from '../types/agent.js';

export const INITIAL_INPUT_STEP_ID = 'initial_input';

export function getWorkflowNextStepIds(step: WorkflowStep): string[] {
  if (step.nextStepIds && step.nextStepIds.length > 0) return step.nextStepIds;
  if (step.nextStepId) return [step.nextStepId];
  return [];
}

/**
 * Ensure a workflow has a dedicated input node. The node is the workflow
 * entry point and passes the initial input through unchanged.
 */
export function ensureInitialInputStep(workflow: WorkflowDefinition): WorkflowDefinition {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const configuredInitial = steps.find(step => step.id === workflow.initialStepId && step.type === 'input');
  const inputStep = configuredInitial ?? steps.find(step => step.type === 'input');

  if (inputStep) {
    const normalizedInput: WorkflowStep = {
      ...inputStep,
      type: 'input',
      agentId: undefined,
      workflowId: undefined,
      skillId: undefined,
      enabled: true,
    };
    return {
      ...workflow,
      steps: [normalizedInput, ...steps.filter(step => step.id !== inputStep.id)],
      initialStepId: normalizedInput.id,
    };
  }

  const existingIds = new Set(steps.map(step => step.id));
  let inputId = INITIAL_INPUT_STEP_ID;
  let suffix = 2;
  while (existingIds.has(inputId)) inputId = `${INITIAL_INPUT_STEP_ID}_${suffix++}`;

  const incoming = new Set<string>();
  for (const step of steps) {
    for (const nextId of getWorkflowNextStepIds(step)) {
      if (existingIds.has(nextId)) incoming.add(nextId);
    }
    for (const sourceId of Object.values(step.inputMap ?? {})) {
      if (existingIds.has(sourceId)) incoming.add(step.id);
    }
  }

  let entryIds = steps.filter(step => !incoming.has(step.id)).map(step => step.id);
  if (entryIds.length === 0 && existingIds.has(workflow.initialStepId)) {
    entryIds = [workflow.initialStepId];
  }

  const initialStep: WorkflowStep = {
    id: inputId,
    type: 'input',
    inputMap: {},
    nextStepIds: entryIds,
    enabled: true,
  };

  return {
    ...workflow,
    steps: [initialStep, ...steps],
    initialStepId: inputId,
  };
}
