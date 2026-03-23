import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { parse as csvParse } from 'csv-parse/sync';
import { LogService } from '../LogService.js';

export interface ProcessedDocument {
  text: string;
  type: string;
  metadata: any;
}

export class DocumentProcessor {
  /**
   * 将文档文件解析为文本
   */
  async parse(fileName: string, buffer: Buffer): Promise<ProcessedDocument> {
    const ext = fileName.split('.').pop()?.toLowerCase();
    let text = '';
    let metadata: any = { fileName };

    try {
      if (ext === 'pdf') {
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        text = result.text;
        // 尝试获取基本信息
        try {
          const info = await parser.getInfo();
          metadata.info = info.info;
        } catch (e) {
          LogService.warn(`Failed to get PDF info: ${e}`);
        }
        await parser.destroy();
      } else if (ext === 'docx' || ext === 'doc') {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
        metadata.messages = result.messages;
      } else if (ext === 'csv') {
        const records: string[][] = csvParse(buffer, {
          skip_empty_lines: true,
          trim: true
        });
        text = records.map(row => row.join(' ')).join('\n');
      } else if (ext === 'xlsx' || ext === 'xls') {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetTexts: string[] = [];
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          if (csv) {
            sheetTexts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
          }
        });
        text = sheetTexts.join('\n\n');
      } else if (ext === 'md' || ext === 'txt' || ext === 'markdown') {
        text = buffer.toString('utf8');
      } else {
        throw new Error(`Unsupported file type: ${ext}`);
      }

      return {
        text: text.trim(),
        type: ext || 'unknown',
        metadata
      };
    } catch (error: any) {
      LogService.error(`Failed to parse document ${fileName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 将长文本切分为块
   */
  chunk(text: string, chunkSize: number = 3000, overlap: number = 400): string[] {
    const chunks: string[] = [];
    if (!text) return chunks;

    // 清理文本中的多余空白
    const cleanText = text.replace(/\n\s*\n/g, '\n\n').trim();

    let start = 0;
    while (start < cleanText.length) {
      const end = Math.min(start + chunkSize, cleanText.length);
      chunks.push(cleanText.slice(start, end));
      
      // 移动起始点，考虑重叠部分
      start += (chunkSize - overlap);
      
      if (start >= cleanText.length) break;
    }
    return chunks;
  }
}
