import { IPublisher } from '../../../../types/plugin.js';
import { LogService } from '../../../../services/LogService.js';
import { PublisherMetadata } from '../../../../registries/PublisherRegistry.js';
import { BrowserBridgePublisherSupport, type BrowserBridgeConfig } from '../shared/BrowserBridgePublisherSupport.js';
import { fileURLToPath } from 'url';
import path from 'path';
import http from 'http';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../../../../../skills/browser-remote-control/scripts/cli.js');

export interface XhsConfig extends BrowserBridgeConfig {
  publishUrl?: string;
  imageUrl?: string;
  postType?: 'normal' | 'long';
  isDraft?: boolean;
}

function toUnicodeEscape(str: string): string {
  return str.split('').map(char => {
    const code = char.charCodeAt(0);
    if (code > 127) {
      return '\\u' + code.toString(16).padStart(4, '0');
    }
    return char;
  }).join('');
}

function cleanMarkdownToPlainText(content: string): string {
  if (!content) return '';

  let text = content;

  // 1. 移除 HTML 标签
  text = text.replace(/<[^>]*>/g, '');

  // 2. 移除图片
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');

  // 3. 替换链接 [text](url) -> text
  text = text.replace(/\[(.*?)\]\(.*?\)/g, '$1');

  // 4. 移除粗体、斜体、删除线
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');

  // 5. 移除代码块和行内代码
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    return match.replace(/```[a-zA-Z]*/g, '').replace(/```/g, '').trim();
  });
  text = text.replace(/`(.*?)`/g, '$1');

  // 6. 移除标题符号 #, ## 等，并在末尾加上空行
  text = text.replace(/^(#+)\s+(.+)$/gm, '$2');

  // 7. 移除引用符号 >
  text = text.replace(/^\s*>\s+(.+)$/gm, '$1');

  // 8. 移除分割线 ---, ***
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, '');

  // 9. 规范化无序列表符号
  text = text.replace(/^\s*[-*+]\s+(.+)$/gm, '• $1');
  
  // 10. 折叠过多连续空行 (最多保留两个换行)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function fetchAsDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchAsDataUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Image request failed with status ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || 'image/jpeg';
        resolve(`data:${contentType};base64,${buffer.toString('base64')}`);
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Image request timeout'));
    });
  });
}

