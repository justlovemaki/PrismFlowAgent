import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAISearchPrompt,
  normalizeAISearchItems,
  parseAISearchItems,
} from '../core/sources/AISearchSource.js';

test('builds a bounded AI Search research prompt', () => {
  const prompt = buildAISearchPrompt('DeepSeek Harness', 5);
  assert.match(prompt, /DeepSeek Harness/);
  assert.match(prompt, /最多返回 5 条/);
  assert.match(prompt, /真实 URL/);
  assert.match(prompt, /结构化输出/);
  assert.throws(() => buildAISearchPrompt('', 5), /keyword is required/);
  assert.throws(() => buildAISearchPrompt('test', 51), /limit must be an integer from 1 to 50/);
});

test('parses array, fenced, and object-wrapped AI Search results', () => {
  const item = {
    title: 'Harness released',
    url: 'https://example.test/harness',
    description: 'Release notes',
    content: 'Detailed release notes',
  };

  assert.deepEqual(parseAISearchItems(JSON.stringify([item])), [item]);
  assert.deepEqual(parseAISearchItems(`\`\`\`json\n${JSON.stringify([item])}\n\`\`\``), [item]);
  assert.deepEqual(parseAISearchItems(JSON.stringify({ items: [item] })), [item]);
  assert.deepEqual(parseAISearchItems('not json'), []);
});

test('normalizes AI Search items with provenance metadata', () => {
  const normalized = normalizeAISearchItems([{
    title: 'Harness released',
    url: 'https://example.test/harness',
    description: 'Release notes',
    content: '<p>Detailed release notes</p>',
    author: 'Example',
    published_date: '2025-01-01',
    metadata: { score: 10 },
  }], {
    sourceName: 'Harness Research',
    category: 'aiSearch',
    keyword: 'DeepSeek Harness',
    executorId: 'dsh-subagent:spawn',
    now: new Date('2025-01-02T00:00:00.000Z'),
  });

  assert.equal(normalized.length, 1);
  assert.match(normalized[0].id, /^ai-search-Harness Research-0-[a-f0-9]{8}$/);
  assert.deepEqual(normalized[0], {
    id: normalized[0].id,
    title: 'Harness released',
    url: 'https://example.test/harness',
    description: 'Release notes',
    published_date: '2025-01-01',
    ingestion_date: '2025-01-02',
    source: 'Example',
    category: 'aiSearch',
    author: 'Example',
    metadata: {
      score: 10,
      content_html: '<p>Detailed release notes</p>',
      is_ai_generated: true,
      keyword: 'DeepSeek Harness',
      executor_id: 'dsh-subagent:spawn',
    },
  });
});

test('skips malformed, empty, and non-web AI Search items while retaining later valid results', () => {
  const normalized = normalizeAISearchItems([
    null as unknown as { title?: unknown },
    { title: 'Empty', url: 'https://example.test/empty', content: '' },
    { title: 'Object content', url: 'https://example.test/object', content: { text: 'bad variant' } },
    { title: 'No real URL', url: '#', content: 'Not admissible' },
    { title: 'Valid', url: 'https://example.test/valid', description: '', content: 'Retained content' },
  ], { sourceName: 'Research', category: 'aiSearch', keyword: 'AI', executorId: 'spawn', now: new Date('2025-01-02T00:00:00.000Z') });
  assert.deepEqual(normalized.map(item => item.title), ['Valid']);
  assert.equal(normalized[0].metadata.content_html, 'Retained content');
});
