import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowDefinition } from '../types/agent.js';
import { WorkflowEngine } from '../services/agents/WorkflowEngine.js';
import type { LocalStore } from '../services/LocalStore.js';
import type { AgentService } from '../services/agents/AgentService.js';
import type { AIProvider } from '../services/AIProvider.js';
import { ensureInitialInputStep } from '../utils/workflow.js';

test('adds a dedicated input node before legacy workflow roots', () => {
  const legacy: WorkflowDefinition = {
    id: 'legacy',
    name: 'Legacy workflow',
    description: '',
    initialStepId: 'step_1',
    steps: [
      { id: 'step_1', type: 'agent', agentId: 'agent_1', inputMap: {}, nextStepIds: ['step_2'] },
      { id: 'step_2', type: 'agent', agentId: 'agent_2', inputMap: {}, nextStepIds: [] },
    ],
  };

  const normalized = ensureInitialInputStep(legacy);

  assert.equal(normalized.steps[0].type, 'input');
  assert.equal(normalized.initialStepId, normalized.steps[0].id);
  assert.deepEqual(normalized.steps[0].nextStepIds, ['step_1']);
});

test('input node returns the exact workflow input unchanged', async () => {
  const workflow: WorkflowDefinition = {
    id: 'input_only',
    name: 'Input only',
    description: '',
    initialStepId: 'initial_input',
    steps: [
      { id: 'initial_input', type: 'input', inputMap: {}, nextStepIds: [], enabled: true },
    ],
  };
  const store = { getWorkflow: async () => workflow } as unknown as LocalStore;
  const engine = new WorkflowEngine(
    store,
    {} as AgentService,
    {} as AIProvider,
  );
  const input = { title: 'same object', items: [1, 2, 3] };

  const output = await engine.runWorkflow(workflow.id, input);

  assert.strictEqual(output, input);
});

test('empty initial data still reaches the next node', async () => {
  const workflow: WorkflowDefinition = {
    id: 'empty_input',
    name: 'Empty input',
    description: '',
    initialStepId: 'initial_input',
    steps: [
      { id: 'initial_input', type: 'input', inputMap: {}, nextStepIds: ['step_1'], enabled: true },
      { id: 'step_1', type: 'agent', agentId: 'agent_1', inputMap: {}, nextStepIds: [] },
    ],
  };
  const store = { getWorkflow: async () => workflow } as unknown as LocalStore;
  let receivedInput: string | undefined;
  const agentService = {
    runAgent: async (_agentId: string, input: string) => {
      receivedInput = input;
      return { content: 'handled' };
    },
  } as unknown as AgentService;
  const engine = new WorkflowEngine(store, agentService, {} as AIProvider);

  const output = await engine.runWorkflow(workflow.id, '');

  assert.equal(receivedInput, '');
  assert.equal(output, 'handled');
});
