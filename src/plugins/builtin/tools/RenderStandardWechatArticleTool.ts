import { BaseTool } from '../../base/BaseTool.js';
import { LogService } from '../../../services/LogService.js';

/**
 * 微信公众号通用样式块定义
 */
const WECHAT_STYLES = {
  container: "font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', 'Source Han Sans SC', 'Noto Sans CJK SC', WenQuanYi Micro Hei, sans-serif; background-color: #ffffff; color: #353535; line-height: 1.8; padding: 20px; max-width: 100%; margin: 0 auto; box-sizing: border-box; font-size: 16px; -webkit-font-smoothing: antialiased;",
  h1: "font-size: 26px; color: #000; font-weight: bold; text-align: center; margin: 0; line-height: 1.3;",
  h2: "font-size: 18px; color: #ffffff; background-color: #07C160; font-weight: bold; padding: 5px 15px; border-radius: 4px; display: inline-block; line-height: 1.4; box-shadow: 3px 3px 0px rgba(7, 193, 96, 0.2);",
  h3: "font-size: 17px; color: #07C160; font-weight: bold; margin: 30px 0 15px 0; border-left: 4px solid #07C160; padding-left: 12px; line-height: 1.4;",
  p: "font-size: 16px; color: #3f3f3f; margin: 0 0 1.6em 0; line-height: 1.8; text-align: justify; letter-spacing: 0.03em;",
  blockquote: "margin: 25px 0; padding: 20px; background-color: #fcfcfc; border-radius: 10px; border-left: 4px solid #07C160; color: #576b95; font-size: 15px; line-height: 1.7; box-shadow: 0 4px 12px rgba(0,0,0,0.02);",
  codeBlock: "margin: 25px 0; padding: 16px; background-color: #282c34; border-radius: 10px; font-family: 'Operator Mono', 'Fira Code', Consolas, Monaco, monospace; font-size: 13px; color: #abb2bf; line-height: 1.5; overflow-x: auto; white-space: pre; border: none; box-shadow: 0 8px 20px rgba(0,0,0,0.1);",
  imageBox: "text-align: center; margin: 30px 0; display: block;",
  image: "max-width: 100%; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); display: inline-block;",
  listContainer: "margin: 20px 0; padding-left: 25px; color: #353535;",
  listItem: "font-size: 16px; margin-bottom: 12px; line-height: 1.7;",
  strong: "font-weight: bold;",
  inlineLink: "color: #576b95; text-decoration: none; border-bottom: 1px solid #576b95;",
  hr: "border: 0; height: 1px; background-image: linear-gradient(to right, transparent, #eee, transparent); margin: 40px 0;",
  table: "width: 100%; border-collapse: collapse; margin: 25px 0; font-size: 14px; border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden;",
  th: "border: 1px solid #f0f0f0; padding: 12px; background-color: #fafafa; font-weight: bold; color: #333; text-align: center;",
  td: "border: 1px solid #f0f0f0; padding: 12px; color: #666; text-align: center; word-break: break-all;"
};

/**
 * 通用微信公众号 HTML 渲染器
 */
export class WechatRenderer {

  public static renderH1(text: string): string {
    return `
      <div style="text-align: center; margin: 40px 0 35px 0;">
        <h1 style="${WECHAT_STYLES.h1}">${this.formatInline(text)}</h1>
        <div style="width: 32px; height: 3px; background: #07C160; margin: 12px auto; border-radius: 2px; opacity: 0.8;"></div>
      </div>`;
  }

  public static renderH2(text: string): string {
    return `
      <div style="margin: 45px 0 25px 0; text-align: left;">
        <span style="${WECHAT_STYLES.h2}">${this.formatInline(text)}</span>
      </div>`;
  }

  public static renderH3(text: string): string {
    return `<h3 style="${WECHAT_STYLES.h3}">${this.formatInline(text)}</h3>`;
  }

  public static renderP(text: string): string {
    const content = this.formatInline(text);
    if (!content) return '';
    return `<p style="${WECHAT_STYLES.p}">${content}</p>`;
  }

  public static renderQuote(text: string): string {
    return `<blockquote style="${WECHAT_STYLES.blockquote}">${this.formatInline(text)}</blockquote>`;
  }

