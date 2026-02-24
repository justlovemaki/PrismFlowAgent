/**
 * 复制文本到剪贴板，支持 navigator.clipboard 缺失时的回退方案
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  // 尝试使用现代 Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Modern clipboard API failed, falling back...', err);
    }
  }

  // 回退到 execCommand('copy')
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // 避免页面滚动
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    return successful;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
};
