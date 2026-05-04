import axios from 'axios';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import os from 'os';
import crypto from 'crypto';
import { LogService } from '../../../../services/LogService.js';

// 从环境变量读取性能配置，提供默认值以保证稳定性
const SHARP_THREADS = parseInt(process.env.WECHAT_SHARP_THREADS || '1', 10);
const FFMPEG_THREADS = process.env.WECHAT_FFMPEG_THREADS || '1';
const MAX_CONCURRENT = parseInt(process.env.WECHAT_MAX_CONCURRENT || '2', 10);

// 限制 sharp 资源消耗
sharp.concurrency(SHARP_THREADS);
sharp.cache(false); // 禁用内存缓存，以节省内存

export interface WechatConfig {
  appId: string;
  appSecret: string;
  title?: string;
  author?: string;
  baseUrl?: string;
  fallbackLogoUrl?: string;
}

export interface PublishOptions {
  title: string;
  content: string;
  thumbMediaId?: string;
  author?: string;
  digest?: string;
  articleType?: 'news' | 'newspic';
  imageMediaIds?: string[];
}

export interface ProcessedImageData {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

export class WechatService {
  private static instance: WechatService;
  private config: WechatConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  // 全局图片处理并发锁，限制同时进行 CPU 密集型转换的任务数
  private static readonly MAX_CONCURRENT_PROCESSING = MAX_CONCURRENT;
  private static activeProcessingCount = 0;

  private constructor(config: WechatConfig) {
    this.config = config;
  }