  public static renderCodeBlock(code: string): string {
    // 基础转义
    const escaped = code
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');
    return `<pre style="${WECHAT_STYLES.codeBlock}"><code>${escaped}</code></pre>`;
  }

  public static renderImage(src: string, alt: string = ''): string {
    return `
      <div style="${WECHAT_STYLES.imageBox}">
        <img src="${src}" alt="${alt}" style="${WECHAT_STYLES.image}">
      </div>`;
  }

  public static renderHr(): string {
    return `<hr style="${WECHAT_STYLES.hr}">`;
  }

  public static renderTable(rows: string[][]): string {
    let html = `<table style="${WECHAT_STYLES.table}">`;
    rows.forEach((row, index) => {
      const isHeader = index === 0;
      html += `<tr>`;
      row.forEach(cell => {
        const content = this.formatInline(cell);
        const style = isHeader ? WECHAT_STYLES.th : WECHAT_STYLES.td;
        html += `<${isHeader ? 'th' : 'td'} style="${style}">${content}</${isHeader ? 'th' : 'td'}>`;
      });
      html += `</tr>`;
    });
    html += `</table>`;
    return html;
  }

  /**
   * 格式化行内元素，增加安全机制防止破坏 HTML 标签
   */
  public static formatInline(text: string): string {
    if (!text) return '';
    let html = text.trim();

    // 1. 临时保护图片语法
    const images: string[] = [];
    html = html.replace(/!\[(.*?)\]\((https?:\/\/.*?)\)/g, (m, alt, src) => {
      const id = images.length;
      images.push(`<img src="${src}" alt="${alt}" style="max-width: 100%; border-radius: 2px; display: block; margin: 5px auto;">`);
      return `@@@IMG_BLOCK_${id}@@@`;
    });

    // 2. 处理加粗
    html = html.replace(/\*\*(.*?)\*\*/g, `<strong style="${WECHAT_STYLES.strong}">$1</strong>`);
    html = html.replace(/__(.*?)__/g, `<strong style="${WECHAT_STYLES.strong}">$1</strong>`);

    // 3. 处理链接
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, `<span style="${WECHAT_STYLES.inlineLink}">$1</span>`);

