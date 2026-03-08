import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 加载父目录的 .env 文件
  const env = loadEnv(mode, '../', '')
  const backendPort = env.PORT || '3456'
  const backendUrl = `http://localhost:${backendPort}`
  const versionFilePath = path.resolve(__dirname, '../version')
  const appVersion = fs.readFileSync(versionFilePath, 'utf-8').trim()

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: {
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/writeData': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/genAIContent': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/commitToGitHub': {
          target: backendUrl,
          changeOrigin: true,
        },
      }
    }
  }
})
