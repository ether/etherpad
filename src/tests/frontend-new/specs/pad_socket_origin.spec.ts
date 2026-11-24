import {expect, test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {getPadBody, goToNewPad, goToPad} from '../helper/padHelper';

// The pad socket uses the cookies the browser attaches
// to its handshake, so it has to know that the page that opened it is an
// Etherpad page. Etherpad's own pages (also embedded, also behind a reverse
// proxy that rewrites Host) must keep working; a page on a sibling subdomain
// must not get the visitor's author.

const etherpad = 'http://localhost:9001';
const etherpadPort = Number(new URL(etherpad).port);

// pad/www/sibling.example.test are same-site with each other; embedder.other.test
// is another site. All map to loopback, so Chromium's local network access
// checks do not get in the way. The rules do not affect localhost. Chromium
// takes the mapping as a command line flag, Firefox as a pref; each browser
// ignores the other's.
const testHosts =
    ['pad.example.test', 'sibling.example.test', 'www.example.test', 'embedder.other.test'];
test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: [`--host-resolver-rules=${testHosts.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`],
    firefoxUserPrefs: {'network.dns.localDomains': testHosts.join(',')},
  },
});

let pages: http.Server; // Embedding page and sibling page, on other origins.
let pagesPort: number;
let tlsPages: https.Server; // The same pages over https.
let tlsPagesPort: number;
let tls: {key: Buffer, cert: Buffer};
let proxy: https.Server; // TLS reverse proxy that rewrites Host.
let proxyPort: number;

const proxyHeaders = (headers: http.IncomingHttpHeaders) => {
  // nginx `proxy_set_header Host $proxy_host;` and nothing else: Etherpad
  // sees its upstream address as Host, no X-Forwarded-*, no trustProxy.
  const out: http.OutgoingHttpHeaders = {...headers, host: `127.0.0.1:${etherpadPort}`};
  return out;
};

const selfSignedCert = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-proxy-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=pad.example.test', '-keyout', path.join(dir, 'key.pem'),
      '-out', path.join(dir, 'cert.pem')], {stdio: 'ignore'});
    return {
      key: fs.readFileSync(path.join(dir, 'key.pem')),
      cert: fs.readFileSync(path.join(dir, 'cert.pem')),
    };
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
};

