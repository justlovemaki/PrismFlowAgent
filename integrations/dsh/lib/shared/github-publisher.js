// Generated from src/core/publishing/GitHubPublisher.ts by integrations/dsh/scripts/sync-shared.mjs.
function requirePlainText(value, name, maxLength) {
    if (!value || value.trim() !== value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new Error(`${name} must be non-empty, trimmed, control-free, and at most ${maxLength} characters`);
    }
    return value;
}
export function parseGitHubRepository(value) {
    requirePlainText(value, 'GitHub repository', 140);
    const parts = value.split('/');
    if (parts.length !== 2)
        throw new Error('GitHub repository must use owner/repo format');
    const [owner, repo] = parts;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
        throw new Error(`Invalid GitHub repository owner: ${owner}`);
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$/.test(repo)) {
        throw new Error(`Invalid GitHub repository name: ${repo}`);
    }
    return { owner, repo };
}
export function normalizeGitHubApiBaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error(`Invalid GitHub API base URL: ${value}`);
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('GitHub API base URL must be HTTPS and contain no credentials, query, or fragment');
    }
    return url.toString().replace(/\/$/, '');
}
export function validateGitHubBranch(value) {
    const branch = requirePlainText(value, 'GitHub branch', 255);
    const segments = branch.split('/');
    if (branch === '@'
        || branch.startsWith('-')
        || branch.startsWith('/')
        || branch.endsWith('/')
        || branch.endsWith('.')
        || branch.includes('..')
        || branch.includes('//')
        || branch.includes('@{')
        || branch.includes('\\')
        || /[\s~^:?*\[\]]/.test(branch)
        || segments.some(segment => !segment || segment.startsWith('.') || segment.endsWith('.lock'))) {
        throw new Error(`Invalid GitHub branch: ${branch}`);
    }
    return branch;
}
export function validateGitHubPathPrefix(value) {
    if (value === '')
        return '';
    requirePlainText(value, 'GitHub pathPrefix', 500);
    if (value.startsWith('/') || value.endsWith('/') || value.includes('\\')) {
        throw new Error('GitHub pathPrefix must be a normalized relative POSIX path');
    }
    const segments = value.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
        throw new Error('GitHub pathPrefix contains an unsafe path segment');
    }
    return value;
}
export function buildGitHubPublicationPath(pathPrefix, fileName) {
    const prefix = validateGitHubPathPrefix(pathPrefix);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(fileName)) {
        throw new Error(`GitHub publication filename must be a Markdown basename: ${fileName}`);
    }
    return prefix ? `${prefix}/${fileName}` : fileName;
}
export function renderGitHubCommitMessage(pattern, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error(`Invalid GitHub publication date: ${date}`);
    if (!pattern || pattern.replaceAll('{date}', '').includes('{') || pattern.replaceAll('{date}', '').includes('}')) {
        throw new Error('GitHub commit message supports only the {date} placeholder');
    }
    return requirePlainText(pattern.replaceAll('{date}', date), 'GitHub commit message', 200);
}
export function buildGitHubContentsApiUrl(baseUrl, repository, path, branch) {
    const base = normalizeGitHubApiBaseUrl(baseUrl);
    const encodedPath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const url = new URL(`${base}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/contents/${encodedPath}`);
    if (branch !== undefined)
        url.searchParams.set('ref', validateGitHubBranch(branch));
    return url.toString();
}
