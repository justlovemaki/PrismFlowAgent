import { getISODate, escapeHtml, formatDateToChinese, convertEnglishQuotesToChinese} from '../helpers.js';
import { generateGenAiPageHtml } from '../htmlGenerators.js';
import { insertFoot } from '../foot.js';
import { insertAd } from '../ad.js';

export async function handleGenAIDailyPage(request, env) {
    let dateStr;
    try {
        const url = new URL(request.url);
        const dateParam = url.searchParams.get('date');
        dateStr = dateParam ? dateParam : getISODate();

        let dailySummaryMarkdownContent = `## ${env.DAILY_TITLE} ${formatDateToChinese(dateStr)}` + '\n\n';
        dailySummaryMarkdownContent += '> '+ env.DAILY_TITLE_MIN + '\n\n';
        
        dailySummaryMarkdownContent += '\n\n### **今日摘要**\n\n```\n' + '这里输入内容摘要' + '\n```\n\n';
        if (env.INSERT_AD=='true') dailySummaryMarkdownContent += insertAd() +`\n`;
        if (env.INSERT_FOOT=='true') dailySummaryMarkdownContent += insertFoot() +`\n\n`;

        const successHtml = generateGenAiPageHtml(
            env, 
            'AI日报', // Title for the page
            escapeHtml(dailySummaryMarkdownContent), 
            dateStr, 
            false, // isError
            [], // selectedItemsParams (not applicable here)
            null, null, // Call 1 prompts (not applicable here)
            null, null, // Call 2 prompts (not applicable here)
            'webbuild', // promptsMarkdownContent (not applicable here)
            convertEnglishQuotesToChinese(dailySummaryMarkdownContent), // dailySummaryMarkdownContent
            null, // podcastScriptMarkdownContent (not applicable here)
            true, // readGithub
        );
        return new Response(successHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

    } catch (error) {
        console.error("Error in /genAIDailyPage:", error);
        const pageDateForError = dateStr || getISODate(); 
        const errorHtml = generateGenAiPageHtml(env, '生成AI日报页面出错', `<p><strong>Unexpected error:</strong> ${escapeHtml(error.message)}</p>${error.stack ? `<pre>${escapeHtml(error.stack)}</pre>` : ''}`, pageDateForError, true, []);
        return new Response(errorHtml, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
}
