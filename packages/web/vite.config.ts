import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@retro-vault/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    proxy: {
      '/games': 'http://localhost:3000',
      '/roms': 'http://localhost:3000',
      '/users': 'http://localhost:3000',
      '/meta': 'http://localhost:3000',
      '/import': 'http://localhost:3000',
      '/scrape': 'http://localhost:3000',
      '/media': 'http://localhost:3000',
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})
