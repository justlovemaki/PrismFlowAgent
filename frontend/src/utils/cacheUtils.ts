/**
 * localStorage 缓存工具函数
 * 用于缓存页面数据，防止切换页面时数据丢失
 */

const CACHE_PREFIX = 'ai_insight_daily_';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24小时过期

interface CacheData<T> {
  data: T;
  timestamp: number;
  date: string; // 关联的日期
}

/**
 * 获取完整的缓存键名（包含日期）
 */
function getFullKey(key: string, date: string): string {
  return `${CACHE_PREFIX}${key}_${date}`;
}

/**
 * 保存数据到 localStorage
 */
export function saveToCache<T>(key: string, data: T, date: string): void {
  try {
    const cacheData: CacheData<T> = {
      data,
      timestamp: Date.now(),
      date
    };
    localStorage.setItem(getFullKey(key, date), JSON.stringify(cacheData));
  } catch (error: any) {
    if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      console.warn('localStorage 空间不足，正在尝试清空旧缓存...');
      clearAllCache();
      // 尝试再次保存
      try {
        const cacheData: CacheData<T> = {
          data,
          timestamp: Date.now(),
          date
        };
        localStorage.setItem(getFullKey(key, date), JSON.stringify(cacheData));
      } catch (retryError) {
        console.error('重试保存缓存失败:', retryError);
      }
    } else {
      console.error('保存缓存失败:', error);
    }
  }
}

/**
 * 从 localStorage 读取数据
 */
export function loadFromCache<T>(key: string, date: string): T | null {
  try {
    const fullKey = getFullKey(key, date);
    const cached = localStorage.getItem(fullKey);
    if (!cached) return null;

    const cacheData: CacheData<T> = JSON.parse(cached);
    
    // 检查日期是否匹配
    if (cacheData.date !== date) {
      return null;
    }

    // 检查是否过期
    const now = Date.now();
    if (now - cacheData.timestamp > CACHE_EXPIRY) {
      localStorage.removeItem(fullKey);
      return null;
    }

    return cacheData.data;
  } catch (error) {
    console.error('读取缓存失败:', error);
    return null;
  }
}

/**
 * 清除指定缓存
 */
export function clearCache(key: string, date?: string): void {
  try {
    if (date) {
      localStorage.removeItem(getFullKey(key, date));
    } else {
      // 如果未指定日期，清除该 key 下所有日期的缓存
      const keys = Object.keys(localStorage);
      keys.forEach(k => {
        if (k.startsWith(`${CACHE_PREFIX}${key}`)) {
          localStorage.removeItem(k);
        }
      });
    }
  } catch (error) {
    console.error('清除缓存失败:', error);
  }
}

/**
 * 清除所有缓存
 */
export function clearAllCache(): void {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error('清除所有缓存失败:', error);
  }
}

/**
 * 清除过期缓存
 */
export function clearExpiredCache(): void {
  try {
    const keys = Object.keys(localStorage);
    const now = Date.now();
    
    keys.forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const cacheData = JSON.parse(cached);
            if (now - cacheData.timestamp > CACHE_EXPIRY) {
              localStorage.removeItem(key);
            }
          }
        } catch (e) {
          // 如果解析失败，删除该缓存
          localStorage.removeItem(key);
        }
      }
    });
  } catch (error) {
    console.error('清除过期缓存失败:', error);
  }
}

// 缓存键名常量
export const CACHE_KEYS = {
  SELECTION_ITEMS: 'selection_items',
  GENERATION_RESULT: 'generation_result',
  GENERATION_SELECTED_IDS: 'generation_selected_ids',
  GENERATION_SELECTED_ITEMS: 'generation_selected_items',
  THEME: 'theme'
};

/**
 * 保存配置到 localStorage（不需要日期和过期时间）
 */
export function saveConfig<T>(key: string, value: T): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch (error) {
    console.error('保存配置失败:', error);
  }
}

/**
 * 从 localStorage 读取配置
 */
export function loadConfig<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key);
    if (!cached) return null;
    return JSON.parse(cached) as T;
  } catch (error) {
    console.error('读取配置失败:', error);
    return null;
  }
}
