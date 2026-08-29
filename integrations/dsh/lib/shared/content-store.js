// Generated from src/core/content/ContentStore.ts by integrations/dsh/scripts/sync-shared.mjs.
import { createHash } from 'node:crypto';
function requireString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Content item ${field} must be a non-empty string`);
    }
    return value;
}
function jsonClone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    }
    catch (error) {
        throw new Error(`Content item must be JSON-serializable: ${String(error)}`);
    }
}
function normalizeStatus(value) {
    return value === 'read' || value === 'archived' ? value : 'unread';
}
function optionalString(value) {
    return typeof value === 'string' ? value : undefined;
}
function optionalJsonObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const cloned = jsonClone(value);
    return cloned !== null && typeof cloned === 'object' && !Array.isArray(cloned)
        ? cloned
        : undefined;
}
function hasInvalidUnicode(value) {
    if (typeof value !== 'string')
        return false;
    if (value.includes('\uFFFD'))
        return true;
    for (const character of value) {
        if (character.length === 1) {
            const code = character.charCodeAt(0);
            if (code >= 0xD800 && code <= 0xDFFF)
                return true;
        }
    }
    return false;
}
export function contentStoreId(sourceId, externalId) {
    requireString(sourceId, 'sourceId');
    requireString(externalId, 'id');
    return createHash('sha256')
        .update(sourceId)
        .update('\0')
        .update(externalId)
        .digest('hex');
}
export function prepareStoredContentRecord(sourceId, input, existing, now = new Date()) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Content item must be an object');
    }
    const raw = input;
    const id = requireString(raw.id, 'id');
    const title = requireString(raw.title, 'title');
    const description = typeof raw.description === 'string' ? raw.description : '';
    const rawMetadata = raw.metadata !== null && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
        ? raw.metadata : undefined;
    const contentHtml = typeof rawMetadata?.content_html === 'string' ? rawMetadata.content_html : '';
    const aiSummary = typeof rawMetadata?.ai_summary === 'string' ? rawMetadata.ai_summary : '';
    if ([sourceId, id, title, description, raw.content, raw.source, contentHtml, aiSummary].some(hasInvalidUnicode)) {
        throw new Error('Content item contains a Unicode replacement character or unpaired surrogate');
    }
    if (!description.trim() && !contentHtml.trim()) {
        throw new Error('Content item description or metadata.content_html must be non-empty');
    }
    const item = jsonClone({
        ...raw,
        id,
        title,
        url: typeof raw.url === 'string' ? raw.url : '',
        description,
        published_date: typeof raw.published_date === 'string' ? raw.published_date : '',
        ingestion_date: optionalString(raw.ingestion_date),
        source: typeof raw.source === 'string' ? raw.source : sourceId,
        category: typeof raw.category === 'string' ? raw.category : '',
        author: optionalString(raw.author),
        status: optionalString(raw.status),
        metadata: optionalJsonObject(raw.metadata),
    });
    const timestamp = now.toISOString();
    const storeId = contentStoreId(sourceId, item.id);
    if (existing && existing.storeId !== storeId) {
        throw new Error(`Existing content record does not match ${sourceId}:${item.id}`);
    }
    return {
        storeId,
        sourceId,
        externalId: item.id,
        firstSeenAt: existing?.firstSeenAt ?? timestamp,
        updatedAt: timestamp,
        fetchedAt: timestamp,
        status: existing?.status ?? normalizeStatus(item.status),
        item,
    };
}
function recordTimestamp(record) {
    const published = Date.parse(record.item.published_date);
    if (Number.isFinite(published))
        return published;
    const updated = Date.parse(record.updatedAt);
    return Number.isFinite(updated) ? updated : 0;
}
function matchesStoredContent(record, query, needle) {
    if (query.storeId && record.storeId !== query.storeId)
        return false;
    if (query.sourceId && record.sourceId !== query.sourceId)
        return false;
    if (query.category && record.item.category !== query.category)
        return false;
    if (query.status && record.status !== query.status)
        return false;
    if (!needle)
        return true;
    return [
        record.item.title,
        record.item.description,
        record.item.source,
        record.item.author,
        record.item.metadata?.ai_summary,
    ].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(needle));
}
export function countStoredContent(records, query = {}) {
    const needle = query.search?.trim().toLocaleLowerCase();
    let count = 0;
    for (const record of records) {
        if (matchesStoredContent(record, query, needle))
            count += 1;
    }
    return count;
}
export function queryStoredContent(records, query = {}) {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Content query limit must be an integer from 1 to 100');
    }
    if (!Number.isInteger(offset) || offset < 0) {
        throw new Error('Content query offset must be a non-negative integer');
    }
    const needle = query.search?.trim().toLocaleLowerCase();
    return Array.from(records)
        .filter(record => matchesStoredContent(record, query, needle))
        .sort((left, right) => recordTimestamp(right) - recordTimestamp(left)
        || right.updatedAt.localeCompare(left.updatedAt)
        || left.storeId.localeCompare(right.storeId))
        .slice(offset, offset + limit);
}
