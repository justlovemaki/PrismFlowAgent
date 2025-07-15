import { replaceImageProxy, formatMarkdownText, formatDateToGMT12WithTime } from '../helpers.js';
import { getDailyReportContent } from '../github.js';
import { storeInKV } from '../kv.js';
import { marked } from '../marked.esm.js';
import { callChatAPI } from '../chatapi.js'; // 导入 callChatAPI
import { getSummarizationSimplifyPrompt } from "../prompt/summarizationSimplifyPrompt";

export async function handleWriteRssData(request, env) {
    const url = new URL(request.url);
    const dateStr = url.searchParams.get('date');
    console.log(`[writeRssData] Received request for date: ${dateStr}`);

    if (!dateStr) {
        console.error('[writeRssData] Missing date parameter');
        return new Response('Missing date parameter', { status: 400 });
    }

    try {
        const path = `daily/${dateStr}.md`;
        console.log(`[writeRssData] Attempting to get content from GitHub path: ${path}`);
        let content = await getDailyReportContent(env, path);
        
        if (!content) {
            console.warn(`[writeRssData] No content found for ${path}. Returning 404.`);
            return new Response(`No content found for ${path}`, { status: 404 });
        }
        console.log(`[writeRssData] Successfully retrieved content for ${path}. Content length: ${content.length}`);

        //content = extractContentFromSecondHash(content);
        // 从 "YYYY-MM-DD" 格式的 dateStr 中提取 "YYYY-MM"
        const yearMonth = dateStr.substring(0, 7);
        const report = {
            report_date: dateStr,
            title: dateStr+'日刊',
            link:  '/'+yearMonth+'/'+dateStr+'/',
            content_html: null,
            // 可以添加其他相關欄位，例如作者、來源等
            published_date: formatDateToGMT12WithTime(new Date()) // 記錄保存時間
        }
        report.content_html = marked.parse(formatMarkdownText(replaceImageProxy(env, content)));
        
        const kvKey = `${dateStr}-report`;
        console.log(`[writeRssData] Preparing to store report in KV. Key: ${kvKey}, Report object:`, JSON.stringify(report).substring(0, 200) + '...'); // Log first 200 chars
        await storeInKV(env.DATA_KV, kvKey, report);
        console.log(`[writeRssData] Successfully stored report in KV with key: ${kvKey}`);

        return new Response(JSON.stringify(report), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });
    } catch (error) {
        console.error('[writeRssData] Error handling daily report:', error.message, error.stack);
        return new Response(`Error handling daily report: ${error.message}`, { status: 500 });
    }
}

/**
 * 从第二个 ### 开始截取内容，包括 ###。
 *
 * @param {string} content - 原始文本内容。
 * @returns {string} 截取后的内容。
 */
export function extractContentFromSecondHash(content) {
    const parts = content.split('###');
    if (parts.length > 2) {
        // 原始逻辑：重新组合从第二个 ### 开始的所有部分
        const newcontent = '###' + parts.slice(2).join('###');
        const lastHashIndex = newcontent.lastIndexOf('###');
        if (lastHashIndex !== -1) {
            return newcontent.substring(0, lastHashIndex);
        }
    }
    return content; // 如果没有找到 ### 或不符合上述条件，则返回原始内容
}

/**
 * 调用 Gemini 或 OpenAI 模型生成指定提示词的内容。
 * 此方法可供外部调用。
 *
 * @param {object} env - 环境对象，包含 AI 模型相关的配置。
 * @param {string} promptText - 用户提示词。
 * @returns {Promise<string>} AI 模型生成的内容。
 * @throws {Error} 如果 API 调用失败或返回空内容。
 */
export async function generateAIContent(env, promptText) {
    console.log(`[generateAIContent] Calling AI model with prompt: ${promptText.substring(0, 100)}...`);
    try {
        let result = await callChatAPI(env, promptText, getSummarizationSimplifyPrompt());
        console.log(`[generateAIContent] AI model returned content. Length: ${result.length}`);

        result += "\n\n </br>"+env.INSERT_APP_URL;
        return result;
    } catch (error) {
        console.error('[generateAIContent] Error calling AI model:', error.message, error.stack);
        throw new Error(`Failed to generate AI content: ${error.message}`);
    }
}
