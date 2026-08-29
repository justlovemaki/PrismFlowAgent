import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGitHubContentsApiUrl,
  buildGitHubPublicationPath,
  normalizeGitHubApiBaseUrl,
  parseGitHubRepository,
  renderGitHubCommitMessage,
  validateGitHubBranch,
  validateGitHubPathPrefix,
} from '../core/publishing/GitHubPublisher.js';

test('validates GitHub repository, API base URL, and publication paths', () => {
  assert.deepEqual(parseGitHubRepository('deepseek-ai/deepseek-harness'), {
    owner: 'deepseek-ai',
    repo: 'deepseek-harness',
  });
  assert.equal(normalizeGitHubApiBaseUrl('https://github.example/api/v3/'), 'https://github.example/api/v3');
  assert.equal(validateGitHubPathPrefix('daily/ai'), 'daily/ai');
  assert.equal(buildGitHubPublicationPath('daily/ai', '2025-01-02.md'), 'daily/ai/2025-01-02.md');
  assert.throws(() => parseGitHubRepository('owner/-bad'), /Invalid GitHub repository name/);
  assert.throws(() => parseGitHubRepository('owner-/repo'), /Invalid GitHub repository owner/);
  assert.throws(() => normalizeGitHubApiBaseUrl('http://github.example/api/v3'), /must be HTTPS/);
  assert.throws(() => normalizeGitHubApiBaseUrl('https://user:pass@github.example'), /must be HTTPS/);
  for (const branch of ['with space', 'a..b', 'name.lock', 'a@{b', 'a//b', '.hidden/main', '-option']) {
    assert.throws(() => validateGitHubBranch(branch), /Invalid GitHub branch/);
  }
  assert.equal(validateGitHubBranch('release/next'), 'release/next');
  assert.throws(() => validateGitHubPathPrefix('../daily'), /unsafe path segment/);
  assert.throws(() => buildGitHubPublicationPath('daily', '../escape.md'), /must be a Markdown basename/);
});

test('builds encoded GitHub Contents API URLs and bounded commit messages', () => {
  const repository = parseGitHubRepository('owner/repo');
  assert.equal(
    buildGitHubContentsApiUrl(
      'https://api.github.com',
      repository,
      'daily/2025-01-02.md',
      'release/next',
    ),
    'https://api.github.com/repos/owner/repo/contents/daily/2025-01-02.md?ref=release%2Fnext',
  );
  assert.equal(
    renderGitHubCommitMessage('chore: publish PrismFlow {date}', '2025-01-02'),
    'chore: publish PrismFlow 2025-01-02',
  );
  assert.throws(
    () => renderGitHubCommitMessage('publish {date} {unknown}', '2025-01-02'),
    /supports only the \{date\}/,
  );
});