export class XhsPublisher implements IPublisher {
  static metadata: PublisherMetadata = {
    id: 'xhs',
    name: '小红书',
    description: '通过浏览器自动化控制发布笔记到小红书',
    icon: 'book',
    configFields: [
      { key: 'publishUrl', label: '浏览器发布页 URL', type: 'text', default: 'https://creator.xiaohongshu.com/publish/publish', required: false },
      { key: 'imageUrl', label: '图文模式默认配图 URL', type: 'text', default: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500&h=500&fit=crop', required: false },
      { key: 'postType', label: '默认发布模式 (normal-图文, long-长文)', type: 'select', options: ['normal', 'long'], default: 'normal', required: false },
      { key: 'isDraft', label: '默认保存为草稿', type: 'boolean', default: false, required: false }
    ]
  };

  id = 'xhs';
  name = '小红书';
  description = XhsPublisher.metadata.description;
  icon = XhsPublisher.metadata.icon;
  configFields = XhsPublisher.metadata.configFields;

  private config: XhsConfig;
  private bridgeSupport: BrowserBridgePublisherSupport;

  constructor(config: XhsConfig) {
    this.config = config;
    this.bridgeSupport = new BrowserBridgePublisherSupport(cliPath, config, 'xhs_params');
  }

  private getPublishUrl(): string {
    return this.config.publishUrl || 'https://creator.xiaohongshu.com/publish/publish';
  }

  private async runCli(method: string, params: any, timeoutMs: number = 120000): Promise<any> {
    return this.bridgeSupport.runCli(method, params, timeoutMs);
  }

  private async getTabId(): Promise<number> {
    const publishUrl = this.getPublishUrl();

    LogService.info('XHS: Detecting existing Xiaohongshu tab...');
    const tabsResult = await this.runCli('getTabs', {});
    if (tabsResult && tabsResult.result && Array.isArray(tabsResult.result)) {
      const xhsTab = tabsResult.result.find((tab: any) => tab.url && tab.url.includes(publishUrl));
      if (xhsTab) {
        LogService.info(`XHS: Found existing tab with ID ${xhsTab.id}`);
        return xhsTab.id;
      }
    }

    LogService.info('XHS: Opening new tab for Xiaohongshu...');
    const createResult = await this.runCli('createTab', {
      url: publishUrl,
      group: '小红书发布'
    });
    if (createResult && createResult.result && createResult.result.id) {
      // 给予新打开页面 2 秒加载时间
      await new Promise(r => setTimeout(r, 2000));
      return createResult.result.id;
    }

    throw new Error('Failed to get or create Xiaohongshu browser tab');
  }

  async publish(content: string, options: { 
    title?: string; 
    imageUrls?: string[];
    isDraft?: boolean;
    tabId?: string;
    postType?: 'normal' | 'long';
  }) {
    const title = options.title || '';
    const isDraft = options.isDraft !== undefined ? options.isDraft : (this.config.isDraft || false);
    const postType = options.postType || this.config.postType || 'normal';
    
    let finalImageUrl = options.imageUrls?.[0] || this.config.imageUrl || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500&h=500&fit=crop';
    if (!options.imageUrls?.length) {
      const match = content.match(/!\[.*?\]\((.*?)\)/);
      if (match && match[1]) {
        finalImageUrl = match[1];
      }
    }

    const normalizedImageUrls = Array.from(new Set((options.imageUrls || []).filter(Boolean)));
    const finalImageUrls = finalImageUrl
      ? [finalImageUrl, ...normalizedImageUrls.filter(url => url !== finalImageUrl)]
      : normalizedImageUrls;

    LogService.info(`Publishing to Xiaohongshu [Mode: ${postType}]: ${title} (isDraft: ${isDraft})`);

    const tabId = options.tabId ? parseInt(options.tabId, 10) : await this.getTabId();

    // 清洗 Markdown/HTML 内容为纯文本，小红书不支持富文本排版源码
    const cleanedContent = cleanMarkdownToPlainText(content);

    const preparedImageSources: string[] = [];
    for (const url of finalImageUrls) {
      try {
        preparedImageSources.push(await fetchAsDataUrl(url));
      } catch (error: any) {
        LogService.warn(`XHS: Failed to prefetch image ${url}: ${error.message}`);
      }
    }

    // 转换所有变量为 JSON 字符串，避开换行与引号语法错误并直接保留中文明文
    const escapedTitle = JSON.stringify(title);
    const escapedDesc = JSON.stringify(cleanedContent);
    const escapedImageUrl = JSON.stringify(finalImageUrl);
    const escapedImageUrls = JSON.stringify(preparedImageSources);
    const escapedPublishUrl = JSON.stringify(this.getPublishUrl());
    const isDraftBool = !!isDraft;

    const tabTextEscaped = toUnicodeEscape('上传图文');
    const longTabTextEscaped = toUnicodeEscape('写长文');
    const newCreateTextEscaped = toUnicodeEscape('新的创作');
    const formatTextEscaped = toUnicodeEscape('一键排版');
    const nextTextEscaped = toUnicodeEscape('下一步');

    const runEvaluateWithRetry = async (script: string, timeoutMs: number = 120000) => {
      let result: any = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          result = await this.runCli('evaluateScript', { tabId, script }, timeoutMs);

          if (result && result.error) {
            if (result.error.includes('navigated') || result.error.includes('closed')) {
              LogService.warn(`XHS: Tab navigated during evaluation. Waiting for page load (attempt ${attempt}/2)...`);
              await new Promise(r => setTimeout(r, 4500));
              continue;
            }
            throw new Error(result.error);
          }

          const scriptResult = result?.result?.result || result?.result;
          if (scriptResult && scriptResult.success === false && scriptResult.error === 'NAVIGATED') {
            LogService.info(`XHS: Page navigated for reset. Waiting for page load (attempt ${attempt}/2)...`);
            await new Promise(r => setTimeout(r, 4500));
            continue;
          }

          return scriptResult;
        } catch (e: any) {
          if (attempt === 2) throw e;
          if (e.message.includes('navigated') || e.message.includes('closed')) {
            LogService.warn(`XHS: Tab navigated during evaluation. Waiting for page load (attempt ${attempt}/2)...`);
            await new Promise(r => setTimeout(r, 4500));
            continue;
          }
          throw e;
        }
      }

      return result?.result?.result || result?.result;
    };

