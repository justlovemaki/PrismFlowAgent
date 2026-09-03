// Generated from src/core/content/AIContentSelection.ts by integrations/dsh/scripts/sync-shared.mjs.
import { createHash } from 'node:crypto';
export const AI_CONTENT_SELECTION_STRATEGY_VERSION = 'ai-selection-v4';
const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'from', 'by',
    'new', 'latest', 'today', 'report', 'update', 'announces', 'launches',
    '的', '了', '和', '与', '及', '在', '是', '新', '最新', '发布', '推出', '报告', '消息',
]);
function clean(value, max) {
    return typeof value === 'string'
        ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max)
        : '';
}
export function aiSelectionContentHash(record, maxChars = 12_000_000) {
    if (!Number.isInteger(maxChars) || maxChars < 1_024 || maxChars > 20_000_000)
        throw new Error('Selection content hash limit is invalid');
    const item = record.item;
    const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
        ? item.metadata : {};
    const fields = [
        ['sourceId', record.sourceId],
        ...['title', 'url', 'description', 'content', 'source', 'author', 'published_date', 'category']
            .map(field => [field, typeof item[field] === 'string' ? item[field] : '']),
        ['ai_summary', typeof metadata.ai_summary === 'string' ? metadata.ai_summary : ''],
        ['content_html', typeof metadata.content_html === 'string' ? metadata.content_html : ''],
    ];
    let chars = 0;
    const hash = createHash('sha256');
    for (const [field, value] of fields) {
        chars += value.length;
        if (chars > maxChars)
            throw new Error('Selection content hash input exceeds the configured limit');
        hash.update(`${field.length}:`).update(field, 'utf8').update(`${Buffer.byteLength(value, 'utf8')}:`).update(value, 'utf8');
    }
    return hash.digest('hex');
}
export function canonicalSelectionUrl(value) {
    if (typeof value !== 'string' || value.length > 4_096)
        return '';
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:')
            return '';
        url.hash = '';
        for (const name of [...url.searchParams.keys()]) {
            if (/^(utm_|fbclid|gclid)/iu.test(name))
                url.searchParams.delete(name);
        }
        url.hostname = url.hostname.toLocaleLowerCase('en-US');
        if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80'))
            url.port = '';
        return url.toString();
    }
    catch {
        return '';
    }
}
export function normalizedTitleTokens(value) {
    const title = clean(value, 2_000).toLocaleLowerCase('en-US');
    const tokens = new Set();
    for (const match of title.matchAll(/[a-z0-9][a-z0-9._+-]*/gu)) {
        if (match[0].length > 1 && !STOPWORDS.has(match[0]))
            tokens.add(match[0]);
    }
    const hanRuns = title.match(/[\u3400-\u9fff]+/gu) ?? [];
    for (const run of hanRuns) {
        if (run.length === 1 && !STOPWORDS.has(run))
            tokens.add(run);
        for (let index = 0; index < run.length - 1; index += 1) {
            const token = run.slice(index, index + 2);
            if (!STOPWORDS.has(token))
                tokens.add(token);
        }
    }
    return [...tokens].sort();
}
function hash64(value) {
    return createHash('sha256').update(value, 'utf8').digest().readBigUInt64BE(0);
}
export function titleSimHash(tokens) {
    const weights = Array(64).fill(0);
    for (const token of tokens) {
        const hash = hash64(token);
        for (let bit = 0; bit < 64; bit += 1)
            weights[bit] += ((hash >> BigInt(bit)) & 1n) === 1n ? 1 : -1;
    }
    let result = 0n;
    for (let bit = 0; bit < 64; bit += 1)
        if (weights[bit] >= 0)
            result |= 1n << BigInt(bit);
    return result;
}
export function hammingDistance(left, right) {
    let value = left ^ right;
    let count = 0;
    while (value !== 0n) {
        count += Number(value & 1n);
        value >>= 1n;
    }
    return count;
}
export function tokenJaccard(left, right) {
    if (left.length === 0 && right.length === 0)
        return 0;
    const l = new Set(left);
    const r = new Set(right);
    let intersection = 0;
    for (const token of l)
        if (r.has(token))
            intersection += 1;
    return intersection / (l.size + r.size - intersection);
}
function topicCompatible(left, right) {
    if (left.assessment.topics.length === 0 || right.assessment.topics.length === 0)
        return true;
    const topics = new Set(left.assessment.topics);
    return right.assessment.topics.some(topic => topics.has(topic));
}
class DisjointSet {
    parent;
    constructor(size) { this.parent = Array.from({ length: size }, (_, index) => index); }
    find(value) { let current = value; while (this.parent[current] !== current)
        current = this.parent[current]; while (this.parent[value] !== value) {
        const next = this.parent[value];
        this.parent[value] = current;
        value = next;
    } return current; }
    union(left, right) { const l = this.find(left); const r = this.find(right); if (l !== r)
        this.parent[Math.max(l, r)] = Math.min(l, r); }
}
function candidateBodyChars(candidate) {
    const item = candidate.record.item;
    return (typeof item.description === 'string' ? item.description.length : 0)
        + (typeof item.content === 'string' ? item.content.length : 0);
}
function candidateAIScore(candidate) {
    return Number.isInteger(candidate.editorial?.aiScore) ? candidate.editorial.aiScore : 0;
}
function representativeTuple(candidate, sourceCount) {
    return [candidateAIScore(candidate), candidateBodyChars(candidate), sourceCount, candidate.effectiveTimestamp, candidate.record.storeId];
}
function compareTupleDescending(left, right) {
    for (let index = 0; index < 4; index += 1) {
        const delta = right[index] - left[index];
        if (delta !== 0)
            return delta;
    }
    return left[4].localeCompare(right[4]);
}
export function clusterAIEvents(candidates, options = {}) {
    const maxBucketSize = options.maxBucketSize ?? 200;
    const maxPairComparisons = options.maxPairComparisons ?? 200_000;
    const minJaccard = options.minJaccard ?? 0.72;
    const maxHamming = options.maxHamming ?? 6;
    if (!Number.isInteger(maxBucketSize) || maxBucketSize < 2 || maxBucketSize > 1_000)
        throw new Error('maxBucketSize is invalid');
    if (!Number.isInteger(maxPairComparisons) || maxPairComparisons < 1 || maxPairComparisons > 2_000_000)
        throw new Error('maxPairComparisons is invalid');
    if (!(minJaccard >= 0.5 && minJaccard <= 1) || !Number.isInteger(maxHamming) || maxHamming < 0 || maxHamming > 16)
        throw new Error('Clustering thresholds are invalid');
    const sorted = [...candidates].sort((a, b) => a.record.storeId.localeCompare(b.record.storeId));
    if (new Set(sorted.map(item => item.record.storeId)).size !== sorted.length)
        throw new Error('Selection candidates contain duplicate store ids');
    const metadata = sorted.map(candidate => {
        const title = clean(candidate.record.item.title, 2_000).toLocaleLowerCase('en-US');
        const tokens = normalizedTitleTokens(title);
        return { title, url: canonicalSelectionUrl(candidate.record.item.url), tokens, simhash: titleSimHash(tokens) };
    });
    const dsu = new DisjointSet(sorted.length);
    const exact = new Map();
    for (let index = 0; index < sorted.length; index += 1) {
        for (const key of [metadata[index].url && `u:${metadata[index].url}`, metadata[index].title && `t:${metadata[index].title}`].filter(Boolean)) {
            const prior = exact.get(key);
            if (prior === undefined)
                exact.set(key, index);
            else
                dsu.union(prior, index);
        }
    }
    const tokenFrequency = new Map();
    for (const item of metadata)
        for (const token of item.tokens)
            tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    const buckets = new Map();
    const add = (key, index) => {
        const values = buckets.get(key) ?? [];
        if (!values.includes(index) && values.length < maxBucketSize)
            values.push(index);
        buckets.set(key, values);
    };
    for (let index = 0; index < metadata.length; index += 1) {
        const representative = dsu.find(index);
        const hash = metadata[representative].simhash;
        for (let band = 0; band < 4; band += 1)
            add(`s:${band}:${Number((hash >> BigInt(band * 16)) & 0xffffn)}`, representative);
        for (const token of metadata[representative].tokens.filter(token => (tokenFrequency.get(token) ?? 0) <= maxBucketSize).slice(0, 8))
            add(`r:${token}`, representative);
    }
    const compared = new Set();
    let comparisons = 0;
    for (const values of buckets.values()) {
        for (let left = 0; left < values.length; left += 1)
            for (let right = left + 1; right < values.length; right += 1) {
                const a = values[left];
                const b = values[right];
                const key = `${a}:${b}`;
                if (compared.has(key))
                    continue;
                compared.add(key);
                comparisons += 1;
                if (comparisons > maxPairComparisons)
                    throw new Error('AI event clustering comparison limit exceeded');
                if (!topicCompatible(sorted[a], sorted[b]))
                    continue;
                const jaccard = tokenJaccard(metadata[a].tokens, metadata[b].tokens);
                const hamming = hammingDistance(metadata[a].simhash, metadata[b].simhash);
                if (jaccard >= minJaccard || (hamming <= maxHamming && jaccard >= 0.35))
                    dsu.union(a, b);
            }
    }
    const groups = new Map();
    for (let index = 0; index < sorted.length; index += 1) {
        const root = dsu.find(index);
        const values = groups.get(root) ?? [];
        values.push(sorted[index]);
        groups.set(root, values);
    }
    return [...groups.values()].map(buildEventCluster).sort((a, b) => a.clusterId.localeCompare(b.clusterId));
}
function buildEventCluster(input) {
    const members = [...input].sort((a, b) => a.record.storeId.localeCompare(b.record.storeId));
    if (members.length < 1)
        throw new Error('AI event cluster cannot be empty');
    const sources = new Set(members.map(item => item.record.sourceId));
    const representative = [...members].sort((a, b) => compareTupleDescending(representativeTuple(a, sources.size), representativeTuple(b, sources.size)))[0];
    const topics = [...new Set(members.flatMap(item => item.assessment.topics))].sort();
    const claims = members.map(item => `${item.record.storeId}:${item.contentHash}`).sort().join('\n');
    return {
        clusterId: createHash('sha256').update(claims, 'utf8').digest('hex'), members, representative, topics,
        signals: {
            distinctSourceCount: sources.size, memberCount: members.length,
            recencyTimestamp: Math.max(...members.map(item => item.effectiveTimestamp)),
            bodyChars: candidateBodyChars(representative), topicCount: topics.length,
            localMatch: representative.relevanceOrigin === 'local-match',
            aiScore: Math.max(...members.map(candidateAIScore)),
        },
    };
}
/** Build deterministic, hash-bound clusters from semantic groups decided by the AI reviewer. */
export function clusterAIEventsFromGroups(candidates, storeIdGroups) {
    if (!Array.isArray(candidates) || candidates.length < 1 || !Array.isArray(storeIdGroups) || storeIdGroups.length < 1) {
        throw new Error('AI event grouping input is invalid');
    }
    const byId = new Map();
    for (const candidate of candidates) {
        const storeId = candidate?.record?.storeId;
        if (typeof storeId !== 'string' || !storeId || byId.has(storeId))
            throw new Error('AI event candidates contain duplicate or invalid ids');
        byId.set(storeId, candidate);
    }
    const seen = new Set();
    const clusters = storeIdGroups.map(group => {
        if (!Array.isArray(group) || group.length < 1)
            throw new Error('AI event grouping contains an empty cluster');
        const members = group.map(storeId => {
            if (typeof storeId !== 'string' || seen.has(storeId) || !byId.has(storeId))
                throw new Error('AI event grouping contains a duplicate or unknown id');
            seen.add(storeId);
            return byId.get(storeId);
        });
        return buildEventCluster(members);
    });
    if (seen.size !== byId.size)
        throw new Error('AI event grouping omitted candidates');
    return clusters.sort((a, b) => a.clusterId.localeCompare(b.clusterId));
}
function clusterPriority(cluster) {
    return [cluster.signals.aiScore, Math.min(cluster.signals.distinctSourceCount, 5),
        cluster.signals.topicCount, Math.min(cluster.signals.bodyChars, 100_000), cluster.signals.recencyTimestamp, cluster.clusterId];
}
function compareClusterPriority(left, right) {
    const l = clusterPriority(left);
    const r = clusterPriority(right);
    for (let index = 0; index < 5; index += 1) {
        const delta = r[index] - l[index];
        if (delta !== 0)
            return delta;
    }
    return l[5].localeCompare(r[5]);
}
export function rankDiverseEvents(clusters, options) {
    if (!Number.isInteger(options.maxItems) || options.maxItems < 1 || options.maxItems > 100)
        throw new Error('maxItems is invalid');
    const maxPerSource = options.maxPerSource ?? Math.max(1, Math.ceil(options.maxItems * 0.2));
    if (!Number.isInteger(maxPerSource) || maxPerSource < 1 || maxPerSource > 100)
        throw new Error('maxPerSource is invalid');
    const quota = options.sourceQuota;
    if (quota && (typeof quota.sourceId !== 'string' || !quota.sourceId.trim()
        || !Number.isInteger(quota.minItems) || !Number.isInteger(quota.maxItems)
        || quota.minItems < 1 || quota.maxItems < quota.minItems
        || quota.maxItems > maxPerSource || quota.minItems > options.maxItems))
        throw new Error('sourceQuota is invalid');
    const longTailTarget = Math.floor(options.maxItems * ((options.longTailPercent ?? 20) / 100));
    const remaining = [...clusters].sort(compareClusterPriority);
    const selected = [];
    const sourceCounts = new Map();
    const coveredTopics = new Set();
    const canTake = (cluster) => {
        const source = cluster.representative.record.sourceId;
        const ceiling = quota && source === quota.sourceId ? quota.maxItems : maxPerSource;
        return !selected.includes(cluster) && selected.length < options.maxItems && (sourceCounts.get(source) ?? 0) < ceiling;
    };
    const take = (cluster) => { selected.push(cluster); const source = cluster.representative.record.sourceId; sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1); for (const topic of cluster.topics)
        coveredTopics.add(topic); };
    if (quota) {
        const quotaCandidates = remaining.filter(cluster => cluster.representative.record.sourceId === quota.sourceId);
        if (quotaCandidates.length < quota.minItems)
            throw new Error(`Selection source quota cannot be satisfied for ${quota.sourceId}: requires at least ${quota.minItems}, found ${quotaCandidates.length}`);
        for (const cluster of quotaCandidates.slice(0, quota.minItems))
            take(cluster);
    }
    for (const cluster of remaining) {
        if (selected.length >= options.maxItems)
            break;
        if (canTake(cluster) && cluster.topics.some(topic => !coveredTopics.has(topic)))
            take(cluster);
    }
    const longTail = remaining.filter(cluster => cluster.signals.distinctSourceCount === 1 && !selected.includes(cluster));
    for (const cluster of longTail) {
        if (selected.length >= options.maxItems || selected.filter(item => item.signals.distinctSourceCount === 1).length >= longTailTarget)
            break;
        if (canTake(cluster))
            take(cluster);
    }
    for (const cluster of remaining) {
        if (selected.length >= options.maxItems)
            break;
        if (canTake(cluster))
            take(cluster);
    }
    return selected.map((cluster, index) => ({
        rank: index + 1, cluster,
        reasons: [quota && cluster.representative.record.sourceId === quota.sourceId ? 'source-quota' : undefined,
            cluster.signals.distinctSourceCount > 1 ? 'cross-source-corroboration' : 'long-tail-event',
            cluster.representative.relevanceOrigin === 'ai-editorial' ? `ai-editorial-score-${cluster.signals.aiScore}`
                : cluster.signals.localMatch ? 'local-ai-match' : 'reviewer-accepted',
            cluster.signals.topicCount > 1 ? 'multi-topic-event' : 'topic-representative'].filter((reason) => Boolean(reason)),
    }));
}
export function estimateMaterialTokens(value) {
    let tokens = 0;
    let latinRun = 0;
    const flush = () => { if (latinRun > 0) {
        tokens += Math.ceil(latinRun / 4);
        latinRun = 0;
    } };
    for (const char of value) {
        if (/[\u3400-\u9fff]/u.test(char)) {
            flush();
            tokens += 1;
        }
        else if (/[A-Za-z0-9]/u.test(char))
            latinRun += 1;
        else {
            flush();
            if (!/\s/u.test(char))
                tokens += 1;
        }
    }
    flush();
    return tokens + 32;
}
const DIRECT_IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu;
const DIRECT_VIDEO_EXTENSION = /\.(?:m4v|mov|mp4|webm)$/iu;
function mediaUrl(value) {
    if (!value || value.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(value))
        return undefined;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return undefined;
        return value;
    }
    catch {
        return undefined;
    }
}
function directMediaKind(value) {
    try {
        const pathname = new URL(value).pathname;
        if (DIRECT_IMAGE_EXTENSION.test(pathname))
            return 'image';
        if (DIRECT_VIDEO_EXTENSION.test(pathname))
            return 'video';
    }
    catch { /* rejected by mediaUrl */ }
    return undefined;
}
function escapedAt(value, index) {
    let count = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1)
        count += 1;
    return count % 2 === 1;
}
/** Conservatively erase Markdown code regions while preserving string offsets. */
function stripSelectionMarkdownCode(value) {
    const lines = value.split(/(?<=\n)/u);
    let fence;
    const blockSafe = lines.map(line => {
        const text = line.endsWith('\n') ? line.slice(0, -1) : line;
        if (fence) {
            const closing = text.match(/^ {0,3}(`+|~+)\s*$/u);
            if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length)
                fence = undefined;
            return line.endsWith('\n') ? '\n' : '';
        }
        const opening = text.match(/^ {0,3}(`{3,}|~{3,})/u);
        if (opening) {
            fence = { char: opening[1][0], length: opening[1].length };
            return line.endsWith('\n') ? '\n' : '';
        }
        if (/^(?: {4}|\t)/u.test(text))
            return line.endsWith('\n') ? '\n' : '';
        return line;
    }).join('');
    let result = '';
    for (let index = 0; index < blockSafe.length;) {
        if (blockSafe[index] !== '`' || escapedAt(blockSafe, index)) {
            result += blockSafe[index];
            index += 1;
            continue;
        }
        let runEnd = index;
        while (blockSafe[runEnd] === '`')
            runEnd += 1;
        const length = runEnd - index;
        let cursor = runEnd;
        let closing = -1;
        while (cursor < blockSafe.length) {
            const found = blockSafe.indexOf('`', cursor);
            if (found < 0)
                break;
            let end = found;
            while (blockSafe[end] === '`')
                end += 1;
            if (!escapedAt(blockSafe, found) && end - found === length) {
                closing = end;
                break;
            }
            cursor = end;
        }
        if (closing < 0) {
            result += blockSafe.slice(index, runEnd);
            index = runEnd;
            continue;
        }
        result += ' '.repeat(closing - index);
        index = closing;
    }
    return result;
}
function selectionHtmlTokens(value) {
    const tokens = [];
    for (let start = value.indexOf('<'); start >= 0; start = value.indexOf('<', start + 1)) {
        let quote;
        let end = start + 1;
        for (; end < value.length; end += 1) {
            const char = value[end];
            if (quote) {
                if (char === quote)
                    quote = undefined;
                continue;
            }
            if (char === '"' || char === "'") {
                quote = char;
                continue;
            }
            if (char === '>')
                break;
        }
        if (end >= value.length)
            break;
        const raw = value.slice(start, end + 1);
        const header = raw.match(/^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)\b/u);
        if (!header)
            continue;
        const attributes = new Map();
        let cursor = header[0].length;
        while (cursor < raw.length - 1 && !header[1]) {
            while (/\s/u.test(raw[cursor] ?? ''))
                cursor += 1;
            if (raw[cursor] === '/' || raw[cursor] === '>')
                break;
            const nameStart = cursor;
            while (cursor < raw.length && !/[\s=/>]/u.test(raw[cursor]))
                cursor += 1;
            const name = raw.slice(nameStart, cursor).toLocaleLowerCase('en-US');
            if (!name) {
                cursor += 1;
                continue;
            }
            while (/\s/u.test(raw[cursor] ?? ''))
                cursor += 1;
            let attributeValue = '';
            if (raw[cursor] === '=') {
                cursor += 1;
                while (/\s/u.test(raw[cursor] ?? ''))
                    cursor += 1;
                const delimiter = raw[cursor] === '"' || raw[cursor] === "'" ? raw[cursor++] : undefined;
                const valueStart = cursor;
                if (delimiter)
                    while (cursor < raw.length && raw[cursor] !== delimiter)
                        cursor += 1;
                else
                    while (cursor < raw.length && !/[\s>]/u.test(raw[cursor]))
                        cursor += 1;
                attributeValue = raw.slice(valueStart, cursor);
                if (delimiter && raw[cursor] === delimiter)
                    cursor += 1;
            }
            if (!attributes.has(name))
                attributes.set(name, attributeValue);
        }
        tokens.push({
            start, end: end + 1, name: header[2].toLocaleLowerCase('en-US'), closing: header[1] === '/',
            selfClosing: /\/\s*>$/u.test(raw), attributes,
        });
        start = end;
    }
    return tokens;
}
const VOID_HTML_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function hiddenHtmlToken(token) {
    if (token.attributes.has('hidden'))
        return true;
    if (token.attributes.get('aria-hidden')?.trim().toLocaleLowerCase('en-US') === 'true')
        return true;
    const style = token.attributes.get('style') ?? '';
    return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/iu.test(style);
}
/** Erase comments and HTML contexts whose children are not reliably rendered. */
function stripSelectionHtmlNonRendered(value) {
    let safe = value.replace(/<!--[\s\S]*?(?:-->|$)/gu, match => ' '.repeat(match.length));
    const excluded = new Set([
        'pre', 'code', 'script', 'style', 'template', 'textarea', 'title', 'xmp',
        'iframe', 'noembed', 'noframes', 'plaintext', 'noscript', 'select', 'option',
        'object',
    ]);
    const stack = [];
    const ranges = [];
    for (const token of selectionHtmlTokens(safe)) {
        if (token.closing) {
            const index = stack.map(item => item.name).lastIndexOf(token.name);
            if (index < 0)
                continue;
            const [frame] = stack.splice(index, 1);
            ranges.push(frame.mode === 'video' ? [frame.bodyStart, token.start] : [frame.start, token.end]);
            continue;
        }
        const mode = hiddenHtmlToken(token) || excluded.has(token.name) ? 'erase'
            : token.name === 'video' ? 'video' : undefined;
        if (!mode)
            continue;
        // HTML ignores a trailing slash on non-void start tags (`<div/>` is an
        // opening div). Only actual HTML void elements close immediately.
        const isVoid = VOID_HTML_ELEMENTS.has(token.name);
        if (isVoid) {
            if (mode === 'erase')
                ranges.push([token.start, token.end]);
            continue;
        }
        stack.push(mode === 'video'
            ? { name: token.name, mode, start: token.start, bodyStart: token.end }
            : { name: token.name, mode, start: token.start });
        if (token.name === 'plaintext')
            break;
    }
    for (const item of stack)
        ranges.push(item.mode === 'video' ? [item.bodyStart, safe.length] : [item.start, safe.length]);
    for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) {
        safe = `${safe.slice(0, start)}${' '.repeat(end - start)}${safe.slice(end)}`;
    }
    return safe;
}
/**
 * Extract media only from authoritative body fields and the explicit Follow
 * `metadata.content_html` field, using conservative rendered-context parsing.
 * Arbitrary metadata is intentionally never scanned.
 */
