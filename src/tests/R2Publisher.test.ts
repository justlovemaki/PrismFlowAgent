import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildR2ApiEndpoint,
  buildR2ObjectKey,
  buildR2ObjectUrl,
  buildR2PublicObjectUrl,
  normalizeR2AccountId,
  normalizeR2PublicUrlPrefix,
  validateR2BucketName,
  validateR2PathPrefix,
} from '../core/publishing/R2Publisher.js';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';

test('validates Cloudflare R2 account, bucket, and object path configuration', () => {
  assert.equal(normalizeR2AccountId(ACCOUNT_ID.toUpperCase()), ACCOUNT_ID);
  assert.equal(validateR2BucketName('prismflow-archive'), 'prismflow-archive');
  assert.equal(validateR2PathPrefix('daily/ai'), 'daily/ai');
  assert.equal(buildR2ObjectKey('daily/ai', '2025-01-02.md'), 'daily/ai/2025-01-02.md');

  assert.throws(() => normalizeR2AccountId('not-an-account'), /32 hexadecimal/);
  for (const bucket of ['ABCD', 'ab', '192.168.1.1', 'bad..bucket', '-leading']) {
    assert.throws(() => validateR2BucketName(bucket), /DNS-compatible/);
  }
  for (const prefix of ['/daily', 'daily/', '../daily', 'daily//ai', 'daily\\ai', 'daily/%2e%2e']) {
    assert.throws(() => validateR2PathPrefix(prefix), /R2 pathPrefix/);
  }
  assert.throws(() => buildR2ObjectKey('daily', '../escape.md'), /Markdown basename/);
  assert.throws(() => buildR2ObjectKey('a'.repeat(500), `${'b'.repeat(600)}.md`), /1024 UTF-8 bytes/);
});

test('builds fixed-origin R2 API URLs and optional HTTPS public URLs', () => {
  assert.equal(buildR2ApiEndpoint(ACCOUNT_ID), `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`);
  assert.equal(
    buildR2ObjectUrl(ACCOUNT_ID, 'prismflow-archive', 'daily/2025-01-02.md'),
    `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/prismflow-archive/daily/2025-01-02.md`,
  );
  assert.equal(normalizeR2PublicUrlPrefix('https://content.example.test/prismflow/'), 'https://content.example.test/prismflow');
  assert.equal(
    buildR2PublicObjectUrl('https://content.example.test', 'daily/2025-01-02.md'),
    'https://content.example.test/daily/2025-01-02.md',
  );
  assert.equal(buildR2PublicObjectUrl(undefined, 'daily/2025-01-02.md'), undefined);
  for (const key of ['../escape.md', 'daily/../escape.md', 'daily/%2e%2e/escape.md', '/absolute.md']) {
    assert.throws(() => buildR2ObjectUrl(ACCOUNT_ID, 'prismflow-archive', key), /R2 object key/);
    assert.throws(() => buildR2PublicObjectUrl('https://content.example.test', key), /R2 object key/);
  }
  assert.throws(() => normalizeR2PublicUrlPrefix('http://content.example.test'), /must be HTTPS/);
  assert.throws(() => normalizeR2PublicUrlPrefix('https://user:pass@content.example.test'), /must be HTTPS/);
});
