import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.REVIEW_BASE ?? '/',
  plugins: [vue(), vueDevTools()],
  server: {
    proxy: {
      '/api/anomaly': {
        target: 'http://127.0.0.1:9000',
        rewrite: (path) => `/review${path}`,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