    // 4. 数字高亮 (安全过滤：使用负向先行断言，避免匹配到 HTML 属性/样式中的数字或百分比)
    // 同时也避开我们的占位符中的数字
    html = html.replace(/(\d+(?:\.\d+)?[倍万亿美元%]+)(?![;\"=_@])/g, `<span style="color: #07C160; font-weight: bold;">$1</span>`);

    // 5. 还原图片 (使用全局替换确保万无一失)
    images.forEach((img, i) => {
      const placeholder = `@@@IMG_BLOCK_${i}@@@`;
      html = html.split(placeholder).join(img);
    });

    return html;
  }

  public static convert(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    let html = '';
    
    let inQuote = false;
    let quoteContent: string[] = [];
    let inList = false;
    let listItems: string[] = [];
    let listType: 'ul' | 'ol' = 'ul';
    let inTable = false;
    let tableRows: string[][] = [];
    let inCodeBlock = false;
    let codeContent: string[] = [];

    const flushQuote = () => {
      if (inQuote) {
        html += this.renderQuote(quoteContent.join('<br>'));
        inQuote = false;
        quoteContent = [];
      }
    };

    const flushList = () => {
      if (inList) {
        html += `<${listType} style="${WECHAT_STYLES.listContainer}">`;
        listItems.forEach(item => {
          html += `<li style="${WECHAT_STYLES.listItem}">${this.formatInline(item)}</li>`;
        });
        html += `</${listType}>`;
        inList = false;
        listItems = [];
      }
    };

    const flushTable = () => {
      if (inTable) {
        if (tableRows.length > 0) html += this.renderTable(tableRows);
        inTable = false;
        tableRows = [];
      }
    };

    const flushCode = () => {
      if (inCodeBlock) {
        html += this.renderCodeBlock(codeContent.join('\n'));
        inCodeBlock = false;
        codeContent = [];
      }
    };

    const flushAll = () => {
      flushQuote(); flushList(); flushTable(); flushCode();
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 代码块优先
      if (trimmed.startsWith('```')) {
        if (inCodeBlock) {
          flushCode();
        } else {
          flushAll();
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) {
        codeContent.push(line);
        continue;
      }

      if (!trimmed) {
        // 如果在列表中，检查后面是否还有同类型的列表项，以决定是否保持列表连续
        if (inList) {
          let continues = false;
          for (let j = i + 1; j < lines.length; j++) {
            const nextTrimmed = lines[j].trim();
            if (!nextTrimmed) continue;
            const match = nextTrimmed.match(/^(\d+\.|\*|-)\s+/);
            if (match) {
              const type = match[0].match(/\d+\./) ? 'ol' : 'ul';
              if (type === listType) {
                continues = true;
              }
            }
            break;
          }
          if (continues) continue;
        }
        flushAll();
        continue;
      }

      // 表格 (| 开头)
      if (trimmed.startsWith('|')) {
        flushQuote(); flushList();
        inTable = true;
        // 分割列
        const cells = trimmed.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (cells.every(c => /^-+$/.test(c))) continue;
        tableRows.push(cells);
        continue;
      } else if (inTable) {
        flushTable();
      }

      // 标题
      if (trimmed.startsWith('# ')) {
        flushAll();
        html += this.renderH1(trimmed.substring(2));
      } else if (trimmed.startsWith('## ')) {
        flushAll();
        html += this.renderH2(trimmed.substring(3));
      } else if (trimmed.startsWith('### ')) {
        flushAll();
        html += this.renderH3(trimmed.substring(4));
      } 
      // 引用
      else if (trimmed.startsWith('> ')) {
        flushList(); flushTable();
        inQuote = true;
        quoteContent.push(trimmed.substring(2));
      }
      // 列表
      else if (trimmed.match(/^(\d+\.|\*|-)\s+/)) {
        const match = trimmed.match(/^(\d+\.|\*|-)\s+/);
        const type = match && match[0].match(/\d+\./) ? 'ol' : 'ul';

        if (inList && listType !== type) {
          flushList();
        }

        if (!inList) {
          flushQuote(); flushTable(); flushCode();
          inList = true;
          listType = type;
        }
        listItems.push(trimmed.replace(/^(\d+\.|\*|-)\s+/, ''));
        continue;
      }
      // 分隔线
      else if (trimmed === '---' || trimmed === '***') {
        flushAll();
        html += this.renderHr();
      }
      // 普通段落
      else {
        if (inQuote) {
          quoteContent.push(trimmed);
        } else if (inList) {
          listItems[listItems.length - 1] += ' ' + trimmed;
        } else {
          html += this.renderP(trimmed);
        }
      }
    }

    flushAll();

    return `<section style="${WECHAT_STYLES.container}">${html}</section>`;
  }
}

/**
 * 通用微信公众号 HTML 渲染工具
 */
export class RenderStandardWechatArticleTool extends BaseTool {
  readonly id = 'render_standard_wechat_article';
  readonly name = 'render_standard_wechat_article';
  readonly description = '将通用 Markdown 转换为符合微信公众号标准的 HTML 格式。支持标题、代码块、表格、引用、列表、图片等标准语法。';
  readonly isBuiltin = true;
  readonly parameters = {
    type: 'object',
    properties: {
      markdown: { type: 'string', description: '待渲染的 Markdown 内容' }
    },
    required: ['markdown']
  };

  async handler(args: any) {
    try {
      LogService.info(`Tool: render_standard_wechat_article - Conversion starting...`);
      const markdown = args.markdown || args.content || args.dailyMd;
      if (!markdown) {
        throw new Error('缺少必要参数: markdown');
      }

      const html = WechatRenderer.convert(markdown);
      
      LogService.info(`Tool: render_standard_wechat_article - Conversion complete.`);
      return { 
        summary: `已完成 Markdown 到微信 HTML 的全功能渲染。`,
        html: html
      };
    } catch (error: any) {
      LogService.error(`Tool: render_standard_wechat_article error: ${error.message}`);
      return { error: `渲染失败: ${error.message}` };
    }
  }
}
