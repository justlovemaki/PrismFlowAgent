// Generated from src/core/sources/FollowSource.ts by integrations/dsh/scripts/sync-shared.mjs.
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const MAX_FETCH_DAYS = 365;
const MAX_FETCH_PAGES = 20;
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
function headers(options, withJson) {
    return {
        'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        Origin: 'https://app.folo.is',
        Priority: 'u=1, i',
        'Sec-CH-UA': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'X-App-Name': 'Folo Web',
        'X-App-Platform': 'desktop/web',
        'X-App-Version': '1.12.0',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(withJson ? { 'Content-Type': 'application/json' } : {}),
    };
}
function sleep(milliseconds, implementation) {
    if (milliseconds <= 0)
        return Promise.resolve();
    return implementation
        ? implementation(milliseconds)
        : new Promise(resolve => setTimeout(resolve, milliseconds));
}
function parseEntries(value) {
    if (!value || typeof value !== 'object')
        return [];
    const data = value.data;
    return Array.isArray(data) ? data : [];
}
export function validateFollowSourceDefinition(definition) {
    if (!definition.id.trim())
        throw new Error('Follow source id is required');
    if (!definition.name.trim())
        throw new Error(`Follow source ${definition.id} name is required`);
    if (!definition.listId && !definition.feedId) {
        throw new Error(`Follow source ${definition.id} requires listId or feedId`);
    }
    const url = new URL(definition.apiUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Follow source ${definition.id} must use http or https`);
    }
    if (!Number.isInteger(definition.fetchDays) || definition.fetchDays < 1 || definition.fetchDays > MAX_FETCH_DAYS) {
        throw new Error(`Follow source ${definition.id} fetchDays must be an integer from 1 to ${MAX_FETCH_DAYS}`);
    }
    if (!Number.isInteger(definition.fetchPages) || definition.fetchPages < 1 || definition.fetchPages > MAX_FETCH_PAGES) {
        throw new Error(`Follow source ${definition.id} fetchPages must be an integer from 1 to ${MAX_FETCH_PAGES}`);
    }
    if (!Number.isInteger(definition.view) || definition.view < 0) {
        throw new Error(`Follow source ${definition.id} view must be a non-negative integer`);
    }
}
export async function fetchFollowEntries(definition, options = {}) {
    validateFollowSourceDefinition(definition);
    const fetchImpl = options.fetchImpl ?? fetch;
    const allEntries = [];
    let publishedAfter;
    for (let page = 0; page < definition.fetchPages; page += 1) {
        const body = { view: definition.view };
        if (definition.view === 1)
            body.withContent = true;
        if (definition.listId)
            body.listId = definition.listId;
        if (definition.feedId)
            body.feedId = definition.feedId;
        if (publishedAfter)
            body.publishedAfter = publishedAfter;
        const response = await fetchImpl(definition.apiUrl, {
            method: 'POST',
            headers: headers(options, true),
            body: JSON.stringify(body),
            signal: options.signal,
        });
        if (!response.ok) {
            if (page === 0) {
                throw new Error(`Follow fetch failed for ${definition.id}: ${response.status} ${response.statusText}`);
            }
            break;
        }
        const pageEntries = parseEntries(await response.json());
        if (pageEntries.length === 0)
            break;
        allEntries.push(...pageEntries);
        const lastPublishedAt = pageEntries.at(-1)?.entries?.publishedAt;
        publishedAfter = lastPublishedAt === undefined || lastPublishedAt === null
            ? undefined
            : String(lastPublishedAt);
        if (page < definition.fetchPages - 1) {
            await sleep(options.pageDelayMs ?? 0, options.sleepImpl);
        }
    }
    return { data: allEntries };
}
async function fetchEntryContent(definition, entryId, options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const url = new URL(definition.apiUrl);
    url.searchParams.set('id', entryId);
    const response = await fetchImpl(url, {
        method: 'GET',
        headers: headers(options, false),
        signal: options.signal,
    });
    if (!response.ok) {
        throw new Error(`Follow detail fetch failed for ${entryId}: ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    const content = json.data?.content ?? json.data?.entries?.content;
    return typeof content === 'string' ? content : '';
}
export async function normalizeFollowEntries(rawData, definition, options = {}) {
    validateFollowSourceDefinition(definition);
    const now = options.now ?? new Date();
    const cutoff = now.getTime() - definition.fetchDays * 24 * 60 * 60 * 1000;
    const limit = options.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 2000)) {
        throw new Error('Follow normalization limit must be an integer from 1 to 2000');
    }
    const results = [];
    const items = Array.isArray(rawData?.data) ? rawData.data : [];
    for (const item of items) {
        if (limit !== undefined && results.length >= limit)
            break;
        try {
            if (!item || typeof item !== 'object' || Array.isArray(item))
                continue;
            const entry = item.entries;
            if (!entry || typeof entry !== 'object' || Array.isArray(entry))
                continue;
            const publishedAt = typeof entry.publishedAt === 'string' ? entry.publishedAt : '';
            if (publishedAt) {
                const publishedTime = new Date(publishedAt).getTime();
                if (!Number.isFinite(publishedTime) || publishedTime < cutoff)
                    continue;
            }
            const id = typeof entry.id === 'string' ? entry.id.trim() : '';
            if (!id)
                continue;
            let content = typeof entry.content === 'string' ? entry.content : '';
            if (id && !content.trim()) {
                try {
                    content = await fetchEntryContent(definition, id, options);
                }
                catch (error) {
                    if (options.signal?.aborted)
                        throw options.signal.reason ?? error;
                    continue;
                }
                await sleep(options.detailDelayMs ?? 0, options.sleepImpl);
            }
            if (!content.trim())
                continue;
            const description = cleanText(content);
            if (!description && !/<(?:img|video)\b/i.test(content))
                continue;
            results.push({
                id,
                title: typeof entry.title === 'string' && entry.title.trim() ? entry.title : '无标题',
                url: typeof entry.url === 'string' ? entry.url : '',
                description,
                published_date: publishedAt || now.toISOString(),
                ingestion_date: shanghaiDate(now),
                source: typeof item.feeds?.title === 'string' && item.feeds.title.trim() ? item.feeds.title : definition.name,
                category: definition.category,
                author: typeof entry.author === 'string' ? entry.author : '',
                metadata: { content_html: content },
            });
        }
        catch (error) {
            if (options.signal?.aborted)
                throw options.signal.reason ?? error;
            // Isolate a malformed entry and continue with the remaining page data.
        }
    }
    return results;
}
