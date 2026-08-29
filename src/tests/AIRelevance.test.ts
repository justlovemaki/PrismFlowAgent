import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_RELEVANCE_CLASSIFIER_VERSION,
  aiRelevanceContentHash,
  aiRelevanceInputChars,
  aiRelevanceProfileFingerprint,
  assessAIRelevance,
  buildAIRelevanceCard,
  type RelevanceRecordLike,
} from '../core/content/AIRelevance.js';

function record(title: string, description = '', extra: Partial<RelevanceRecordLike> = {}): RelevanceRecordLike {
  return {
    storeId: 'a'.repeat(64), sourceId: 'rss:test', firstSeenAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
    item: { title, description, source: 'Fixture', category: 'news', published_date: '2026-08-20T00:00:00.000Z' },
    ...extra,
  };
}

test('classifies strong bilingual AI evidence and keeps ambiguous words conservative', () => {
  assert.equal(assessAIRelevance(record('DeepSeek 发布新的大语言模型')).verdict, 'matched-ai');
  assert.equal(assessAIRelevance(record('New machine learning and autonomous driving research')).verdict, 'matched-ai');
  assert.equal(assessAIRelevance(record('AI stock rises')).verdict, 'ambiguous');
  assert.equal(assessAIRelevance(record('Football training schedule')).verdict, 'ambiguous');
  assert.equal(assessAIRelevance(record('The said agreement')).verdict, 'unmatched');
  assert.equal(assessAIRelevance(record('DeepSeek发布新模型')).verdict, 'matched-ai');
  assert.equal(assessAIRelevance(record('ChatGPT发布新功能')).verdict, 'matched-ai');
  assert.equal(assessAIRelevance(record('AI技术动态')).verdict, 'ambiguous');
  assert.equal(AI_RELEVANCE_CLASSIFIER_VERSION, 'ai-relevance-lexical-v1');
});

test('content hash ignores timestamps but changes with classification inputs', () => {
  const initial = record('AI safety proposal', 'Artificial intelligence regulation details');
  const timestampOnly = { ...initial, updatedAt: '2030-01-01T00:00:00.000Z', firstSeenAt: '2030-01-01T00:00:00.000Z' };
  assert.equal(aiRelevanceContentHash(initial), aiRelevanceContentHash(timestampOnly));
  assert.notEqual(aiRelevanceContentHash(initial), aiRelevanceContentHash(record('AI safety proposal changed', initial.item.description as string)));
  assert.notEqual(aiRelevanceContentHash(record('Title', 'a  b')), aiRelevanceContentHash(record('Title', 'a b')));
  assert.equal(aiRelevanceInputChars(record('Title', 'Body')), 20);
  assert.throws(() => aiRelevanceContentHash(record('Title', 'x'.repeat(2_000)), 1_024), /per-record limit/);
  assert.notEqual(
    aiRelevanceProfileFingerprint({ maxScanCharsPerRecord: 4096, maxEvidence: 8, maxEvidenceChars: 160, maxCardChars: 2000 }),
    aiRelevanceProfileFingerprint({ maxScanCharsPerRecord: 8192, maxEvidence: 8, maxEvidenceChars: 160, maxCardChars: 2000 }),
  );
});

test('truncated scans fail into ambiguity and evidence/cards remain bounded', () => {
  const input = record('Ordinary report', 'x'.repeat(20_000));
  const assessment = assessAIRelevance(input, { maxScanChars: 1_024, maxEvidenceChars: 40, maxEvidence: 2 });
  assert.equal(assessment.verdict, 'ambiguous');
  assert.equal(assessment.truncated, true);
  const matched = assessAIRelevance(record('AI', `${'x'.repeat(100)} machine learning ${'y'.repeat(100)}`), { maxEvidenceChars: 40 });
  assert.ok(matched.evidence.every(item => item.excerpt.length <= 40));
  const card = buildAIRelevanceCard(input, assessment, 512);
  const encoded = JSON.stringify(card);
  assert.ok(encoded.length <= 512);
  assert.equal(encoded.includes('x'.repeat(500)), false);
  assert.equal(Object.hasOwn(card, 'description'), false);
  assert.equal(Object.hasOwn(card, 'content'), false);

  const weak = assessAIRelevance(record('AI stock rises'));
  const weakCard = buildAIRelevanceCard(record('AI stock rises'), weak, 1_000);
  const weakEvidence = (weakCard.evidence as Array<Record<string, unknown>>)[0];
  assert.equal(Object.hasOwn(weakEvidence, 'topic'), false);
  assert.equal(JSON.stringify(weakCard).includes('undefined'), false);
});