    if (postType === 'long') {
      const prepareLongScript = `
      (async () => {
        if (window.location.href.includes('/login')) {
          return { success: false, error: 'NEED_LOGIN' };
        }

        // 智能页面重置与自适应等待逻辑：确保在干净的发布路径并等待 Tab 渲染就绪
        const publishUrl = ${escapedPublishUrl};

        if (!window.location.href.includes(publishUrl)) {
          window.location.href = publishUrl;
          return { success: false, error: 'NAVIGATED' };
        }

        let hasTabs = null;
        for (let i = 0; i < 10; i++) {
          hasTabs = document.querySelector('.creator-tab');
          if (hasTabs) break;
          await new Promise(r => setTimeout(r, 500));
        }

        if (!hasTabs) {
          window.location.href = publishUrl;
          return { success: false, error: 'NAVIGATED' };
        }

        // 1. 切换到“写长文”
        const tabs = Array.from(document.querySelectorAll('.creator-tab'));
        const longArticleTab = tabs.find(t => t.innerText && t.innerText.includes("${longTabTextEscaped}"));
        if (longArticleTab) {
          longArticleTab.click();
          await new Promise(r => setTimeout(r, 1500));
        }

        // 2. 点击“新的创作”
        const all = Array.from(document.querySelectorAll('*'));
        const newCreateBtn = all.find(el => el.innerText && el.innerText.trim() === "${newCreateTextEscaped}");
        if (newCreateBtn) {
          newCreateBtn.click();
          await new Promise(r => setTimeout(r, 2000));
        }

        // 3. 输入标题
        const titleInput = document.querySelector('.rich-editor-title textarea.d-text');
        if (titleInput) {
          titleInput.focus();
          titleInput.select();
          document.execCommand('insertText', false, ${escapedTitle});
        }

        // 4. 输入正文描述
        const descInput = document.querySelector('.tiptap.ProseMirror');
        if (descInput) {
          descInput.focus();
          const range = document.createRange();
          range.selectNodeContents(descInput);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('insertText', false, ${escapedDesc});
        }

        await new Promise(r => setTimeout(r, 1000));

        // 5. 点击“一键排版”
        const nextBtn = document.querySelector('.next-btn');
        if (nextBtn) {
          nextBtn.click();
        }

        // 6. 等待“下一步”按钮出现
        let submitBtn = null;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 500));
          submitBtn = document.querySelector('.custom-button.submit');
          if (submitBtn && submitBtn.innerText && submitBtn.innerText.includes("${nextTextEscaped}")) {
            break;
          }
        }

        if (!submitBtn) return { success: false, error: 'LONG_ARTICLE_SUBMIT_BUTTON_TIMEOUT' };

        // 7. 点击“下一步”前往最终发布页
        submitBtn.click();

        // 8. 等待最终发布组件挂载
        let publishBtnHost = null;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 500));
          publishBtnHost = document.querySelector('xhs-publish-btn');
          if (publishBtnHost && publishBtnHost._sr) {
            break;
          }
        }

        if (!publishBtnHost || !publishBtnHost._sr) {
          return { success: false, error: 'PUBLISH_BTN_NOT_FOUND_AFTER_NEXT' };
        }

        return { success: true, stage: 'READY_TO_FINALIZE', url: window.location.href };
      })()
    `;

      const finalizeLongScript = `
      (async () => {
        if (window.location.href.includes('/login')) {
          return { success: false, error: 'NEED_LOGIN' };
        }

        let el = null;
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 500));
          el = document.querySelector('xhs-publish-btn');
          if (el && el._sr) break;
        }

        if (!el || !el._sr) return { success: false, error: 'PUBLISH_BTN_NOT_FOUND_IN_FINALIZE' };

        const isDraft = ${isDraftBool};
        const btnSelector = isDraft ? '.ce-btn.white' : '.ce-btn.bg-red';
        const actionBtn = el._sr.querySelector(btnSelector);
        if (!actionBtn) return { success: false, error: 'ACTION_BUTTON_NOT_FOUND_IN_SHADOW' };

        actionBtn.click();

        let success = false;
        for (let i = 0; i < 24; i++) {
          await new Promise(r => setTimeout(r, 500));
          const text = document.body.textContent || '';
          if (text.includes('\\u4fdd\\u5b58\\u6210\\u529f') || text.includes('\\u53d1\\u5e03\\u6210\\u529f')) {
            success = true;
            break;
          }
        }

        return { success, url: window.location.href };
      })()
    `;

      const prepareResult = await runEvaluateWithRetry(prepareLongScript, 120000);
      if (prepareResult && prepareResult.success === false) {
        if (prepareResult.error === 'NEED_LOGIN') {
          throw new Error('小红书创作者服务平台尚未登录，请在浏览器中完成登录后再试。');
        }
        throw new Error(`小红书发布失败: ${prepareResult.error}`);
      }

      const finalizeResult = await runEvaluateWithRetry(finalizeLongScript, 30000);
      if (finalizeResult && finalizeResult.success === false) {
        if (finalizeResult.error === 'NEED_LOGIN') {
          throw new Error('小红书创作者服务平台尚未登录，请在浏览器中完成登录后再试。');
        }
        throw new Error(`小红书发布失败: ${finalizeResult.error}`);
      }

      return {
        success: true,
        title,
        isDraft,
        url: finalizeResult?.url || prepareResult?.url || ''
      };
    }

