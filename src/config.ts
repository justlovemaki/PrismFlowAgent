import { SystemSettings } from './types/config.js';

export const defaultSettings: SystemSettings = {
  ACTIVE_AI_PROVIDER_ID: 'default-gemini',
  AI_PROVIDERS: [
    {
      id: 'default-gemini',
      name: 'Google Gemini',
      type: 'GEMINI',
      apiUrl: 'https://generativelanguage.googleapis.com',
      apiKey: '',
      models: ['gemini-3-flash-preview'],
      enabled: true,
      useProxy: false
    },
    {
      id: 'default-claude',
      name: 'Anthropic Claude',
      type: 'CLAUDE',
      apiUrl: 'https://api.anthropic.com',
      apiKey: '',
      models: ['claude-opus-4-6'],
      enabled: true,
      useProxy: false
    },
    {
      id: 'default-openai',
      name: 'OpenAI',
      type: 'OPENAI',
      apiUrl: 'https://api.openai.com',
      apiKey: '',
      models: ['gpt-5.3'],
      enabled: true,
      useProxy: false
    },
    {
      id: 'default-ollama',
      name: 'Ollama',
      type: 'OLLAMA',
      apiUrl: 'http://localhost:11434',
      apiKey: '',
      models: ['llama3'],
      enabled: true,
      useProxy: false
    }
  ],

  PUBLISHERS: [
    {
      id: 'github',
      enabled: false,
      config: {
        token: '',
        repo: '',
        branch: 'main'
      }
    },
    {
      id: 'wechat',
      enabled: false,
      config: {
        appId: '',
        appSecret: '',
        title: '',
        author: ''
      }
    }
  ],

  STORAGES: [
    {
      id: 'github',
      enabled: false,
      config: {
        token: '',
        repo:  '',
        branch: 'main',
        pathPrefix: 'images'
      }
    },
    {
      id: 'r2',
      enabled: false,
      config: {
        accountId: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: '',
        publicUrlPrefix: ''
      }
    }
  ],

  SYSTEM_PASSWORD: '',
  AUTH_EXPIRE_TIME: '7d',
  
  API_PROXY: '',
  IMAGE_PROXY: '',

  IMAGE_PROCESS_CONFIG: {
    CONVERT_IMAGES: true,
    AVIF_QUALITY: 70,
    AVIF_EFFORT: 5,
    CONVERT_VIDEOS: true,
    VIDEO_CRF: 28,
    VIDEO_PRESET: 'slow',
    MAX_VIDEO_SIZE_MB: 25,
    TYPEID_PREFIX: 'news'
  },

  ADAPTERS: [
    {
      id: 'github-trending',
      name: 'GitHub Trending',
      category: 'githubTrending',
      adapterType: 'GitHubTrendingAdapter',
      enabled: true,
      apiUrl: 'https://git-trending.justlikemaki.vip/topone/?since=',
      items: [
        { id: 'daily', name: '每日热门', category: 'githubTrending', since: 'daily', enabled: true, useProxy: false },
        { id: 'weekly', name: '每周热门', category: 'githubTrending', since: 'weekly', enabled: false, useProxy: false }
      ]
    },
    {
      id: 'follow-api',
      name: 'Follow API (Folo)',
      adapterType: 'FollowApiAdapter',
      enabled: true,
      apiUrl: 'https://api.follow.is/entries',
      fetchDays: 3,
      foloCookie: '',
      items: [
        { id: 'papers', name: '学术论文', category: 'paper', listId: '158437917409783808', fetchPages: 1, enabled: true, useProxy: false },
        { id: 'reddit', name: 'Reddit', category: 'socialMedia', listId: '167576006499975168', fetchPages: 1, enabled: true, useProxy: false },
      ]
    }
  ],
  CLOSED_PLUGINS: [],

  CATEGORIES: [
    { id: 'news', label: '新闻资讯', icon: 'newspaper' },
    { id: 'githubTrending', label: 'GitHub 热门', icon: 'code' },
    { id: 'paper', label: '学术论文', icon: 'school' },
    { id: 'socialMedia', label: '社交媒体', icon: 'forum' }
  ]
};

