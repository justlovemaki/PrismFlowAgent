import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  aiSelectionContentHash,
  buildPackedMaterial,
  canonicalSelectionUrl,
  clusterAIEvents,
  estimateMaterialTokens,
  extractSelectionMedia,
  normalizedTitleTokens,
  packSelectionMaterials,
  rankDiverseEvents,
  selectionSha256,
  type SelectionCandidate,
} from '../core/content/AIContentSelection.js';

function candidate(id: string, title: string, options: { url?: string; source?: string; topics?: string[]; body?: string; origin?: 'local-match' | 'reviewed-ambiguous' } = {}): SelectionCandidate {
  const body = options.body ?? `${title} details and factual evidence. `.repeat(20);
  return {
    record: {
      storeId: id.padStart(64, '0'), sourceId: options.source ?? `rss:${id}`, firstSeenAt: '2026-08-20T00:00:00.000Z',
      item: { title, url: options.url ?? `https://example.test/${id}`, description: body, source: options.source ?? id, category: 'news', published_date: '2026-08-20T00:00:00.000Z' },
    },
    contentHash: id.repeat(64).slice(0, 64),
    assessment: { verdict: 'matched-ai', topics: (options.topics ?? ['foundation-models']) as never[], reasonCodes: [], evidence: [], scannedChars: body.length, truncated: false },
    relevanceOrigin: options.origin ?? 'local-match', effectiveTimestamp: Date.parse('2026-08-20T00:00:00.000Z'),
  };
}

test('normalizes URLs and multilingual title tokens deterministically', () => {
  assert.equal(canonicalSelectionUrl('https://EXAMPLE.com:443/a?utm_source=x&id=1#x'), 'https://example.com/a?id=1');
  assert.deepEqual(normalizedTitleTokens('DeepSeek 发布新模型'), normalizedTitleTokens('deepseek 发布新模型'));
  assert.ok(normalizedTitleTokens('DeepSeek发布新模型').includes('deepseek'));
});

test('clusters duplicate English/Chinese events conservatively and is permutation-stable', () => {
  const values = [
    candidate('1', 'DeepSeek releases new reasoning model', { source: 'rss:a' }),
    candidate('2', 'DeepSeek releases a new reasoning model', { source: 'rss:b' }),
    candidate('3', 'DeepSeek发布全新推理模型', { url: 'https://same.test/event?utm_source=a', source: 'rss:c' }),
    candidate('4', '完全无关的足球比赛结果', { topics: ['ai-compute'] }),
    candidate('5', '另一个标题', { url: 'https://same.test/event', source: 'rss:d' }),
  ];
  const first = clusterAIEvents(values);
  const second = clusterAIEvents([...values].reverse());
  assert.deepEqual(first.map(item => [item.clusterId, item.members.map(member => member.record.storeId)]), second.map(item => [item.clusterId, item.members.map(member => member.record.storeId)]));
  assert.equal(first.some(item => item.members.length === 2 && item.members.some(member => member.record.storeId.endsWith('3'))), true);
  assert.equal(first.some(item => item.members.some(member => member.record.storeId.endsWith('4')) && item.members.length > 1), false);
});

test('enforces clustering comparison limits and deterministic diverse ranking', () => {
  const values = Array.from({ length: 20 }, (_, index) => candidate(String(index + 1), `Machine learning model release ${index}`, { source: index < 10 ? 'rss:bulk' : `rss:${index}`, topics: [index % 2 ? 'machine-learning' : 'ai-compute'] }));
  assert.throws(() => clusterAIEvents(values, { maxBucketSize: 100, maxPairComparisons: 1 }), /comparison limit/);
  const clusters = clusterAIEvents(values, { maxPairComparisons: 10000 });
  const ranked = rankDiverseEvents(clusters, { maxItems: 8, maxPerSource: 2, longTailPercent: 25 });
  assert.ok(ranked.length <= 8);
  assert.ok(ranked.filter(item => item.cluster.representative.record.sourceId === 'rss:bulk').length <= 2);
  assert.deepEqual(ranked.map(item => item.cluster.clusterId), rankDiverseEvents([...clusters].reverse(), { maxItems: 8, maxPerSource: 2, longTailPercent: 25 }).map(item => item.cluster.clusterId));
});