    const script = `
      (async () => {
        if (window.location.href.includes('/login')) {
          return { success: false, error: 'NEED_LOGIN' };
        }

        // 智能页面重置与自适应等待逻辑：确保在干净的发布路径并等待 Tab 渲染就绪
        const publishUrl = ${escapedPublishUrl};

        if (!window.location.href.includes(publishUrl)) {
          window.location.href = publishUrl;
          return { success: false, error: 'NAVIGATED' };
        }

        let hasTabs = null;
        for (let i = 0; i < 10; i++) {
          hasTabs = document.querySelector('.creator-tab');
          if (hasTabs) break;
          await new Promise(r => setTimeout(r, 500));
        }

        if (!hasTabs) {
          window.location.href = publishUrl;
          return { success: false, error: 'NAVIGATED' };
        }

          // ================= 原有图文 (normal) 发布流程 =================
          
          // 1. 切换到“上传图文”
          const tabs = Array.from(document.querySelectorAll('.creator-tab'));
          const imgTextTab = tabs.find(t => t.innerText && t.innerText.includes("${tabTextEscaped}"));
          if (imgTextTab) {
            imgTextTab.click();
            await new Promise(r => setTimeout(r, 1500));
          }

          // 2. 获取并上传图片 File 对象
          const sourceImageUrls = ${escapedImageUrls};
          const files = [];
          for (let idx = 0; idx < sourceImageUrls.length; idx++) {
            try {
              const imageSource = sourceImageUrls[idx];
              let blob;
              if (imageSource.startsWith('data:')) {
                const response = await fetch(imageSource);
                blob = await response.blob();
              } else {
                const controller = new AbortController();
                const tId = setTimeout(() => controller.abort(), 8000);
                const response = await fetch(imageSource, { signal: controller.signal });
                clearTimeout(tId);
                blob = await response.blob();
              }
              files.push(new File([blob], 'prismflow_' + (idx + 1) + '.jpg', { type: blob.type || 'image/jpeg' }));
            } catch (e) {
            }
          }

          if (files.length === 0) {
            const canvas = document.createElement('canvas');
            canvas.width = 1200;
            canvas.height = 1600;
            const ctx = canvas.getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, 0, 1600);
            grad.addColorStop(0, '#ff2442');
            grad.addColorStop(1, '#333333');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1200, 1600);

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.font = 'bold 80px sans-serif';
            ctx.fillText('PrismFlow Daily', 600, 700);
            ctx.font = '40px sans-serif';
            ctx.fillText('Automated AI Content Delivery', 600, 800);

            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
            files.push(new File([blob], 'fallback_cover.jpg', { type: 'image/jpeg' }));
          }

          const input = document.querySelector('input.upload-input') || Array.from(document.querySelectorAll('input')).find(x => x.type === 'file');
          if (!input) return { success: false, error: 'UPLOAD_INPUT_NOT_FOUND' };

          const dataTransfer = new DataTransfer();
          files.forEach(file => dataTransfer.items.add(file));
          input.files = dataTransfer.files;
          
          // 触发全套上传事件
          input.dispatchEvent(new Event('change', { bubbles: true }));
          
          const dropZone = input.closest('.upload-wrapper') || input.parentElement || input;
          ['dragenter', 'dragover', 'drop'].forEach(name => {
            const event = new DragEvent(name, { 
              bubbles: true, 
              cancelable: true, 
              dataTransfer 
            });
            dropZone.dispatchEvent(event);
          });

          // 等待上传渲染完成与按钮加载
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (document.querySelector('.img-list') || document.querySelector('xhs-publish-btn')) break;
          }
          await new Promise(r => setTimeout(r, 1000));

          // 3. 输入标题
          const titleInput = document.querySelector('input.d-text');
          if (titleInput) {
            titleInput.focus();
            titleInput.select();
            document.execCommand('insertText', false, ${escapedTitle});
          }

          // 4. 输入正文描述
          const descInput = document.querySelector('.tiptap.ProseMirror');
          if (descInput) {
            descInput.focus();
            const range = document.createRange();
            range.selectNodeContents(descInput);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('insertText', false, ${escapedDesc});
          }

          await new Promise(r => setTimeout(r, 1000));

          // 5. 点击发布 (\\u53d1\\u5e03) 或草稿
          const el = document.querySelector('xhs-publish-btn');
          if (!el || !el._sr) return { success: false, error: 'PUBLISH_BTN_NOT_FOUND' };

          const isDraft = ${isDraftBool};
          const btnSelector = isDraft ? '.ce-btn.white' : '.ce-btn.bg-red';
          const actionBtn = el._sr.querySelector(btnSelector);
          if (!actionBtn) return { success: false, error: 'ACTION_BUTTON_NOT_FOUND' };

          actionBtn.click();

          // 自适应等待发布或保存完成 (最多等待 12 秒)
          let success = false;
          for (let i = 0; i < 24; i++) {
            await new Promise(r => setTimeout(r, 500));
            const text = document.body.textContent || '';
            if (text.includes('\\u4fdd\\u5b58\\u6210\\u529f') || text.includes('\\u53d1\\u5e03\\u6210\\u529f')) {
              success = true;
              break;
            }
          }

          return { success, url: window.location.href };
      })()
    `;

    const scriptResult = await runEvaluateWithRetry(script, 30000);
    if (scriptResult && scriptResult.success === false) {
      if (scriptResult.error === 'NEED_LOGIN') {
        throw new Error('小红书创作者服务平台尚未登录，请在浏览器中完成登录后再试。');
      }
      throw new Error(`小红书发布失败: ${scriptResult.error}`);
    }

    return {
      success: true,
      title,
      isDraft,
      url: scriptResult?.url || ''
    };
  }

  getItemUrl(item: any) {
    return item.url || this.getPublishUrl();
  }
}