  /**
   * 使用信号量机制管理并发任务，增加超时和内存监控
   */
  private static async runInQueue<T>(taskName: string, task: () => Promise<T>, timeoutMs: number = 180000): Promise<T> {
    const startTime = Date.now();
    const memBefore = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    LogService.info(`[Queue] "${taskName}" waiting. Active: ${this.activeProcessingCount}/${this.MAX_CONCURRENT_PROCESSING}, Mem: ${memBefore}MB`);
    
    // 等待获取空闲槽位
    while (this.activeProcessingCount >= this.MAX_CONCURRENT_PROCESSING) {
      // 避免无限等待，如果排队超过 5 分钟也强行报错
      if (Date.now() - startTime > 300000) {
        throw new Error(`[Queue] Task "${taskName}" wait timeout after 5 minutes`);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    this.activeProcessingCount++;
    const executionStart = Date.now();
    LogService.info(`[Queue] "${taskName}" started. Mem: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

    try {
      // 使用 Promise.race 实现超时控制
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`[Queue] Task "${taskName}" execution timeout after ${timeoutMs}ms`)), timeoutMs);
      });

      const result = await Promise.race([task(), timeoutPromise]);
      const duration = Date.now() - executionStart;
      const memAfter = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      LogService.info(`[Queue] "${taskName}" success in ${duration}ms. Mem: ${memAfter}MB (Diff: ${memAfter - memBefore}MB)`);
      return result;
    } catch (err: any) {
      LogService.error(`[Queue] "${taskName}" failed: ${err.message}`);
      throw err;
    } finally {
      this.activeProcessingCount = Math.max(0, this.activeProcessingCount - 1);
    }
  }

  public static getInstance(config?: WechatConfig): WechatService {
    if (!WechatService.instance && config) {
      WechatService.instance = new WechatService(config);
    } else if (WechatService.instance && config) {
      WechatService.instance.config = config;
      WechatService.instance.accessToken = null;
      WechatService.instance.tokenExpiresAt = 0;
    }
    return WechatService.instance;
  }

  private getBaseUrl(): string {
    return this.config.baseUrl || 'https://api.weixin.qq.com';
  }

  public async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const { appId, appSecret } = this.config;
    if (!appId || !appSecret) {
      throw new Error('WeChat AppID or AppSecret is missing');
    }

    const url = `${this.getBaseUrl()}/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
    
    try {
      const response = await axios.get(url);
      const data = response.data;

      if (data.errcode) {
        throw new Error(`WeChat API error: ${data.errmsg} (${data.errcode})`);
      }

      this.accessToken = data.access_token;
      this.tokenExpiresAt = now + (data.expires_in - 300) * 1000;
      
      return this.accessToken!;
    } catch (error: any) {
      LogService.error(`Failed to fetch WeChat access token: ${error.message}`);
      throw error;
    }
  }

  /**
   * 上传图片到微信素材库 (获取 media_id, 用于封面或 newspic)
   */
  public async uploadResource(
    imagePath: string, 
    baseDir?: string, 
    retries: number = 3,
    preProcessed?: ProcessedImageData
  ): Promise<{ media_id: string; url: string }> {
    return this.uploadToWechat(imagePath, 'material', baseDir, retries, preProcessed);
  }

  /**
   * 上传图片到微信 CDN (仅获取 URL, 用于正文)
   */
  public async uploadImageToCdn(
    imagePath: string, 
    baseDir?: string, 
    retries: number = 3,
    preProcessed?: ProcessedImageData
  ): Promise<{ url: string }> {
    const result = await this.uploadToWechat(imagePath, 'body', baseDir, retries, preProcessed);
    return { url: result.url };
  }

  /**
   * 预处理图片：获取资源、转换格式、压缩大小
   */
  private async getProcessedImage(
    imagePath: string, 
    baseDir?: string,
    uploadType: 'body' | 'material' = 'body'
  ): Promise<ProcessedImageData> {
    let fileBuffer: Buffer;
    let filename: string;
    let contentType: string;

    // 1. 获取原始资源
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      const response = await axios.get(imagePath, { responseType: 'arraybuffer', timeout: 60000 });
      fileBuffer = Buffer.from(response.data);
      const urlPath = imagePath.split('?')[0];
      filename = path.basename(urlPath) || 'image.jpg';
      if (!path.extname(filename)) filename += '.jpg';
      contentType = response.headers['content-type'] || 'image/jpeg';
    } else if (imagePath.startsWith('data:')) {
      const matches = imagePath.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) throw new Error('Invalid data URL format');
      contentType = matches[1];
      fileBuffer = Buffer.from(matches[2], 'base64');
      const extension = contentType.split('/')[1] || 'jpg';
      filename = `base64_upload_${Date.now()}.${extension}`;
    } else {
      const resolvedPath = path.isAbsolute(imagePath)
        ? imagePath
        : path.resolve(baseDir || process.cwd(), imagePath);

      if (!fs.existsSync(resolvedPath)) throw new Error(`Image not found: ${resolvedPath}`);

      fileBuffer = fs.readFileSync(resolvedPath);
      filename = path.basename(resolvedPath);
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      };
      contentType = mimeTypes[ext] || 'image/jpeg';
    }

    // 2. 格式探测和转换 (受并发队列保护)
    try {
      const originalSize = fileBuffer.length;
      const result = await WechatService.runInQueue<ProcessedImageData>(`ProcessImg:${filename}`, async () => {
        const metadata = await sharp(fileBuffer).metadata();
        const detectedType = metadata.format;
        let processedBuffer = fileBuffer;
        let processedFilename = filename;
        let processedContentType = contentType;
        
        if (detectedType === 'avif' || detectedType === 'heif' || (uploadType === 'body' && detectedType === 'webp')) {
           LogService.info(`[Sharp] Converting ${detectedType} to jpeg: ${filename}`);
           processedBuffer = await sharp(fileBuffer).jpeg({ quality: 85 }).toBuffer();
           processedFilename = filename.replace(/\.(avif|heif|webp)$/i, '.jpg');
           if (!processedFilename.toLowerCase().endsWith('.jpg')) processedFilename += '.jpg';
           processedContentType = 'image/jpeg';
        }
        
        if (processedBuffer.length > 2 * 1024 * 1024 && detectedType !== 'gif') {
           LogService.info(`[Sharp] Compressing large image (${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB): ${filename}`);
           processedBuffer = await sharp(processedBuffer).jpeg({ quality: 80 }).toBuffer();
           processedContentType = 'image/jpeg';
        }

        return { buffer: processedBuffer, filename: processedFilename, contentType: processedContentType };
      });

      fileBuffer = result.buffer;
      filename = result.filename;
      contentType = result.contentType;

      if (fileBuffer.length !== originalSize) {
        LogService.info(`[Sharp] Done: ${filename}. Size: ${(originalSize / 1024).toFixed(1)}KB -> ${(fileBuffer.length / 1024).toFixed(1)}KB`);
      }
    } catch (err) {
      LogService.warn(`Sharp process failed for ${filename}, using original. Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { buffer: fileBuffer, filename, contentType };
  }

  /**
   * 内部统一上传逻辑
   */
  private async uploadToWechat(
    imagePath: string, 
    uploadType: 'body' | 'material',
    baseDir?: string, 
    retries: number = 3,
    preProcessed?: ProcessedImageData
  ): Promise<{ media_id: string; url: string }> {
    const { buffer: fileBuffer, filename, contentType } = preProcessed || await this.getProcessedImage(imagePath, baseDir, uploadType);

    // 3. 进入重试循环进行上传
    let lastError: any;
    for (let i = 0; i <= retries; i++) {
      try {
        if (i > 0) {
          LogService.info(`Retrying WeChat ${uploadType} upload (${i}/${retries}) for: ${imagePath}`);
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, i - 1) * 1000));
        }

        const accessToken = await this.getAccessToken();


        const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
        const header = `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="media"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`;
        const footer = `\r\n--${boundary}--\r\n`;

        const body = Buffer.concat([
          Buffer.from(header, 'utf-8'),
          fileBuffer,
          Buffer.from(footer, 'utf-8'),
        ]);

        const uploadUrl = uploadType === 'body' 
          ? `${this.getBaseUrl()}/cgi-bin/media/uploadimg?access_token=${accessToken}`
          : `${this.getBaseUrl()}/cgi-bin/material/add_material?access_token=${accessToken}&type=image`;

        const response = await axios.post(uploadUrl, body, {
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          timeout: 90000
        });

        const data = response.data;
        if (data.errcode) throw new Error(`WeChat Upload error: ${data.errmsg} (${data.errcode})`);

        if (data.url?.startsWith('http://')) {
          data.url = data.url.replace(/^http:\/\//i, 'https://');
        }

        return {
          media_id: data.media_id || '',
          url: data.url || ''
        };
      } catch (error: any) {
        lastError = error;
        LogService.warn(`Attempt ${i + 1} failed for WeChat upload: ${error.message}`);
        if (error.message.includes('Image not found')) throw error;
      }
    }

    throw lastError;
  }

  public async processHtmlImages(
    html: string, 
    baseDir?: string, 
    fallbackLogoUrl?: string,
    articleType: 'news' | 'newspic' = 'news'
  ): Promise<{ html: string; firstMediaId: string; allMediaIds: string[] }> {
    const imgRegex = /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    const imgMatches = [...html.matchAll(imgRegex)];
    
    let firstMediaId = '';
    let updatedHtml = html;
    const allMediaIds: string[] = [];
    const uploadedMap = new Map<string, { url: string; media_id: string }>();

    for (const match of imgMatches) {
      const [fullTag, src] = match;
      if (!src) continue;

      if (src.includes('mmbiz.qpic.cn')) continue;

      try {
        let resp = uploadedMap.get(src);
        if (!resp) {
          // 预处理图片：下载并进行格式转换/压缩
          const preProcessed = await this.getProcessedImage(src, baseDir);
          
          // 上传到 CDN (用于 HTML 内容)
          const cdnResp = await this.uploadImageToCdn(src, baseDir, 3, preProcessed);
          
          let mediaId = '';
          // 如果是封面图或 newspic 模式，需要上传到素材库获取 media_id
          if (articleType === 'newspic' || !firstMediaId) {
            const materialResp = await this.uploadResource(src, baseDir, 3, preProcessed);
            mediaId = materialResp.media_id;
            if (!firstMediaId) firstMediaId = mediaId;
          }
          resp = { url: cdnResp.url, media_id: mediaId };
          uploadedMap.set(src, resp);
        }

        const newTag = fullTag.replace(/(?:src|data-src)=["']([^"']+)["']/, `src="${resp.url}"`);
        updatedHtml = updatedHtml.replace(fullTag, newTag);
        if (resp.media_id) allMediaIds.push(resp.media_id);
      } catch (err: any) {
        LogService.error(`Failed to upload ${src} to WeChat: ${err.message}`);
        const escapedTag = fullTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const removalRegex = new RegExp(`(?:\\s*<br\\s*/?>)*\\s*${escapedTag}(?:\\s*<br\\s*/?>)*`, 'gi');
        updatedHtml = updatedHtml.replace(removalRegex, '');
      }
    }

    // 视频转 GIF - 在图文模式下忽略并移除视频资源
    const videoBlockRegex = /<video[^>]*>([\s\S]*?)<\/video>|<video[^>]*\/>/gi;
    const videoMatches = [...updatedHtml.matchAll(videoBlockRegex)];

    if (articleType === 'newspic') {
      // 图文模式直接移除视频标签
      for (const match of videoMatches) {
        updatedHtml = updatedHtml.replace(match[0], '');
      }
    } else {
      // 普通模式尝试转为 GIF
      for (const match of videoMatches) {
        const fullBlock = match[0];
        const srcMatch = fullBlock.match(/(?:src|data-src)=["']([^"']+)["']/i) || 
                         fullBlock.match(/<source[^>]+src=["']([^"']+)["']/i);
        
        if (!srcMatch) continue;
        const src = srcMatch[1];
        if (src.includes('mmbiz.qpic.cn') || src.startsWith('blob:')) continue;

        try {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-video-'));
          const hash = crypto.createHash('md5').update(src).digest('hex');
          const videoPath = path.join(tempDir, `input_${hash}`);
          const gifPath = path.join(tempDir, `output_${hash}.gif`);

          LogService.info(`[Video] Downloading video for GIF conversion: ${src}`);
          const response = await axios.get(src, { responseType: 'arraybuffer', timeout: 60000 });
          fs.writeFileSync(videoPath, Buffer.from(response.data));

          await WechatService.runInQueue(`Video2Gif:${hash.substring(0, 8)}`, async () => {
            LogService.info(`[Video] Starting FFmpeg conversion (limit threads: ${FFMPEG_THREADS})`);
            await new Promise((resolve, reject) => {
              ffmpeg(videoPath)
                .inputOptions(['-t', '5']) // 严格限制输入只读前 5 秒，防止大文件缓冲区溢出
                .setStartTime(0)
                .outputOptions([
                  '-threads', FFMPEG_THREADS, 
                  '-vf', 'fps=8,scale=400:-1:flags=fast_bilinear,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=1', 
                  '-frames:v', '40',
                  '-f', 'gif'
                ])
                .on('end', resolve)
                .on('error', (err) => {
                  LogService.error(`[Video] FFmpeg error: ${err.message}`);
                  reject(err);
                })
                .save(gifPath);
            });
          });

          const resp = await this.uploadResource(gifPath, undefined);
          updatedHtml = updatedHtml.replace(fullBlock, `<img src="${resp.url}" style="width: 100%;" />`);
          if (resp.media_id) allMediaIds.push(resp.media_id);

          fs.rmSync(tempDir, { recursive: true, force: true });
          LogService.info(`[Video] Successfully converted video to GIF and uploaded.`);
        } catch (err: any) {
          LogService.error(`Failed to process video ${src} to GIF: ${err.message}`);
          const escapedBlock = fullBlock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const removalRegex = new RegExp(`(?:\\s*<br\\s*/?>)*\\s*${escapedBlock}(?:\\s*<br\\s*/?>)*`, 'gi');
          updatedHtml = updatedHtml.replace(removalRegex, '');
        }
      }
    }

    if (!firstMediaId && fallbackLogoUrl) {
      try {
        const resp = await this.uploadResource(fallbackLogoUrl, baseDir);
        firstMediaId = resp.media_id;
      } catch (err: any) {
        LogService.error(`Failed to upload fallback logo: ${err.message}`);
      }
    }

    return { html: updatedHtml, firstMediaId, allMediaIds };
  }

  public async publishToDraft(options: PublishOptions, retries: number = 3): Promise<{ media_id: string }> {
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      try {
        const accessToken = await this.getAccessToken();
        const url = `${this.getBaseUrl()}/cgi-bin/draft/add?access_token=${accessToken}`;

        if (i > 0) {
          LogService.info(`Retrying WeChat publish (${i}/${retries}) for: ${options.title}`);
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, i - 1) * 1000));
        }

        if (!options.thumbMediaId && options.articleType !== 'newspic') {
          throw new Error('thumbMediaId is required for news articles');
        }

        let article: any;
        if (options.articleType === 'newspic') {
          // 如果是图文消息模式，强制将封面图作为正文首图，并合并其他图片
          let finalImageMediaIds: string[] = [];
          if (options.thumbMediaId) {
            finalImageMediaIds.push(options.thumbMediaId);
          }
          if (options.imageMediaIds && options.imageMediaIds.length > 0) {
            // 合并并去重，保持封面图在第一位
            const otherIds = options.imageMediaIds.filter(id => id !== options.thumbMediaId);
            finalImageMediaIds.push(...otherIds);
          }

          if (finalImageMediaIds.length === 0) {
            throw new Error('newspic requires at least one image in image_info.image_list');
          }
          
          // newspic 的 content 使用传入的原始内容 (Markdown)，清理 Markdown 语法为纯文本
          let description = (options.content || '').trim();
          
          // 1. 移除 Markdown 语法和视频链接
          description = description
            .replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片
            .replace(/<video[^>]*>([\s\S]*?)<\/video>|<video[^>]*\/>/gi, '') // 移除 HTML 视频标签
            .replace(/https?:\/\/[^\s)]+\.(?:mp4|mov|wmv|flv|avi)(?:[?#][^\s)]*)?/gi, '') // 移除纯视频链接
            .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)') // 链接: [文字](URL) -> 文字 (URL)
            .replace(/^#+\s+/gm, '') // 移除标题符号
            .replace(/\*\*(.*?)\*\*/g, '$1') // 移除加粗
            .replace(/__(.*?)__/g, '$1') // 移除加粗 (下划线)
            .replace(/\*(.*?)\*/g, '$1') // 移除斜体
            .replace(/~~(.*?)~~/g, '$1') // 移除删除线
            .replace(/`{1,3}.*?`{1,3}/gs, (match) => match.replace(/`/g, '')) // 移除代码块符号
            .replace(/^\s*[-*+]\s+/gm, '• ') // 转换无序列表符号
            .replace(/^\s*>\s+/gm, '') // 移除引用符号
            .replace(/^---|^===\s*$/gm, ''); // 移除分割线

          // 2. 如果依然包含 HTML，则做最基础的换行保留清洗
          if (description.includes('<')) {
             description = description
               .replace(/<(br|p|div|section|li)[^>]*>/gi, '\n')
               .replace(/<\/(p|div|section|li)>/gi, '\n')
               .replace(/<[^>]+>/g, '')
               .replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&');
          }
          
          description = description.replace(/\n{3,}/g, '\n\n').trim().substring(0, 1000);

          article = {
            article_type: 'newspic',
            title: options.title,
            content: description,
            need_open_comment: 1,
            only_fans_can_comment: 0,
            image_info: {
              image_list: finalImageMediaIds.map(id => ({ image_media_id: id })),
            },
          };
        } else {
          article = {
            title: options.title,
            content: options.content,
            thumb_media_id: options.thumbMediaId,
            need_open_comment: 1,
            only_fans_can_comment: 0,
          };
          if (options.digest) article.digest = options.digest;
        }
        if (options.author) article.author = options.author;

        const response = await axios.post(url, { articles: [article] });
        if (response.data.errcode) throw new Error(`WeChat Publish error: ${response.data.errmsg} (${response.data.errcode})`);

        LogService.info(`Successfully published to WeChat draft. media_id: ${response.data.media_id}`);
        return response.data;
      } catch (error: any) {
        lastError = error;
        LogService.warn(`Attempt ${i + 1} failed for WeChat publish: ${error.message}`);
        if (error.message.includes('thumbMediaId is required')) throw error;
      }
    }

    throw lastError;
  }
}