export function extractSelectionMedia(description, content, maxMediaPerItem = 16, contentHtml) {
    if (!Number.isInteger(maxMediaPerItem) || maxMediaPerItem < 0 || maxMediaPerItem > 64)
        throw new Error('maxMediaPerItem is invalid');
    const images = [];
    const videos = [];
    const seen = new Set();
    const add = (raw, kind) => {
        const url = mediaUrl(raw.trim().replace(/[.,;:!?，。；：！？]+$/u, ''));
        const resolvedKind = kind ?? (url ? directMediaKind(url) : undefined);
        if (!url || !resolvedKind || seen.has(url))
            return;
        seen.add(url);
        const target = resolvedKind === 'video' ? videos : images;
        if (target.length < 64)
            target.push({ kind: resolvedKind, url });
    };
    for (const body of [description, content, contentHtml]) {
        if (typeof body !== 'string')
            continue;
        const safe = stripSelectionHtmlNonRendered(stripSelectionMarkdownCode(body));
        const tokens = selectionHtmlTokens(safe);
        let markdownSafe = safe;
        for (const token of [...tokens].reverse()) {
            markdownSafe = `${markdownSafe.slice(0, token.start)}${' '.repeat(token.end - token.start)}${markdownSafe.slice(token.end)}`;
        }
        for (const match of markdownSafe.matchAll(/!\[[^\]]*\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+["'][^)]*["'])?\s*\)/giu)) {
            if (!escapedAt(markdownSafe, match.index))
                add(match[1], 'image');
        }
        const videos = [];
        for (const token of tokens) {
            if (escapedAt(safe, token.start))
                continue;
            if (token.name === 'img' && !token.closing) {
                const url = token.attributes.get('src');
                if (url)
                    add(url, 'image');
                continue;
            }
            if (token.name === 'video' && !token.closing) {
                videos.push({ media: [
                        token.attributes.get('src') ? { url: token.attributes.get('src'), kind: 'video' } : undefined,
                        token.attributes.get('poster') ? { url: token.attributes.get('poster'), kind: 'image' } : undefined,
                    ].filter((item) => item !== undefined) });
                continue;
            }
            // Standalone and nested <source> are deliberately unsupported. The
            // canonical admitted video form is a closed <video src="...">.
            if (token.name === 'video' && token.closing && videos.length > 0) {
                const frame = videos.pop();
                for (const media of frame.media)
                    add(media.url, media.kind);
            }
        }
        // Remove Markdown link/image destinations before scanning bare URLs. An
        // escaped image marker and an ordinary link do not render the target as
        // media even when the target itself has a media extension.
        const directSafe = markdownSafe.replace(/!?\[[^\]]*\]\(\s*<?https?:\/\/[^\s)>]+>?(?:\s+["'][^)]*["'])?\s*\)/giu, match => ' '.repeat(match.length));
        // HTML tokens were already erased from markdownSafe, so ignored <source
        // src> and other attributes cannot be mistaken for bare text URLs.
        for (const match of directSafe.matchAll(/https?:\/\/[^\s<>"'()\[\]]+/giu))
            add(match[0]);
    }
    // Daily production uses one homogeneous media class per item. Videos have
    // precedence because they preserve more source information; images are used
    // only when no rendered video was admitted. The configured ceiling is a
    // selection bound, not a reason to discard an otherwise valid item.
    return (videos.length > 0 ? videos : images).slice(0, maxMediaPerItem);
}
function excerpt(field, source, start, end) {
    const safeStart = Math.max(0, Math.min(start, source.length));
    const safeEnd = Math.max(safeStart, Math.min(end, source.length));
    const text = source.slice(safeStart, safeEnd).replace(/[\u0000\u007f]/gu, '').trim();
    if (!text)
        return undefined;
    return { field, start: safeStart, end: safeEnd, text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
}
export function buildPackedMaterial(candidate, maxChars, maxMediaPerItem = 16) {
    if (!Number.isInteger(maxChars) || maxChars < 256 || maxChars > 20_000)
        throw new Error('Packed material maxChars is invalid');
    if (!Number.isInteger(maxMediaPerItem) || maxMediaPerItem < 0 || maxMediaPerItem > 64)
        throw new Error('maxMediaPerItem is invalid');
    const item = candidate.record.item;
    const description = typeof item.description === 'string' ? item.description : '';
    const content = typeof item.content === 'string' ? item.content : '';
    const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
        ? item.metadata : {};
    const contentHtml = typeof metadata.content_html === 'string' ? metadata.content_html : '';
    const sourceField = description.length >= content.length ? 'description' : 'content';
    const body = sourceField === 'description' ? description : content;
    const media = extractSelectionMedia(description, content, maxMediaPerItem, contentHtml);
    const budget = Math.max(0, maxChars - 1_000);
    const segment = Math.max(80, Math.floor(budget / 4));
    const candidates = [
        excerpt(sourceField, body, 0, segment),
        excerpt(sourceField, body, Math.max(0, Math.floor(body.length / 2) - Math.floor(segment / 2)), Math.floor(body.length / 2) + Math.ceil(segment / 2)),
        excerpt(sourceField, body, Math.max(0, body.length - segment), body.length),
    ];
    const normalizedBody = body.toLocaleLowerCase('en-US');
    for (const evidence of candidate.assessment.evidence) {
        if (!evidence.phrase)
            continue;
        const index = normalizedBody.indexOf(evidence.phrase.toLocaleLowerCase('en-US'));
        if (index >= 0)
            candidates.push(excerpt(sourceField, body, index - Math.floor(segment / 2), index + evidence.phrase.length + Math.floor(segment / 2)));
    }
    const seen = new Set();
    const excerpts = [];
    for (const value of candidates) {
        if (!value || seen.has(value.sha256))
            continue;
        seen.add(value.sha256);
        excerpts.push(value);
    }
    const base = {
        storeId: candidate.record.storeId,
        title: clean(item.title, Math.min(1_000, Math.max(80, Math.floor(maxChars * 0.2)))),
        url: clean(item.url, Math.min(2_048, Math.max(0, Math.floor(maxChars * 0.2)))),
        source: clean(item.source, Math.min(512, Math.max(0, Math.floor(maxChars * 0.08)))),
        author: clean(item.author, Math.min(512, Math.max(0, Math.floor(maxChars * 0.06)))),
        publishedDate: clean(item.published_date, 64),
        category: clean(item.category, Math.min(256, Math.max(0, Math.floor(maxChars * 0.06)))),
        aiSummary: clean(candidate.editorial?.aiSummary, Math.min(4_000, Math.max(0, Math.floor(maxChars * 0.4)))),
        aiScore: candidateAIScore(candidate),
        scoreReason: clean(candidate.editorial?.reason, Math.min(2_000, Math.max(0, Math.floor(maxChars * 0.25)))),
    };
    while (excerpts.length > 0 && JSON.stringify({ ...base, excerpts, media }).length > maxChars)
        excerpts.pop();
    let encoded = JSON.stringify({ ...base, excerpts, media });
    if (encoded.length > maxChars) {
        base.url = '';
        base.author = '';
        base.category = '';
        base.source = '';
        base.title = base.title.slice(0, Math.max(0, maxChars - 256));
        encoded = JSON.stringify({ ...base, excerpts, media });
    }
    if (encoded.length > maxChars)
        throw new Error('Packed material metadata exceeds per-item budget');
    const materialSha256 = createHash('sha256').update(encoded, 'utf8').digest('hex');
    return { ...base, excerpts, media, materialChars: encoded.length, estimatedTokens: estimateMaterialTokens(encoded), materialSha256 };
}
export function packSelectionMaterials(ranked, options) {
    const minChars = options.minCharsPerItem ?? 600;
    const maxChars = options.maxCharsPerItem ?? 3_000;
    const maxMediaPerItem = options.maxMediaPerItem ?? 16;
    if (!Number.isInteger(options.maxMaterialChars) || options.maxMaterialChars < 4_096 || options.maxMaterialChars > 1_000_000
        || !Number.isInteger(options.maxMaterialTokens) || options.maxMaterialTokens < 1_024 || options.maxMaterialTokens > 500_000
        || !Number.isInteger(minChars) || !Number.isInteger(maxChars) || minChars < 256 || maxChars < minChars || maxChars > 20_000
        || !Number.isInteger(maxMediaPerItem) || maxMediaPerItem < 0 || maxMediaPerItem > 64)
        throw new Error('Material packing limits are invalid');
    const result = [];
    let chars = 2;
    let tokens = 0;
    for (const item of ranked) {
        const remainingItems = Math.max(1, ranked.length - result.length);
        const allocation = Math.min(maxChars, Math.max(minChars, Math.floor((options.maxMaterialChars - chars) / remainingItems)));
        let material;
        try {
            material = buildPackedMaterial(item.cluster.representative, allocation, maxMediaPerItem);
        }
        catch {
            continue;
        }
        const separator = result.length > 0 ? 1 : 0;
        const serializedChars = JSON.stringify(material).length;
        if (chars + separator + serializedChars > options.maxMaterialChars || tokens + material.estimatedTokens > options.maxMaterialTokens)
            continue;
        chars += separator + serializedChars;
        tokens += material.estimatedTokens;
        result.push({ ranked: item, material });
    }
    return result;
}
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        const source = value;
        return `{${Object.keys(source).sort().map(key => `${JSON.stringify(key)}:${canonical(source[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
export function selectionSha256(value) {
    return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
