// Generated from src/core/publishing/WechatPublisher.ts by integrations/dsh/scripts/sync-shared.mjs.
import { createHash } from 'node:crypto';
const WECHAT_STYLE = Object.freeze({
    container: "font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei','Source Han Sans SC',sans-serif;background-color:#fff;color:#353535;line-height:1.8;padding:20px;max-width:100%;margin:0 auto;box-sizing:border-box;font-size:16px;-webkit-font-smoothing:antialiased;word-break:break-word;",
    paragraph: 'font-size:16px;color:#3f3f3f;margin:0 0 1.6em 0;line-height:1.8;text-align:justify;letter-spacing:.03em;',
    h1: 'font-size:26px;color:#000;font-weight:bold;text-align:center;margin:0;line-height:1.3;',
    h2: 'font-size:18px;color:#fff;background-color:#07C160;font-weight:bold;padding:5px 15px;border-radius:4px;display:inline-block;line-height:1.4;box-shadow:3px 3px 0 rgba(7,193,96,.2);',
    h3: 'font-size:17px;color:#07C160;font-weight:bold;margin:30px 0 15px;border-left:4px solid #07C160;padding-left:12px;line-height:1.4;',
    quote: 'margin:25px 0;padding:20px;background-color:#fcfcfc;border-radius:10px;border-left:4px solid #07C160;color:#576b95;font-size:15px;line-height:1.7;box-shadow:0 4px 12px rgba(0,0,0,.02);',
    code: "margin:25px 0;padding:16px;background-color:#282c34;border-radius:10px;font-family:'Fira Code',Consolas,Monaco,monospace;font-size:13px;color:#abb2bf;line-height:1.5;overflow-x:auto;white-space:pre-wrap;border:none;box-shadow:0 8px 20px rgba(0,0,0,.1);",
    list: 'margin:20px 0;padding-left:25px;color:#353535;', item: 'font-size:16px;margin-bottom:12px;line-height:1.7;',
    image: 'max-width:100%;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.08);display:block;margin:16px auto;height:auto;',
    table: 'width:100%;border-collapse:collapse;margin:25px 0;font-size:14px;border:1px solid #f0f0f0;',
    th: 'border:1px solid #f0f0f0;padding:12px;background-color:#fafafa;font-weight:bold;color:#333;text-align:center;',
    td: 'border:1px solid #f0f0f0;padding:12px;color:#666;text-align:center;word-break:break-all;',
});
const HTML_STYLE = WECHAT_STYLE.container;
const ASSET_ID = /^[a-f0-9]{64}$/;
function escapeHtml(value) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function codePointLength(value) { return Array.from(value).length; }
function normalizeAssetSource(source) {
    const match = /^(?:prismflow-media:(?:\/\/)?)([a-f0-9]{64})$/u.exec(source);
    return match?.[1];
}
function safeWebUrl(value, label, allowHttp = false) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new Error(`${label} URL is invalid`);
    }
    if (!(parsed.protocol === 'https:' || allowHttp && parsed.protocol === 'http:') || parsed.username || parsed.password || parsed.hash) {
        throw new Error(`${label} URL is not allowed`);
    }
    return parsed.toString();
}
function inlineMarkdown(value, images) {
    const stash = [];
    const hold = (html) => { const token = `\u0000${stash.length}\u0000`; stash.push(html); return token; };
    let text = value.replace(/`([^`\n]+)`/gu, (_all, code) => hold(`<code style="font-family:monospace;background:#f6f8fa;padding:0 3px;">${escapeHtml(code)}</code>`));
    text = text.replace(/!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu, (_all, alt, source) => {
        const normalizedSource = decodeEntities(source);
        const assetId = normalizeAssetSource(normalizedSource);
        if (!assetId)
            safeWebUrl(normalizedSource, 'Markdown image', true);
        const mediaIndex = images.length;
        const sourceHash = createHash('sha256').update(`${mediaIndex}\u0000${normalizedSource}`, 'utf8').digest('hex');
        const placeholder = `PF_WECHAT_IMAGE_${mediaIndex}_${sourceHash}_PLACEHOLDER`;
        images.push({ source: normalizedSource, ...(assetId ? { assetId } : {}), alt, placeholder });
        return hold(`<img src="${placeholder}" alt="${escapeHtml(alt)}" style="${WECHAT_STYLE.image}"/>`);
    });
    text = text.replace(/\[([^\]\n]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu, (_all, label, target) => {
        safeWebUrl(decodeEntities(target), 'Markdown link', true);
        return hold(`<span style="color:#576b95;text-decoration:none;border-bottom:1px solid #576b95;">${escapeHtml(label)}</span>`);
    });
    text = escapeHtml(text)
        .replace(/\*\*([^*\n]+)\*\*/gu, '<strong style="font-weight:bold;">$1</strong>')
        .replace(/__([^_\n]+)__/gu, '<strong style="font-weight:bold;">$1</strong>')
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, '<em>$1</em>');
    return text.replace(/\u0000(\d+)\u0000/gu, (_all, index) => stash[Number(index)] ?? '');
}
function decodeEntities(value) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', ndash: '–', mdash: '—', middot: '·' };
    return value.replace(/&(?:#(\d+)|#x([a-f0-9]+)|([a-z]+));/giu, (entity, decimal, hexadecimal, name) => {
        if (name)
            return named[name.toLowerCase()] ?? entity;
        const codePoint = Number.parseInt(decimal ?? hexadecimal, decimal ? 10 : 16);
        return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
            ? String.fromCodePoint(codePoint) : entity;
    });
}
function plainInline(value) {
    return decodeEntities(value
        .replace(/!\[[^\]\n]*\]\([^\n)]*\)/gu, '')
        .replace(/\[([^\]\n]+)\]\([^\n)]*\)/gu, '$1')
        .replace(/[`*_~]/gu, '')
        .replace(/<[^>]*>/gu, ''));
}
/** Fixed, raw-HTML-disabled Markdown representation used by both article modes. */
export function renderWechatMarkdown(markdown) {
    if (typeof markdown !== 'string' || markdown.length < 1 || /[\u0000\u007f]/u.test(markdown))
        throw new Error('Markdown is invalid');
    const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    const html = [`<section style="${HTML_STYLE}">`];
    const plain = [];
    const newspic = [];
    const images = [];
    let paragraph = [];
    let list;
    let code;
    let tableRows = [];
    const flushParagraph = () => {
        if (!paragraph.length)
            return;
        const source = paragraph.join('\n');
        html.push(`<p style="${WECHAT_STYLE.paragraph}">${source.split('\n').map(line => inlineMarkdown(line, images)).join('<br/>')}</p>`);
        const text = plainInline(source).trim();
        if (text) {
            plain.push(text);
            newspic.push(text);
        }
        paragraph = [];
    };
    const closeList = () => { if (list) {
        html.push(`</${list}>`);
        list = undefined;
    } };
    const flushTable = () => {
        if (!tableRows.length)
            return;
        html.push(`<table style="${WECHAT_STYLE.table}">`);
        tableRows.forEach((row, rowIndex) => {
            html.push('<tr>');
            row.forEach(cell => html.push(`<${rowIndex === 0 ? 'th' : 'td'} style="${rowIndex === 0 ? WECHAT_STYLE.th : WECHAT_STYLE.td}">${inlineMarkdown(cell, images)}</${rowIndex === 0 ? 'th' : 'td'}>`));
            html.push('</tr>');
            const cells = row.map(cell => plainInline(cell).trim()).filter(Boolean);
            const text = cells.join(' ');
            if (text)
                plain.push(text);
            const newspicRow = cells.join(' | ');
            if (newspicRow)
                newspic.push(newspicRow);
        });
        html.push('</table>');
        tableRows = [];
    };
    const flushFlow = () => { flushParagraph(); closeList(); flushTable(); };
    const headingHtml = (depth, text) => depth === 1
        ? `<div style="text-align:center;margin:40px 0 35px;"><h1 style="${WECHAT_STYLE.h1}">${inlineMarkdown(text, images)}</h1><div style="width:32px;height:3px;background:#07C160;margin:12px auto;border-radius:2px;opacity:.8;"></div></div>`
        : depth === 2 ? `<div style="margin:45px 0 25px;text-align:left;"><span style="${WECHAT_STYLE.h2}">${inlineMarkdown(text, images)}</span></div>`
            : `<h${Math.min(depth, 4)} style="${depth === 3 ? WECHAT_STYLE.h3 : 'font-weight:700;margin:24px 0 12px;'}">${inlineMarkdown(text, images)}</h${Math.min(depth, 4)}>`;
    for (const line of lines) {
        if (code) {
            if (/^\s*```/u.test(line)) {
                html.push(`<pre style="${WECHAT_STYLE.code}"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
                if (code.length) {
                    const text = code.join('\n');
                    plain.push(text);
                    newspic.push(text);
                }
                code = undefined;
            }
            else
                code.push(line);
            continue;
        }
        if (/^\s*```/u.test(line)) {
            flushFlow();
            code = [];
            continue;
        }
        const trimmed = line.trim();
        if (!trimmed) {
            flushFlow();
            newspic.push('');
            continue;
        }
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            flushParagraph();
            closeList();
            const cells = trimmed.slice(1, -1).split('|').map(cell => cell.trim());
            if (!cells.every(cell => /^:?-{3,}:?$/u.test(cell)))
                tableRows.push(cells);
            continue;
        }
        flushTable();
        const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
        if (heading) {
            flushParagraph();
            closeList();
            html.push(headingHtml(heading[1].length, heading[2]));
            {
                const text = plainInline(heading[2]).trim();
                plain.push(text);
                newspic.push(text);
            }
            continue;
        }
        if (trimmed === '---' || trimmed === '***') {
            flushParagraph();
            closeList();
            html.push('<hr style="border:0;height:1px;background:#eee;margin:40px 0;"/>');
            continue;
        }
        const item = /^\s*(?:(\d+)\.|[-+*])\s+(.+)$/u.exec(line);
        if (item) {
            flushParagraph();
            const next = item[1] ? 'ol' : 'ul';
            if (list && list !== next)
                closeList();
            if (!list) {
                list = next;
                html.push(`<${list} style="${WECHAT_STYLE.list}">`);
            }
            html.push(`<li style="${WECHAT_STYLE.item}">${inlineMarkdown(item[2], images)}</li>`);
            {
                const text = plainInline(item[2]).trim();
                plain.push(text);
                newspic.push(item[1] ? `${item[1]}. ${text}` : `• ${text}`);
            }
            continue;
        }
        const quote = /^\s*>\s?(.*)$/u.exec(line);
        if (quote) {
            flushParagraph();
            closeList();
            html.push(`<blockquote style="${WECHAT_STYLE.quote}">${inlineMarkdown(quote[1], images)}</blockquote>`);
            {
                const text = plainInline(quote[1]).trim();
                plain.push(text);
                newspic.push(`> ${text}`);
            }
            continue;
        }
        paragraph.push(line);
    }
    if (code)
        throw new Error('Markdown code fence is not closed');
    flushFlow();
    html.push('</section>');
    return {
        html: html.join(''),
        plainText: plain.filter(Boolean).join('\n').replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim(),
        newspicText: newspic.join('\n').replace(/\n{3,}/gu, '\n\n').trim(),
        images,
    };
}
export function destinationPresentation(artifact, publisherId) {
    return artifact.destinationPresentations?.find(item => item.publisherId === publisherId);
}
export function validateWechatCrops(articleType, presentation) {
    const allowed = new Set(articleType === 'news' ? ['2.35_1', '1_1'] : ['2.35_1', '1_1', '16_9']);
    for (const crop of presentation?.cover?.crops ?? [])
        if (!allowed.has(crop.ratio))
            throw new Error(`Crop ratio ${crop.ratio} is not allowed for ${articleType}`);
}
export function resolveWechatText(profile, artifact, publisherId, rendered) {
    const presentation = destinationPresentation(artifact, publisherId);
    const author = presentation?.author ?? profile.defaultAuthor;
    let digest;
    if (presentation?.digest !== undefined && profile.digestPolicy.startsWith('artifact-or-'))
        digest = presentation.digest;
    else if (profile.digestPolicy === 'plain-text-excerpt' || profile.digestPolicy === 'artifact-or-plain-text-excerpt') {
        digest = Array.from(rendered.plainText).slice(0, profile.limits.digestChars).join('');
    }
    for (const [field, value, max] of [['title', artifact.title, profile.limits.titleChars], ['author', author, profile.limits.authorChars], ['digest', digest, profile.limits.digestChars]]) {
        if (value !== undefined && codePointLength(value) > max)
            throw new Error(`WeChat ${field} exceeds its configured limit`);
    }
    return { presentation, author, digest };
}
export function validateWechatContent(profile, content) {
    if (content.length < 1 || codePointLength(content) > profile.limits.contentChars
        || Buffer.byteLength(content, 'utf8') > profile.limits.contentBytes) {
        throw new Error('WeChat article content exceeds its configured character or UTF-8 byte limit');
    }
}
export function renderNewspicContent(artifact, digest, rendered) {
    const plain = rendered.newspicText || [artifact.title, digest].filter((value) => typeof value === 'string' && value.length > 0).join('\n');
    // WeChat newspic accepts plain text only. Preserve line breaks, ordered-list
    // numbers, bullets, and intentional intra-line spaces without injecting HTML.
    return escapeHtml(plain);
}
export function replaceWechatImageUrls(rendered, urls) {
    if (urls.length !== rendered.images.length)
        throw new Error('WeChat body image result count is invalid');
    return rendered.images.reduce((html, image, index) => {
        const marker = `src="${image.placeholder}"`;
        if (html.split(marker).length !== 2)
            throw new Error('WeChat body image placeholder is missing or duplicated');
        return html.replace(marker, `src="${escapeHtml(safeWebUrl(urls[index], 'WeChat uploaded image'))}"`);
    }, rendered.html);
}
export function orderedNewspicAssetIds(rendered, presentation, maxImages) {
    // An exact approved presentation owns the newspic image list. Markdown body images are
    // fallback candidates only when no destination-specific order was bound to the Artifact.
    // This avoids rejecting a valid bound newspic merely because its source article retains
    // unrelated remote Markdown images that are rendered as plain text for this article type.
    const requested = presentation?.imageOrder ?? rendered.images.map(image => image.assetId ?? (() => { throw new Error('newspic requires approved persisted media assets'); })());
    const ordered = [...new Set(requested)];
    if (presentation?.cover?.assetId) {
        const cover = presentation.cover.assetId;
        const without = ordered.filter(assetId => assetId !== cover);
        ordered.splice(0, ordered.length, cover, ...without);
    }
    if (ordered.length < 1 || ordered.length > Math.min(20, maxImages))
        throw new Error('newspic requires from 1 to 20 approved images');
    if (ordered.some(assetId => !ASSET_ID.test(assetId)))
        throw new Error('newspic image asset id is invalid');
    return ordered;
}
