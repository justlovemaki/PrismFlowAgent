import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGitHubTrendingUrl,
  fetchGitHubTrending,
  normalizeGitHubTrending,
  parseGitHubTrendingHtml,
  validateGitHubTrendingDefinition,
  type GitHubTrendingDefinition,
} from '../core/sources/GitHubTrendingSource.js';

const definition: GitHubTrendingDefinition = {
  id: 'daily',
  name: 'GitHub Trending Daily',
  baseUrl: 'https://github.com/trending',
  category: 'githubTrending',
  since: 'daily',
  spokenLanguageCode: 'en',
  limit: 25,
};

const TRENDING_HTML = `<!doctype html>
<html>
  <body>
    <article class="Box-row">
      <h2 class="h3 lh-condensed">
        <a href="/deepseek-ai/deepseek-v4">deepseek-ai / deepseek-v4</a>
      </h2>
      <p class="col-9 color-fg-muted my-1 pr-4">A <strong>fast</strong> reasoning model</p>
      <span class="repo-language-color" style="background-color: #3572A5"></span>
      <span itemprop="programmingLanguage">Python</span>
      <a href="/deepseek-ai/deepseek-v4/stargazers"><svg></svg>12,345</a>
      <a href="/deepseek-ai/deepseek-v4/forks"><svg></svg>678</a>
      <span><svg></svg>1,234 stars today</span>
      <img class="avatar mb-1" src="https://avatars.example.test/one.png" />
    </article>
    <article class="Box-row">
      <h2 class="h3 lh-condensed">
        <a href="/example/second">example / second</a>
      </h2>
      <p class="col-9 color-fg-muted my-1 pr-4">Second repository</p>
      <span itemprop="programmingLanguage">TypeScript</span>
      <a href="/example/second/stargazers">42</a>
      <span>5 stars today</span>
    </article>
  </body>
</html>`;

test('validates and builds a GitHub Trending URL', () => {
  assert.doesNotThrow(() => validateGitHubTrendingDefinition(definition));
  assert.throws(
    () => validateGitHubTrendingDefinition({ ...definition, since: 'yearly' as 'daily' }),
    /invalid since value/,
  );

  const url = new URL(buildGitHubTrendingUrl(definition));
  assert.equal(url.origin + url.pathname, definition.baseUrl);
  assert.equal(url.searchParams.get('since'), 'daily');
  assert.equal(url.searchParams.get('spoken_language_code'), 'en');
});

test('parses repository data from GitHub Trending markup', () => {
  const repositories = parseGitHubTrendingHtml(TRENDING_HTML);
  assert.equal(repositories.length, 2);
  assert.deepEqual(repositories[0], {
    url: 'https://github.com/deepseek-ai/deepseek-v4',
    owner: 'deepseek-ai',
    name: 'deepseek-v4',
    description: 'A fast reasoning model',
    language: 'Python',
    languageColor: '#3572A5',
    totalStars: 12345,
    forks: 678,
    starsToday: 1234,
    builtBy: ['https://avatars.example.test/one.png'],
  });
});

test('fetches, limits, and normalizes GitHub Trending through the shared core', async () => {
  const controller = new AbortController();
  let requestedUrl = '';
  let observedSignal: AbortSignal | null | undefined;

  const repositories = await fetchGitHubTrending(definition, {
    limit: 1,
    signal: controller.signal,
    userAgent: 'PrismFlow-Test/1.0',
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      observedSignal = init?.signal;
      assert.equal(new Headers(init?.headers).get('user-agent'), 'PrismFlow-Test/1.0');
      return new Response(TRENDING_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    },
  });

  assert.equal(requestedUrl, buildGitHubTrendingUrl(definition));
  assert.equal(observedSignal, controller.signal);
  assert.equal(repositories.length, 1);

  const normalized = normalizeGitHubTrending(repositories, {
    sourceName: definition.name,
    category: definition.category,
    now: new Date('2025-01-02T00:00:00.000Z'),
  });

  assert.deepEqual(normalized, [{
    id: 'gh-deepseek-ai-deepseek-v4',
    title: 'deepseek-v4',
    url: 'https://github.com/deepseek-ai/deepseek-v4',
    description: 'A fast reasoning model\n[GitHub 统计] 总Star: 12345 | 今日Star: 1234 | Fork: 678',
    published_date: '2025-01-02T00:00:00.000Z',
    ingestion_date: '2025-01-02',
    source: 'GitHub Trending Daily',
    category: 'githubTrending',
    author: 'deepseek-ai',
    metadata: {
      language: 'Python',
      stars: 12345,
      starsToday: 1234,
      forks: 678,
    },
  }]);
});

test('skips malformed and content-empty GitHub rows without interrupting later valid repositories', () => {
  const normalized = normalizeGitHubTrending([
    null as unknown as Parameters<typeof normalizeGitHubTrending>[0][number],
    { owner: 'empty', name: 'empty', url: 'https://github.com/empty/empty', description: '', language: '', languageColor: '', totalStars: 0, forks: 0, starsToday: 0, builtBy: [] },
    { owner: 'valid', name: 'repository', url: 'https://github.com/valid/repository', description: 'Retained', language: 'TypeScript', languageColor: '', totalStars: 1, forks: 0, starsToday: 0, builtBy: [] },
  ], { sourceName: definition.name, category: definition.category, now: new Date('2025-01-02T00:00:00.000Z') });
  assert.deepEqual(normalized.map(item => item.id), ['gh-valid-repository']);
});
