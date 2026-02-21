import fs from 'fs-extra';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import mime from 'mime-types';
import { IStorageProvider } from '../../../../types/plugin.js';
import { LogService } from '../../../../services/LogService.js';
import { StorageMetadata } from '../../../../registries/StorageRegistry.js';

export interface R2StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrlPrefix: string;
}

export class R2Storage implements IStorageProvider {
  static metadata: StorageMetadata = {
    id: 'r2',
    name: 'Cloudflare R2',
    description: '使用 Cloudflare R2 对象存储托管媒体资源',
    icon: 'cloud_done',
    configFields: [
      { key: 'accountId', label: 'Account ID', type: 'text', required: true },
      { key: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true },
      { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
      { key: 'bucketName', label: 'Bucket Name', type: 'text', required: true },
      { key: 'publicUrlPrefix', label: 'Public URL Prefix', type: 'text', required: true }
    ]
  };

  id = 'r2';
  name = 'Cloudflare R2';
  description = R2Storage.metadata.description;
  icon = R2Storage.metadata.icon;

  configFields = R2Storage.metadata.configFields;

  private client: S3Client;
  private config: R2StorageConfig;

  constructor(config: R2StorageConfig) {
    this.config = config;
    this.client = new S3Client({
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      region: "auto",
    });
  }

  async upload(localFilePath: string, targetFilename: string): Promise<string | null> {
    try {
      const fileContent = await fs.readFile(localFilePath);
      const contentType = mime.lookup(localFilePath) || 'application/octet-stream';
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const objectKey = `images/${year}/${month}/${targetFilename}`;

      LogService.info(`[R2 Storage] Uploading ${targetFilename} to ${this.config.bucketName}...`);

      const command = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: objectKey,
        Body: fileContent,
        ContentType: contentType,
      });

      await this.client.send(command);
      
      const publicUrl = `${this.config.publicUrlPrefix.replace(/\/$/, '')}/${objectKey}`;
      return publicUrl;
    } catch (error: any) {
      LogService.error(`[R2 Storage] Upload failed: ${error.message}`);
      return null;
    }
  }
}


