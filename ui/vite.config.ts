// vite.config.js
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/views/',
    build: {
        outDir: resolve(__dirname, '../src/static/oidc'),
        rolldownOptions: {
            input: {
                main: resolve(__dirname, 'consent.html'),
                nested: resolve(__dirname, 'login.html'),
            },
        },
        emptyOutDir: true,
    },
  server:{
      proxy:{
        '/static':{
            target: 'http://localhost:9001',
            changeOrigin: true,
            secure: false,
        },
        '/views/manifest.json':{
            target: 'http://localhost:9001',
            changeOrigin: true,
            secure: false,
          rewrite: (path) => path.replace(/^\/views/, ''),
        },
        '/locales.json':{
            target: 'http://localhost:9001',
            changeOrigin: true,
            secure: false,
          rewrite: (path) => path.replace(/^\/views/, ''),
        },
        '/locales':{
            target: 'http://localhost:9001',
            changeOrigin: true,
            secure: false,
          rewrite: (path) => path.replace(/^\/views/, ''),
        },
      }
  }
})
