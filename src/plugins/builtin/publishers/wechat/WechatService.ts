import axios from 'axios';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import os from 'os';
import crypto from 'crypto';
import { LogService } from '../../../../services/LogService.js';

export interface WechatConfig {
  appId: string;
  appSecret: string;
  title?: string;
  author?: string;
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

export class WechatService {
  private static instance: WechatService;
  private config: WechatConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  private constructor(config: WechatConfig) {
    this.config = config;
  }

  public static getInstance(config?: WechatConfig): WechatService {
    if (!WechatService.instance && config) {
      WechatService.instance = new WechatService(config);
    }
    return WechatService.instance;
  }

  /**
   * 获取 Access Token
   */
  public async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const { appId, appSecret } = this.config;
    if (!appId || !appSecret) {
      throw new Error('WeChat AppID or AppSecret is missing');
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
    
    try {
      const response = await axios.get(url);
      const data = response.data;

      if (data.errcode) {
        throw new Error(`WeChat API error: ${data.errmsg} (${data.errcode})`);
      }

      this.accessToken = data.access_token;
      // 提前 5 分钟过期
      this.tokenExpiresAt = now + (data.expires_in - 300) * 1000;
      
      return this.accessToken!;
    } catch (error: any) {
      LogService.error(`Failed to fetch WeChat access token: ${error.message}`);
      throw error;
    }
  }

  /**
   * 上传图片到微信素材库
   */
  public async uploadResource(imagePath: string, baseDir?: string): Promise<{ media_id: string; url: string }> {
    const accessToken = await this.getAccessToken();
    let fileBuffer: Buffer;
    let filename: string;
    let contentType: string;

    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      const response = await axios.get(imagePath, { responseType: 'arraybuffer' });
      fileBuffer = Buffer.from(response.data);
      const urlPath = imagePath.split('?')[0];
      filename = path.basename(urlPath) || 'image.jpg';
      contentType = response.headers['content-type'] || 'image/jpeg';
    } else {
      const resolvedPath = path.isAbsolute(imagePath)
        ? imagePath
        : path.resolve(baseDir || process.cwd(), imagePath);

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Image not found: ${resolvedPath}`);
      }

      fileBuffer = fs.readFileSync(resolvedPath);
      filename = path.basename(resolvedPath);
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      contentType = mimeTypes[ext] || 'image/jpeg';
    }

    // 处理不支持的格式 (如 AVIF)，转换为 JPEG
    if (contentType === 'image/avif' || filename.toLowerCase().endsWith('.avif')) {
      LogService.info(`Converting AVIF to JPEG for WeChat: ${filename}`);
      try {
        fileBuffer = await sharp(fileBuffer).jpeg({ quality: 90 }).toBuffer();
        filename = filename.replace(/\.avif$/i, '.jpg');
        contentType = 'image/jpeg';
      } catch (err: any) {
        LogService.warn(`Failed to convert AVIF to JPEG: ${err.message}. Trying to upload as-is.`);
      }
    }

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

    const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=image`;

    try {
      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
      });

      const data = response.data;
      if (data.errcode) {
        throw new Error(`WeChat Upload error: ${data.errmsg} (${data.errcode})`);
      }

      LogService.info(`Successfully uploaded image to WeChat: ${filename}. media_id: ${data.media_id}`);

      if (data.url?.startsWith('http://')) {
        data.url = data.url.replace(/^http:\/\//i, 'https://');
      }

      return data;
    } catch (error: any) {
      LogService.error(`Failed to upload image to WeChat: ${error.message}`);
      throw error;
    }
  }

