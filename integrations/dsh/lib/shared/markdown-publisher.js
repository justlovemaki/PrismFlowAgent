// Generated from src/core/publishing/MarkdownPublisher.ts by integrations/dsh/scripts/sync-shared.mjs.
function inlineText(value, fallback = '', maxChars = 500) {
    if (value === undefined || value === null)
        return fallback;
    return String(value)
        .slice(0, maxChars)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function escapeMarkdown(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/([\\`*_[\]{}])/g, '\\$1');
}
function safeHttpUrl(value) {
    if (typeof value !== 'string' || value.trim() === '' || value.length > 2_048)
        return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:')
            return undefined;
        return url.toString().replace(/>/g, '%3E');
    }
    catch {
        return undefined;
    }
}
function truncate(value, maxChars) {
    return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
export function markdownSnapshotTime(records, fallback) {
    const latest = records.reduce((maximum, record) => {
        const parsed = typeof record.updatedAt === 'string' ? Date.parse(record.updatedAt) : Number.NaN;
        return Number.isFinite(parsed) ? Math.max(maximum, parsed) : maximum;
    }, 0);
    return latest > 0 ? new Date(latest) : fallback;
}
export function renderMarkdownFileName(pattern, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error(`Invalid publication date: ${date}`);
    if (!pattern || pattern.replaceAll('{date}', '').includes('{') || pattern.replaceAll('{date}', '').includes('}')) {
        throw new Error('Markdown filename pattern supports only the {date} placeholder');
    }
    const fileName = pattern.replaceAll('{date}', date);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(fileName)) {
        throw new Error(`Markdown filename must be a basename ending in .md: ${fileName}`);
    }
    const stem = fileName.slice(0, fileName.indexOf('.')).toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
        throw new Error(`Markdown filename is reserved on Windows: ${fileName}`);
    }
    return fileName;
}
export function renderMarkdownPublication(records, options) {
    const maxDescriptionChars = options.maxDescriptionChars ?? 1_000;
    if (!Number.isInteger(maxDescriptionChars) || maxDescriptionChars < 1 || maxDescriptionChars > 10_000) {
        throw new Error('maxDescriptionChars must be an integer from 1 to 10000');
    }
    const maxBytes = options.maxBytes ?? 1_000_000;
    if (!Number.isInteger(maxBytes) || maxBytes < 1_024 || maxBytes > 2_000_000) {
        throw new Error('maxBytes must be an integer from 1024 to 2000000');
    }
    const title = escapeMarkdown(inlineText(options.title, 'PrismFlow Content', 200));
    const lines = [
        `# ${title}`,
        '',
        `_Generated ${options.generatedAt.toISOString()} · ${records.length} item${records.length === 1 ? '' : 's'}_`,
        '',
    ];
    records.forEach((record, index) => {
        const item = record.item ?? {};
        const itemTitle = escapeMarkdown(inlineText(item.title, 'Untitled', 500));
        const url = safeHttpUrl(item.url);
        lines.push(url ? `## ${index + 1}. [${itemTitle}](<${url}>)` : `## ${index + 1}. ${itemTitle}`);
        lines.push('');
        const source = escapeMarkdown(inlineText(item.source, '', 300));
        const author = escapeMarkdown(inlineText(item.author, '', 300));
        const published = escapeMarkdown(inlineText(item.published_date, '', 100));
        const category = escapeMarkdown(inlineText(item.category, '', 300));
        if (source)
            lines.push(`- **Source:** ${source}`);
        if (author)
            lines.push(`- **Author:** ${author}`);
        if (published)
            lines.push(`- **Published:** ${published}`);
        if (category)
            lines.push(`- **Category:** ${category}`);
        if (source || author || published || category)
            lines.push('');
        const description = truncate(escapeMarkdown(inlineText(item.description, '', maxDescriptionChars)), maxDescriptionChars);
        if (description) {
            lines.push(`**Summary:** ${description}`);
            lines.push('');
        }
    });
    const output = `${lines.join('\n').trimEnd()}\n`;
    const bytes = Buffer.byteLength(output, 'utf8');
    if (bytes > maxBytes)
        throw new Error(`Markdown publication exceeds maxBytes (${bytes} > ${maxBytes})`);
    return output;
}
