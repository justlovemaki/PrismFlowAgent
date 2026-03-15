import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import DOMPurify from 'dompurify';
import { proxyHtmlImages, proxyImageUrl } from '../../utils/imageUtils';

interface ContentRendererProps {
  content: string;
  imageProxy?: string;
  className?: string;
}

const ContentRenderer: React.FC<ContentRendererProps> = memo(({ content, imageProxy, className = "" }) => {
  if (!content) return null;

  // 启发式检测：如果是以 < 开头，或者包含明显的 HTML 结构
  const trimmedContent = content.trim();
  const startsWithTag = trimmedContent.startsWith('<');
  // 检查是否包含常见的 HTML 标签，如 <div>, <p>, <section>, <a> 等
  const hasCommonTags = /<(div|p|section|a|span|h[1-6]|ul|ol|li|img|br|table|tr|td|blockquote|pre|code|video|source|iframe|header|footer|main|aside)[\s>]/i.test(content);
  
  // 优化 Markdown 检测：除了符号，检查常见的 Markdown 模式
  const hasMarkdownMarkers = (
    /[#*_\-`\[\]]/.test(content) || 
    /^\s*[-+*]\s+/m.test(content) || // 列表
    /^\s*\d+\.\s+/m.test(content) || // 有序列表
    /^#{1,6}\s+/m.test(content)      // 标题
  );

  // 如果是以 < 开头，或者包含常用标签且没什么 markdown 标志，或者包含大量 HTML 实体，则视为 HTML
  // 如果同时包含 HTML 标签和 Markdown 标记，且 Markdown 标记比较明显（如标题、列表），优先视为 Markdown
  const isHtml = startsWithTag || (hasCommonTags && !hasMarkdownMarkers);
  
  // 如果是 HTML，进行清理和代理图片处理
  if (isHtml) {
    const proxiedHtml = proxyHtmlImages(content, imageProxy);
    const sanitizedHtml = DOMPurify.sanitize(proxiedHtml, {
      ADD_TAGS: ['video', 'source'],
      ADD_ATTR: ['controls', 'autoplay', 'loop', 'muted', 'playsinline']
    });
    
    return (
      <div 
        className={`preview-html-content break-words ${className}`}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }} 
      />
    );
  }

  // 默认使用 Markdown 渲染，启用 HTML 支持
  return (
    <div className={`preview-markdown-content prose dark:prose-invert max-w-none break-words ${className}`}>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]} 
        rehypePlugins={[rehypeRaw]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          img: ({ node, ...props }) => (
            <img {...props} src={proxyImageUrl(props.src || '', imageProxy)} alt={props.alt || ''} />
          ),
          video: ({ node, ...props }) => (
            <video 
              {...props} 
              src={props.src ? proxyImageUrl(props.src, imageProxy) : undefined} 
              controls 
              className="max-w-full h-auto rounded-lg shadow-md my-4"
            />
          ),
          source: ({ node, ...props }) => (
            <source 
              {...props} 
              src={props.src ? proxyImageUrl(props.src, imageProxy) : undefined} 
            />
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default ContentRenderer;