  /**
   * 处理 HTML 中的图片和视频，上传到微信并替换 URL
   */
  public async processHtmlImages(html: string, baseDir?: string, fallbackLogoUrl?: string): Promise<{ html: string; firstMediaId: string; allMediaIds: string[] }> {
    // 1. 处理图片 (支持 src 和 data-src)
    const imgRegex = /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    const imgMatches = [...html.matchAll(imgRegex)];
    
    let firstMediaId = '';
    let updatedHtml = html;
    const allMediaIds: string[] = [];

    for (const match of imgMatches) {
      const [fullTag, src] = match;
      if (!src) continue;

      // 如果已经是微信的域名，跳过
      if (src.includes('mmbiz.qpic.cn')) {
        LogService.info(`Image already on WeChat: ${src}`);
        continue;
      }

      LogService.info(`Uploading image to WeChat: ${src}`);
      try {
        const resp = await this.uploadResource(src, baseDir);
        // 替换 src 或 data-src 为微信 URL
        const newTag = fullTag.replace(/(?:src|data-src)=["']([^"']+)["']/, `src="${resp.url}"`);
        updatedHtml = updatedHtml.replace(fullTag, newTag);
        allMediaIds.push(resp.media_id);
        if (!firstMediaId) {
          firstMediaId = resp.media_id;
        }
      } catch (err: any) {
        LogService.error(`Failed to upload ${src} to WeChat: ${err.message}`);
        // 失败时移除标签及相邻的 br 换行符
        const escapedTag = fullTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const removalRegex = new RegExp(`(?:\\s*<br\\s*/?>)*\\s*${escapedTag}(?:\\s*<br\\s*/?>)*`, 'gi');
        updatedHtml = updatedHtml.replace(removalRegex, '');
      }
    }

    // 2. 处理视频 - 截取 90 帧作为 GIF 上传
    const videoBlockRegex = /<video[^>]*>([\s\S]*?)<\/video>|<video[^>]*\/>/gi;
    const videoMatches = [...updatedHtml.matchAll(videoBlockRegex)];

    for (const match of videoMatches) {
      const fullBlock = match[0];
      const srcMatch = fullBlock.match(/(?:src|data-src)=["']([^"']+)["']/i) || 
                       fullBlock.match(/<source[^>]+src=["']([^"']+)["']/i);
      
      if (!srcMatch) continue;
      const src = srcMatch[1];

      if (src.includes('mmbiz.qpic.cn') || src.startsWith('blob:')) continue;

      LogService.info(`Processing video to GIF: ${src}`);
      let tempDir = '';
      try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-video-'));
        const hash = crypto.createHash('md5').update(src).digest('hex');
        const videoPath = path.join(tempDir, `input_${hash}`);
        const gifPath = path.join(tempDir, `output_${hash}.gif`);

        // 下载视频
        const response = await axios.get(src, { responseType: 'arraybuffer', timeout: 30000 });
        fs.writeFileSync(videoPath, Buffer.from(response.data));

        // 截取 90 帧并转换为 GIF (fps=10, 采样前 9 秒)
        await new Promise((resolve, reject) => {
          ffmpeg(videoPath)
            .setStartTime(0)
            .outputOptions([
              '-vf', 'fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
              '-frames:v', '60'
            ])
            .on('end', resolve)
            .on('error', reject)
            .save(gifPath);
        });

        // 上传 GIF 到微信
        LogService.info(`Uploading generated GIF to WeChat for video: ${src}`);
        const resp = await this.uploadResource(gifPath, undefined);
        
        // 替换 video 标签为 img 标签
        const newTag = `<img src="${resp.url}" style="width: 100%;" />`;
        updatedHtml = updatedHtml.replace(fullBlock, newTag);
        
        allMediaIds.push(resp.media_id);
      } catch (err: any) {
        LogService.error(`Failed to process video ${src} to GIF: ${err.message}`);
        // 失败时移除标签及相邻的 br 换行符，以避免发布错误和多余空行
        const escapedBlock = fullBlock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const removalRegex = new RegExp(`(?:\\s*<br\\s*/?>)*\\s*${escapedBlock}(?:\\s*<br\\s*/?>)*`, 'gi');
        updatedHtml = updatedHtml.replace(removalRegex, '');
      } finally {
        if (tempDir && fs.existsSync(tempDir)) {
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch (e) {}
        }
      }
    }

    // 如果没有找到任何图片作为封面，且提供了备用 logo，则上传 logo
    if (!firstMediaId && fallbackLogoUrl) {
      LogService.info(`No images found in content, uploading fallback logo: ${fallbackLogoUrl}`);
      try {
        const resp = await this.uploadResource(fallbackLogoUrl, baseDir);
        firstMediaId = resp.media_id;
      } catch (err: any) {
        LogService.error(`Failed to upload fallback logo: ${err.message}`);
      }
    }

    if (!firstMediaId) {
      LogService.warn('No media_id found for WeChat cover image.');
    }

    return { html: updatedHtml, firstMediaId, allMediaIds };
  }

  /**
   * 发布到草稿箱
   */
  public async publishToDraft(options: PublishOptions): Promise<{ media_id: string }> {
    const accessToken = await this.getAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`;

    LogService.info(`Publishing to WeChat draft: ${options.title}`);

    if (!options.thumbMediaId && options.articleType !== 'newspic') {
      throw new Error('WeChat Publish error: thumbMediaId is required but not found. Please ensure your content has at least one image or a valid fallback.');
    }

    let article: any;
    if (options.articleType === 'newspic') {
      article = {
        article_type: 'newspic',
        title: options.title,
        content: options.content,
        need_open_comment: 1,
        only_fans_can_comment: 0,
        image_info: {
          image_list: options.imageMediaIds!.map(id => ({ image_media_id: id })),
        },
      };
      if (options.author) article.author = options.author;
    } else {
      article = {
        title: options.title,
        content: options.content,
        thumb_media_id: options.thumbMediaId,
        need_open_comment: 1,
        only_fans_can_comment: 0,
      };
      if (options.author) article.author = options.author;
      if (options.digest) article.digest = options.digest;
    }

    try {
      const response = await axios.post(url, {
        articles: [article],
      });

      const data = response.data;
      if (data.errcode) {
        throw new Error(`WeChat Publish error: ${data.errmsg} (${data.errcode})`);
      }

      LogService.info(`Successfully published to WeChat draft. media_id: ${data.media_id}`);
      return data;
    } catch (error: any) {
      LogService.error(`Failed to publish to WeChat draft: ${error.message}`);
      throw error;
    }
  }
}


