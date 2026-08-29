import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, '..')
const repositoryRoot = path.resolve(packageRoot, '..', '..')
const checkOnly = process.argv.includes('--check')

const modules = [
  {
    source: path.join(repositoryRoot, 'src', 'core', 'sources', 'RssSource.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'rss-source.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'sources', 'GitHubTrendingSource.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'github-trending-source.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'sources', 'FollowSource.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'follow-source.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'sources', 'AISearchSource.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'ai-search-source.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'content', 'ContentStore.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'content-store.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'content', 'AIRelevance.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'ai-relevance.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'content', 'AIContentSelection.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'ai-content-selection.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'production', 'ContentProduction.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'content-production.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'publishing', 'MarkdownPublisher.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'markdown-publisher.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'publishing', 'GitHubPublisher.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'github-publisher.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'publishing', 'R2Publisher.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'r2-publisher.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'publishing', 'PublicationReceipt.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'publication-receipt.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'publishing', 'PublisherOutcome.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'publisher-outcome.js'),
  },
  {
    source: path.join(repositoryRoot, 'src', 'core', 'publishing', 'WechatPublisher.ts'),
    output: path.join(packageRoot, 'lib', 'shared', 'wechat-publisher.js'),
  },
]

function transpile(sourcePath, source) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      sourceMap: false,
      declaration: false,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  })

  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const host = {
      getCanonicalFileName: fileName => fileName,
      getCurrentDirectory: () => repositoryRoot,
      getNewLine: () => '\n',
    }
    throw new Error(ts.formatDiagnostics(errors, host))
  }

  const relativeSource = path.relative(repositoryRoot, sourcePath).replaceAll('\\', '/')
  const output = relativeSource === 'src/core/production/ContentProduction.ts'
    ? result.outputText.replace("../content/AIContentSelection.js", './ai-content-selection.js')
    : result.outputText
  return `// Generated from ${relativeSource} by integrations/dsh/scripts/sync-shared.mjs.\n${output}`
}

for (const entry of modules) {
  const source = await fs.readFile(entry.source, 'utf8')
  const output = transpile(entry.source, source)

  if (checkOnly) {
    const current = await fs.readFile(entry.output, 'utf8').catch(() => '')
    if (current !== output) {
      throw new Error(`DSH shared runtime is stale: ${path.relative(repositoryRoot, entry.output)}. Run: npm --prefix integrations/dsh run sync:shared`)
    }
  } else {
    await fs.mkdir(path.dirname(entry.output), { recursive: true })
    await fs.writeFile(entry.output, output)
    console.log(`Synced ${path.relative(repositoryRoot, entry.output)}`)
  }
}

if (checkOnly) {
  console.log(`DSH shared runtimes are up to date (${modules.length})`)
}