const startProxy = async () => {
  const server = https.createServer(tls, (req, res) => {
    const upstream = http.request({
      host: '127.0.0.1', port: etherpadPort, method: req.method, path: req.url,
      headers: proxyHeaders(req.headers),
    }, (ures) => {
      res.writeHead(ures.statusCode!, ures.headers);
      ures.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    const upstream = http.request({
      host: '127.0.0.1', port: etherpadPort, method: req.method, path: req.url,
      headers: proxyHeaders(req.headers),
    });
    upstream.on('upgrade', (ures, usocket, uhead) => {
      const lines = [`HTTP/1.1 ${ures.statusCode} ${ures.statusMessage}`];
      for (let i = 0; i < ures.rawHeaders.length; i += 2) {
        lines.push(`${ures.rawHeaders[i]}: ${ures.rawHeaders[i + 1]}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (uhead.length) socket.write(uhead);
      if (head.length) usocket.write(head);
      usocket.pipe(socket).pipe(usocket);
      usocket.on('error', () => socket.destroy());
      socket.on('error', () => usocket.destroy());
    });
    upstream.on('error', () => socket.destroy());
    upstream.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

// What the test pages point at. The page servers run in this process, so each
// test sets these before it loads a page instead of passing them in the URL.
let pagePad = '';
let pageBase = etherpad;
const showPage = (pad: string, base: string) => { pagePad = pad; pageBase = base; };

test.beforeAll(async () => {
  tls = selfSignedCert();
  const servePage = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url!, 'http://x');
    const pad = pagePad;
    const padBase = pageBase;
    res.setHeader('Content-Type', 'text/html');
    if (url.pathname === '/embed') {
      res.end(`<!doctype html><title>embedder</title>
        <iframe id="embed" width="900" height="600"
            src="${padBase}/p/${encodeURIComponent(pad)}"></iframe>`);
    } else if (url.pathname === '/sibling') {
      res.end(`<!doctype html><title>sibling</title>
        <script src="${padBase}/socket.io/socket.io.js"></script>
        <script>
          const s = io(${JSON.stringify(`${padBase}/`)}, {
            transports: ['websocket'], query: {padId: ${JSON.stringify(pad)}},
          });
          s.on('connect', () => s.emit('message',
              {component: 'pad', type: 'CLIENT_READY', padId: ${JSON.stringify(pad)}}));
          s.on('message', (m) => { if (m.type === 'CLIENT_VARS') window.result = m.data.userId; });
          s.on('connect_error', (e) => { window.result = 'error:' + e.message; });
        </script>`);
    } else {
      res.statusCode = 404;
      res.end();
    }
  };
  pages = http.createServer(servePage);
  await new Promise<void>((resolve) => pages.listen(0, '127.0.0.1', resolve));
  pagesPort = (pages.address() as AddressInfo).port;
  tlsPages = https.createServer(tls, servePage);
  await new Promise<void>((resolve) => tlsPages.listen(0, '127.0.0.1', resolve));
  tlsPagesPort = (tlsPages.address() as AddressInfo).port;
  proxy = await startProxy();
  proxyPort = (proxy.address() as AddressInfo).port;
});

test.afterAll(async () => {
  for (const server of [proxy, pages, tlsPages]) server.closeAllConnections();
  await Promise.all([proxy, pages, tlsPages].map(
      (server) => new Promise((resolve) => server.close(resolve))));
});

// Keep the "save your pad deletion token" modal from eating clicks and keys,
// in every frame (see padHelper.goToNewPad).
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    let stored: unknown;
    Object.defineProperty(window, 'clientVars', {
      configurable: true,
      get() { return stored; },
      set(v) {
        if (v != null && typeof v === 'object') {
          (v as {padDeletionToken?: string | null}).padDeletionToken = null;
        }
        stored = v;
      },
    });
  });
});

const userId = (frame: {evaluate: Function}) =>
  frame.evaluate(() => (window as any).clientVars?.userId);

const embeddedPad = (page: any, padId: string) => {
  const padFrame = () => page.frames().find(
      (f: any) => new URL(f.url()).pathname === `/p/${padId}`);
  const inner = page.frameLocator('#embed')
      .frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]')
      .locator('#innerdocbody');
  return {padFrame, inner};
};

test('the pad page sends a socket token and keeps its author across reloads', async ({page}) => {
  const tokenResponse = page.waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith('/pad-socket-token'));
  const padId = await goToNewPad(page);
  expect((await tokenResponse).status()).toBe(200);
  const before = await userId(page);
  expect(before).toMatch(/^a\./);
  await goToPad(page, padId);
  expect(await userId(page)).toBe(before);
});

test('behind a Host-rewriting TLS proxy the pad keeps its author and edits',
    async ({page, browser}) => {
      const padId = `FRONTEND_TESTS${randomUUID()}`;
      const padUrl = `https://pad.example.test:${proxyPort}/p/${padId}`;
      await page.goto(padUrl);
      await expect.poll(() => userId(page), {timeout: 20000}).toMatch(/^a\./);
      const before = await userId(page);
      await page.waitForSelector('#editorcontainer.initialized');
      await (await getPadBody(page)).click();
      await page.keyboard.insertText('typed behind a proxy');

      // The edit reaches the server: another browser context sees it.
      const ctx = await browser.newContext();
      const other = await ctx.newPage();
      await goToPad(other, padId);
      await expect(await getPadBody(other))
          .toContainText('typed behind a proxy', {timeout: 20000});
      await ctx.close();

      await page.goto(padUrl);
      await expect.poll(() => userId(page), {timeout: 20000}).toBe(before);
    });

// The two embed tests are tagged @feature:cross-origin-embed for plugins that
// forbid framing on other origins (see doc/PLUGIN_FEATURE_DISABLES.md). Their
// proxy, page servers and direct pad loads are also used by the untagged
// tests, so in the honesty pass a tagged failure comes from the framing.
test('a pad embedded on another origin of the same site keeps the visitor\'s author',
    {tag: '@feature:cross-origin-embed'}, async ({page}) => {
      const padId = `FRONTEND_TESTS${randomUUID()}`;
      const padBase = `https://pad.example.test:${proxyPort}`;
      await page.goto(`${padBase}/p/${padId}`);
      await expect.poll(() => userId(page), {timeout: 20000}).toMatch(/^a\./);
      const visitor = await userId(page);
      // https on both sides: http and https are different sites.
      showPage(padId, padBase);
      await page.goto(`https://www.example.test:${tlsPagesPort}/embed`);
      const {padFrame, inner} = embeddedPad(page, padId);
      await expect(inner).toBeVisible({timeout: 20000});
      await expect.poll(async () => await userId(padFrame()), {timeout: 20000}).toBe(visitor);
    });

test('a pad embedded in a cross-site iframe works', {
  tag: '@feature:cross-origin-embed',
}, async ({page, browser}) => {
  const padId = `FRONTEND_TESTS${randomUUID()}`;
  const padBase = `https://pad.example.test:${proxyPort}`;
  showPage(padId, padBase);
  await page.goto(`https://embedder.other.test:${tlsPagesPort}/embed`);
  const {padFrame, inner} = embeddedPad(page, padId);
  await expect(inner).toBeVisible({timeout: 20000});
  await expect.poll(async () => await userId(padFrame()), {timeout: 20000}).toMatch(/^a\./);
  await inner.click();
  await page.keyboard.insertText('typed in a cross-site embed');

  // The edit reaches the server: another browser context sees it.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await goToPad(other, padId);
  await expect((await getPadBody(other)))
      .toContainText('typed in a cross-site embed', {timeout: 20000});
  await ctx.close();
});

test('a sibling subdomain gets an anonymous author, not the visitor\'s', async ({page}) => {
  const padId = `FRONTEND_TESTS${randomUUID()}`;
  const padBase = `http://pad.example.test:${etherpadPort}`;
  await page.goto(`${padBase}/p/${padId}`);
  await expect.poll(() => userId(page), {timeout: 20000}).toMatch(/^a\./);
  const visitor = await userId(page);

  const sibling = await page.context().newPage();
  showPage(padId, padBase);
  await sibling.goto(`http://sibling.example.test:${pagesPort}/sibling`);
  await expect.poll(() => sibling.evaluate(() => (window as any).result), {timeout: 20000})
      .toBeTruthy();
  const got = await sibling.evaluate(() => (window as any).result);
  expect(got).toMatch(/^a\./);
  expect(got).not.toBe(visitor);

  // The visitor's own pad page still has its author.
  await page.reload();
  await expect.poll(() => userId(page), {timeout: 20000}).toBe(visitor);
});