test('enforces a bounded source quota before general diversity ranking', () => {
  const repositoryNames = ['alphaengine', 'bravostack', 'charliekit', 'deltaflow', 'echolab', 'foxtrotai', 'golfmodel'];
  const github = repositoryNames.map((name, index) => candidate(`g${index}`, `GitHub AI project ${name}`, {
    source: 'github-trending:daily', topics: [index % 2 ? 'machine-learning' : 'frameworks-deployment'],
  }));
  const other = Array.from({ length: 10 }, (_, index) => candidate(`o${index}`, `Other AI event ${index}`, { source: `rss:${index}` }));
  const ranked = rankDiverseEvents(clusterAIEvents([...github, ...other]), {
    maxItems: 10, maxPerSource: 8, sourceQuota: { sourceId: 'github-trending:daily', minItems: 3, maxItems: 5 },
  });
  const githubCount = ranked.filter(item => item.cluster.representative.record.sourceId === 'github-trending:daily').length;
  assert.ok(githubCount >= 3 && githubCount <= 5);
  assert.deepEqual(ranked.slice(0, 3).map(item => item.reasons[0]), ['source-quota', 'source-quota', 'source-quota']);
  assert.throws(() => rankDiverseEvents(clusterAIEvents(github.slice(0, 2)), {
    maxItems: 10, maxPerSource: 8, sourceQuota: { sourceId: 'github-trending:daily', minItems: 3, maxItems: 5 },
  }), /source quota cannot be satisfied/u);
});

test('extracts and deduplicates bounded media only from conservatively rendered source contexts', () => {
  const markdownImage = 'https://cdn.example.test/hero.jpg';
  const htmlImage = 'https://cdn.example.test/render?id=7';
  const video = 'https://cdn.example.test/demo.mp4';
  const poster = 'https://cdn.example.test/poster.png';
  const direct = 'https://cdn.example.test/extra.webp?size=2';
  const media = extractSelectionMedia(
    `![hero](${markdownImage}) repeat ${markdownImage} <img src="${htmlImage}">`,
    `<video src='${video}' poster="${poster}"></video> direct ${direct}. javascript://bad.jpg`,
    8,
  );
  assert.deepEqual(media, [{ kind: 'video', url: video }]);
  assert.deepEqual(extractSelectionMedia(`${markdownImage} ${video}`, '', 1), [{ kind: 'video', url: video }]);
});

test('extracts media from explicit metadata.content_html without admitting hidden or fallback media', () => {
  const image = 'https://cdn.example.test/content-html.jpg';
  const video = 'https://cdn.example.test/content-html.mp4';
  const poster = 'https://cdn.example.test/content-html-poster.webp';
  const hidden = 'https://cdn.example.test/content-html-hidden.jpg';
  const code = 'https://cdn.example.test/content-html-code.jpg';
  const fallback = 'https://cdn.example.test/content-html-fallback.jpg';
  const contentHtml = [
    `<article><img src="${image}"></article>`,
    `<video src="${video}" poster="${poster}"></video>`,
    `<div hidden><img src="${hidden}"></div>`,
    `<code><img src="${code}"></code>`,
    `<video><img src="${fallback}"></video>`,
  ].join('');
  assert.deepEqual(extractSelectionMedia('', '', 16, contentHtml), [{ kind: 'video', url: video }]);
});

test('source media extraction rejects escaped, code, comment, raw-text, and source-only lookalikes', () => {
  const hidden = (label: string) => `https://hidden.example.test/${label}.jpg`;
  const excludedTags = [
    'pre', 'code', 'script', 'style', 'template', 'textarea', 'title', 'xmp', 'iframe',
    'noembed', 'noframes', 'noscript', 'select', 'option', 'object',
  ];
  const hiddenHtml = excludedTags.map(tag => `<${tag}>![hidden](${hidden(tag)}) ${hidden(`${tag}-direct`)}</${tag}>`).join('\n');
  const body = [
    `\\![escaped](${hidden('escaped')})`,
    `\\<img src="${hidden('escaped-html')}">`,
    `\`![inline](${hidden('inline')}) ${hidden('inline-direct')}\``,
    `    ![indented](${hidden('indented')}) ${hidden('indented-direct')}`,
    '```md', `![fenced](${hidden('fenced')}) ${hidden('fenced-direct')}`, '```',
    '~~~html', `<img src="${hidden('tilde')}"> ${hidden('tilde-direct')}`, '~~~',
    `<!-- ![comment](${hidden('comment')}) ${hidden('comment-direct')} -->`,
    hiddenHtml,
    `<plaintext>![plain](${hidden('plaintext')}) ${hidden('plaintext-direct')}`,
    `<source src="${hidden('source-standalone')}">`,
    `<video><source src="${hidden('source-nested')}"></video>`,
    `<video><img src="${hidden('video-image')}">![fallback](${hidden('video-markdown')}) ${hidden('video-bare')}</video>`,
    `<div hidden><img src="${hidden('hidden-parent')}"></div>`,
    `<img hidden src="${hidden('hidden-image')}">`,
    `<p aria-hidden="true">![hidden](${hidden('aria-hidden')})</p>`,
    `<section style="color:red; display: none !important"><img src="${hidden('display-none')}"></section>`,
    `<div style="visibility:hidden">${hidden('visibility-hidden')}</div>`,
    `<div style="content-visibility: hidden">${hidden('content-hidden')}</div>`,
    `[ordinary link](${hidden('ordinary-link')})`,
  ].join('\n');
  assert.deepEqual(extractSelectionMedia(body, '', 64), []);

  const slashHidden = hidden('slash-hidden');
  assert.deepEqual(extractSelectionMedia(`<div hidden/><img src="${slashHidden}">`, '', 4), []);
  const slashVideoFallback = hidden('slash-video-fallback');
  assert.deepEqual(extractSelectionMedia(`<video/><img src="${slashVideoFallback}"></video>`, '', 4), []);

  const visible = 'https://cdn.example.test/visible.jpg';
  assert.deepEqual(extractSelectionMedia(`<div><p><img src="${visible}"></p></div>`, '', 4), [{ kind: 'image', url: visible }]);
});

