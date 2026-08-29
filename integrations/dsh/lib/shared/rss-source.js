// Generated from src/core/sources/RssSource.ts by integrations/dsh/scripts/sync-shared.mjs.
import { createHash } from 'node:crypto';
import Parser from 'rss-parser';
const DEFAULT_USER_AGENT = 'PrismFlowAgent/1.0';
const MAX_RSS_ITEMS = 1000;
function asString(value, fallback = '') {
    if (value === undefined || value === null)
        return fallback;
    return String(value);
}
function cleanText(value) {
    return asString(value)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/```css[\s\S]*?```/gi, ' ')
        .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, (_match, src, alt) => (alt ? `[图片: ${alt} ${src}]` : `[图片: ${src}]`))
        .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '[图片: $1]')
        .replace(/<video[^>]*src="([^"]*)"[^>]*>.*?<\/video>/gi, '[视频: $1]')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}
function shanghaiDate(date) {
    return date.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Shanghai',
    });
}
function stableItemId(feedId, item, index) {
    const explicit = item.guid ?? item.link ?? item.id;
    if (explicit !== undefined && explicit !== null && String(explicit).length > 0) {
        return String(explicit);
    }
    return `rss-${createHash('sha256')
        .update(`${feedId}\0${asString(item.title)}\0${asString(item.pubDate)}\0${index}`)
        .digest('hex')
        .slice(0, 24)}`;
}
function resolveLimit(requested, configured) {
    const value = requested ?? configured;
    if (!Number.isInteger(value) || value < 1) {
        throw new Error('RSS fetch limit must be a positive integer');
    }
    return Math.min(value, configured, MAX_RSS_ITEMS);
}
export function validateRssFeedDefinition(feed) {
    if (!feed.id.trim())
        throw new Error('RSS feed id is required');
    if (!feed.name.trim())
        throw new Error(`RSS feed ${feed.id} name is required`);
    const url = new URL(feed.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`RSS feed ${feed.id} must use http or https`);
    }
    if (!Number.isInteger(feed.limit) || feed.limit < 1 || feed.limit > MAX_RSS_ITEMS) {
        throw new Error(`RSS feed ${feed.id} limit must be an integer from 1 to ${MAX_RSS_ITEMS}`);
    }
}
export async function fetchParsedRssFeed(feed, options = {}) {
    validateRssFeedDefinition(feed);
    const limit = resolveLimit(options.limit, feed.limit);
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(feed.url, {
        headers: {
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        },
        signal: options.signal,
    });
    if (!response.ok) {
        throw new Error(`RSS fetch failed for ${feed.id}: ${response.status} ${response.statusText}`);
    }
    const parser = new Parser();
    const parsed = await parser.parseString(await response.text());
    return {
        title: asString(parsed.title, feed.name),
        items: (parsed.items ?? []).slice(0, limit),
    };
}
export function normalizeParsedRssFeed(rawFeed, options) {
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const results = [];
    const items = Array.isArray(rawFeed?.items) ? rawFeed.items : [];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        try {
            if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.title !== 'string' || !item.title.trim())
                continue;
            const rawContent = item.contentSnippet ?? item.content ?? item.summary;
            if (typeof rawContent !== 'string' || !rawContent.trim())
                continue;
            const description = cleanText(rawContent);
            if (!description)
                continue;
            results.push({
                id: stableItemId(options.feedId, item, index),
                title: item.title,
                url: typeof item.link === 'string' ? item.link : '',
                description,
                published_date: typeof (item.isoDate ?? item.pubDate) === 'string' ? String(item.isoDate ?? item.pubDate) : nowIso,
                ingestion_date: shanghaiDate(now),
                source: rawFeed.title || options.name,
                category: options.category,
                author: typeof (item.creator ?? item.author) === 'string' ? String(item.creator ?? item.author) : '',
            });
        }
        catch {
            // A malformed feed entry is isolated; later entries must still be admitted.
        }
    }
    return results;
}
