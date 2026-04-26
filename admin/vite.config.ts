import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesSrcDir = path.resolve(__dirname, '../src/locales');

// Copies core translation JSON files into <outDir>/locales/ at build time and
// serves them at /admin/locales/<lang>.json during `vite dev`. The admin SPA's
// i18n loader fetches `${BASE_URL}/locales/<lang>.json`; if the files are
// missing the express handler falls back to index.html and i18next renders raw
// keys (regression behind https://github.com/ether/etherpad/issues/7586). We
// inline this rather than use vite-plugin-static-copy because that plugin
// preserves the `../src/locales` parent path under dest, putting the files at
// `locales/src/locales/*.json` instead of `locales/*.json`.
const adminLocales = (): Plugin => ({
  name: 'etherpad-admin-locales',
  apply: 'build',
  closeBundle() {
    const destDir = path.resolve(__dirname, '../src/templates/admin/locales');
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    let count = 0;
    for (const entry of fs.readdirSync(localesSrcDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      fs.copyFileSync(
          path.join(localesSrcDir, entry.name),
          path.join(destDir, entry.name));
      count++;
    }
    this.info(`copied ${count} core locale files to ${path.relative(process.cwd(), destDir)}`);
  },
});

const adminLocalesDev = (): Plugin => ({
  name: 'etherpad-admin-locales-dev',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/admin/locales', (req, res, next) => {
      if (!req.url) return next();
      const filename = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      if (!/^[A-Za-z0-9_-]+\.json$/.test(filename)) return next();
      const filepath = path.join(localesSrcDir, filename);
      if (!filepath.startsWith(localesSrcDir + path.sep)) return next();
      if (!fs.existsSync(filepath)) return next();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      fs.createReadStream(filepath).pipe(res);
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    adminLocales(),
    adminLocalesDev(),
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
  base: '/admin',
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
