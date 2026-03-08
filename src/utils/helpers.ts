export function getISODate(dateObj: Date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai'
  };
  const dateString = dateObj.toLocaleDateString('en-CA', options);
  return dateString;
}

export function escapeHtml(unsafe: any): string {
  if (unsafe === null || typeof unsafe === 'undefined') {
    return '';
  }
  const str = String(unsafe);
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return str.replace(/[&<>"']/g, (m) => map[m]);
}

export function removeMarkdownCodeBlock(text: string): string {
  if (!text) return '';
  let cleanedText = text.trim();

  const jsonFence = "```json";
  const markdownFence = "```markdown";
  const genericFence = "```";

  if (cleanedText.startsWith(jsonFence)) {
      cleanedText = cleanedText.substring(jsonFence.length);
  } else if (cleanedText.startsWith(markdownFence)) {
      cleanedText = cleanedText.substring(markdownFence.length);
  } else if (cleanedText.startsWith(genericFence)) {
      cleanedText = cleanedText.substring(genericFence.length);
  }

  if (cleanedText.endsWith(genericFence)) {
      cleanedText = cleanedText.substring(0, cleanedText.length - genericFence.length);
  }
  return cleanedText.trim();
}

export function stripHtml(html: string): string {
  if (!html) return "";
  
  // 1. 移除 script 和 style 标签及其内容 (HTML 中的 CSS 和 JS)
  let processedHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  processedHtml = processedHtml.replace(/<style[\s\S]*?<\/style>/gi, '');
  
  // 2. 移除 Markdown 格式的 CSS 代码块 (如果存在)
  processedHtml = processedHtml.replace(/```css[\s\S]*?```/gi, '');
  
  // 3. 处理图片和视频（保留基本信息，作为纯文本中的占位符）
  processedHtml = processedHtml.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, (match, src, alt) => {
    return alt ? `[图片: ${alt} ${src}]` : `[图片: ${src}]`;
  });
  processedHtml = processedHtml.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '[图片: $1]');
  processedHtml = processedHtml.replace(/<video[^>]*src="([^"]*)"[^>]*>.*?<\/video>/gi, '[视频: $1]');
  
  // 4. 移除所有其他 HTML 标签
  return processedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function convertToShanghaiTime(dateString: string | Date): Date {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    timeZone: 'Asia/Shanghai'
  });
  
  const parts = formatter.formatToParts(date);
  const map: Record<string, number> = {};
  parts.forEach(p => {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value);
  });
  
  return new Date(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function convertEnglishQuotesToChinese(text: string): string {
  if (!text) return '';
  return text
    .replace(/"([^"]*)"/g, '“$1”')
    .replace(/'([^']*)'/g, '‘$1’');
}

export function formatMarkdownText(text: string): string {
  return convertEnglishQuotesToChinese(text);
}

export function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

export function extractContentFromSecondHash(content: string): string {
  const parts = content.split('###');
  if (parts.length > 1) {
    // 调整逻辑：重新组合从第一个 ### 开始的所有部分
    let newcontent = '###' + parts.slice(1).join('###');
    const lastHashIndex = newcontent.lastIndexOf('AI资讯日报多渠道');
    if (lastHashIndex !== -1) {
      newcontent = newcontent.substring(0, lastHashIndex - 10);
    }
    return newcontent;
  }
  return content; // 如果没有找到 ### 或不符合上述条件，则返回原始内容
}

export function truncateContent(content: string, maxLength = 150): string {
  if (!content || content.length <= maxLength) {
    return content;
  }

  // 截断到指定长度
  let truncated = content.substring(0, maxLength);

  // 尝试在最后一个换行符处截断
  const lastNewlineEnd = truncated.lastIndexOf('\n');

  // 如果找到换行符且位置合理（至少保留一半内容），则在换行符处截断
  if (lastNewlineEnd > maxLength / 2) {
    truncated = content.substring(0, lastNewlineEnd);
  }

  // 添加省略样式
  truncated += '\n\n......\n\n*[剩余内容已省略]*';

  return truncated;
}

export function getAppUrl(): string {
  return `

---

**📢 关于 AI日报 的一次小调整**
>
坦白说，想要长久地把**AI日报**做下去，单靠“为爱发电”确实面临现实压力。为了更有热情的**投入精力**， 日报网站版需要来自你们的访问。
>
由于 RSS 无法展示广告带来收入，即日起 RSS 将**试运行“摘要模式”一段时间**。
>
感谢您的理解与陪伴，让我们一起走得更远！
>
👇 **点击下方链接，阅读今日完整资讯**
### [前往官网查看完整版 (ai.hubtoday.app)](https://ai.hubtoday.app/)
>
**或者微信关注公众号: 何夕2077**
>
>
>
<small>如有建议，欢迎随时邮件沟通：[justlikemaki@foxmail.com](mailto:justlikemaki@foxmail.com)</small>
<br/>
<small>或加我进群提供建议:</small>
<br/>
![加我进群-何夕2077AI日报问题反馈](https://source.hubtoday.app/logo/wechat-qun.jpg)

    `;
}

export function formatDateToGMT8WithTime(date: Date | string): string {
  if (!date) return '';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai'
  };
  return new Intl.DateTimeFormat('zh-CN', options).format(dateObj);
}

/**
 * 解析 GitHub URL，获取 owner, repo, branch 和 path
 */
export function parseGithubUrl(url: string) {
  try {
    // 匹配 https://github.com/owner/repo/tree/branch/path 或 blob
    const regex = /github\.com\/([^/]+)\/([^/]+)\/(tree|blob)\/([^/]+)\/(.+)/;
    const match = url.match(regex);
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
        branch: match[4],
        path: match[5]
      };
    }
    
    // 如果没有 tree/blob，可能是根目录
    const rootRegex = /github\.com\/([^/]+)\/([^/]+)/;
    const rootMatch = url.match(rootRegex);
    if (rootMatch) {
      return {
        owner: rootMatch[1],
        repo: rootMatch[2],
        branch: 'main',
        path: ''
      };
    }
  } catch (e) {
    return null;
  }
  return null;
}
