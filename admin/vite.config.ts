import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Inline `settings.json.template` at config time so the bundle has the
// per-key documentation without expanding the dev server's filesystem
// allowlist (which would otherwise serve every file in the repo root,
// including settings.json and credentials.json, to anything that can
// reach the dev server).
const settingsTemplate = readFileSync(
  resolve(__dirname, '..', 'settings.json.template'),
  'utf8',
)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
  base: '/admin',
  define: {
    __SETTINGS_TEMPLATE__: JSON.stringify(settingsTemplate),
  },
  build: {
    outDir: '../src/templates/admin',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/socket.io/*': {
        target: 'http://localhost:9001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/admin-auth/': {
        target: 'http://localhost:9001',
        changeOrigin: true,
      },
    },
  },
})