test('packs bounded verbatim materials with stable hashes and conservative token estimates', () => {
  const mediaUrl = 'https://cdn.example.test/deepseek.png';
  const input = candidate('a', 'DeepSeek 大模型发布', { body: `开头事实。![模型图](${mediaUrl})${'中间证据。'.repeat(500)}结论事实。` });
  const material = buildPackedMaterial(input, 2000);
  assert.ok(JSON.stringify(material).length < 2600);
  assert.ok(material.excerpts.length > 0);
  assert.deepEqual(material.media, [{ kind: 'image', url: mediaUrl }]);
  const encoded = JSON.stringify({ storeId: material.storeId, title: material.title, url: material.url, source: material.source,
    author: material.author, publishedDate: material.publishedDate, category: material.category, excerpts: material.excerpts, media: material.media });
  assert.equal(material.materialChars, encoded.length);
  assert.equal(material.materialSha256, createHash('sha256').update(encoded).digest('hex'));
  for (const item of material.excerpts) assert.equal((input.record.item.description as string).slice(item.start, item.end).replace(/[\u0000\u007f]/gu, '').trim(), item.text);
  assert.ok(estimateMaterialTokens('中文AI model 123') >= 6);
  const clusters = clusterAIEvents([input]);
  const packed = packSelectionMaterials(rankDiverseEvents(clusters, { maxItems: 1 }), { maxMaterialChars: 4096, maxMaterialTokens: 2000, minCharsPerItem: 600, maxCharsPerItem: 2000 });
  assert.equal(packed.length, 1);
  assert.equal(selectionSha256({ a: 1, b: 2 }), selectionSha256({ b: 2, a: 1 }));

  Object.assign(input.record.item, {
    title: 'T'.repeat(5_000), url: `https://example.test/${'u'.repeat(5_000)}`,
    source: 'S'.repeat(5_000), author: 'A'.repeat(5_000), category: 'C'.repeat(5_000),
  });
  const minimum = buildPackedMaterial(input, 600);
  assert.ok(JSON.stringify(minimum).length <= 1_000);
  assert.ok(minimum.materialChars <= 600);
});

test('selection hash binds explicit metadata.content_html but ignores arbitrary metadata', () => {
  const input = candidate('content-html-hash', 'DeepSeek content HTML hash');
  const metadata = { content_html: '<img src="https://cdn.example.test/a.jpg">', ignored: 'first' };
  input.record.item.metadata = metadata;
  const initial = aiSelectionContentHash(input.record);
  metadata.ignored = 'second';
  assert.equal(aiSelectionContentHash(input.record), initial);
  metadata.content_html = '<img src="https://cdn.example.test/b.jpg">';
  assert.notEqual(aiSelectionContentHash(input.record), initial);
});

test('selection hash accepts relevance-ceiling bodies plus ordinary metadata and fails above its profile ceiling', () => {
  const input = candidate('hash', 'DeepSeek hash capacity');
  input.record.item.description = 'x'.repeat(10_000_000);
  assert.match(aiSelectionContentHash(input.record), /^[a-f0-9]{64}$/u);
  input.record.item.description = 'x'.repeat(12_000_000);
  assert.throws(() => aiSelectionContentHash(input.record, 12_000_000), /exceeds the configured limit/);
  assert.match(aiSelectionContentHash(input.record, 20_000_000), /^[a-f0-9]{64}$/u);
});
