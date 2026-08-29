import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderMarkdownFileName,
  renderMarkdownPublication,
} from '../core/publishing/MarkdownPublisher.js';

test('renders deterministic safe Markdown from persisted content records', () => {
  const output = renderMarkdownPublication([{
    storeId: 'store-1',
    item: {
      title: 'DeepSeek [Harness] <launch>',
      url: 'https://example.test/release?q=one',
      description: '<script>alert(1)</script> Reliable *agent* runtime.',
      published_date: '2025-01-01',
      source: 'Example & Co',
      author: 'A_User',
      category: 'AI',
    },
  }], {
    title: 'AI <Daily>',
    generatedAt: new Date('2025-01-02T03:04:05.000Z'),
    maxDescriptionChars: 200,
  });

  assert.equal(output, [
    '# AI &lt;Daily&gt;',
    '',
    '_Generated 2025-01-02T03:04:05.000Z · 1 item_',
    '',
    '## 1. [DeepSeek \\[Harness\\] &lt;launch&gt;](<https://example.test/release?q=one>)',
    '',
    '- **Source:** Example &amp; Co',
    '- **Author:** A\\_User',
    '- **Published:** 2025-01-01',
    '- **Category:** AI',
    '',
    '**Summary:** &lt;script&gt;alert(1)&lt;/script&gt; Reliable \\*agent\\* runtime.',
    '',
  ].join('\n'));
  assert.doesNotMatch(output, /<script>/);
});

test('omits unsafe link protocols and neutralizes Markdown block injection', () => {
  const output = renderMarkdownPublication([{
    item: {
      title: 'Unsafe link',
      url: 'javascript:alert(1)',
      description: '# injected heading 123456789',
    },
  }], {
    title: 'Archive',
    generatedAt: new Date('2025-01-01T00:00:00.000Z'),
    maxDescriptionChars: 30,
  });

  assert.match(output, /^## 1\. Unsafe link$/m);
  assert.doesNotMatch(output, /javascript:/);
  assert.match(output, /^\*\*Summary:\*\* # injected heading 123456789$/m);
});

test('keeps fence, thematic-break, and standalone markers out of line-leading position', () => {
  const markers = ['~~~', '---', '#', '-', '1.'];
  const output = renderMarkdownPublication(markers.map((description, index) => ({
    item: { title: `Marker ${index}`, description },
  })), {
    title: 'Safe structure',
    generatedAt: new Date('2025-01-01T00:00:00.000Z'),
  });

  const lines = output.split('\n');
  for (const marker of markers) assert.ok(lines.includes(`**Summary:** ${marker}`));
});

test('allows only basename Markdown filename templates with a date placeholder', () => {
  assert.equal(renderMarkdownFileName('daily-{date}.md', '2025-01-02'), 'daily-2025-01-02.md');
  assert.equal(renderMarkdownFileName('latest.md', '2025-01-02'), 'latest.md');
  assert.throws(() => renderMarkdownFileName('../{date}.md', '2025-01-02'), /must be a basename/);
  assert.throws(() => renderMarkdownFileName('{name}.md', '2025-01-02'), /supports only the \{date\}/);
  assert.throws(() => renderMarkdownFileName('{date}.txt', '2025-01-02'), /ending in \.md/);
  assert.throws(() => renderMarkdownFileName('CON.md', '2025-01-02'), /reserved on Windows/);
  assert.throws(() => renderMarkdownFileName('COM1.archive.md', '2025-01-02'), /reserved on Windows/);
  assert.throws(() => renderMarkdownFileName('{date}.md', '02-01-2025'), /Invalid publication date/);
});

test('enforces a total UTF-8 publication byte limit', () => {
  assert.throws(() => renderMarkdownPublication(Array.from({ length: 20 }, (_, index) => ({
    item: {
      title: `Item ${index}`,
      description: '内容'.repeat(100),
    },
  })), {
    title: 'Bounded archive',
    generatedAt: new Date('2025-01-01T00:00:00.000Z'),
    maxDescriptionChars: 1_000,
    maxBytes: 1_024,
  }), /exceeds maxBytes/);
});
