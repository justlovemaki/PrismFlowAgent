import { replaceImageProxy, formatDateToGMT0WithTime } from '../helpers.js';
import { getDailyReportContent } from '../github.js';
import { storeInKV } from '../kv.js';
import { marked } from '../marked.esm.js';

export async function handleWriteRssData(request, env) {
    const url = new URL(request.url);
    const dateStr = url.searchParams.get('date');

    if (!dateStr) {
        return new Response('Missing date parameter', { status: 400 });
    }

    try {
        const path = `daily/${dateStr}.md`;
        const content = await getDailyReportContent(env, path);
        if (!content) {
            return new Response(`No content found for ${path}`, { status: 404 });
        }

        const report = {
            report_date: dateStr,
            title: dateStr+'日刊',
            link:  '/daily/'+dateStr+'.html',
            content_html: null,
            // 可以添加其他相關欄位，例如作者、來源等
            published_date: formatDateToGMT0WithTime(new Date()) // 記錄保存時間
        }
        report.content_html = marked.parse(replaceImageProxy(env.IMG_PROXY, content));
        storeInKV(env.DATA_KV, `${dateStr}-report`, report);

        return new Response(JSON.stringify(report), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });
    } catch (error) {
        console.error('Error handling daily report:', error.message);
        return new Response(`Error handling daily report: ${error.message}`, { status: 500 });
    }
}