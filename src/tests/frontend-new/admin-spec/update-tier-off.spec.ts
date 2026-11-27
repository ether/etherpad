import {expect, Page, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

// Issue #8573: with updates.tier "off" the server does not register
// /admin/update/status. The admin UI learns the tier from the /settings
// socket (flags.updatesTier) and must not request the status route; it shows
// a notice explaining the setting instead. The CI server runs the default
// "notify" tier, so the tier is rewritten to "off" on the socket. The same
// is done for the help payload's versionCheck (privacy.updateCheck).

const NS = '/settings';
const PREFIX = `42${NS},`;

const parseFrame = (msg: string | Buffer) => {
  if (typeof msg !== 'string' || !msg.startsWith(PREFIX)) return null;
  const m = /^(\d*)(\[[\s\S]*)$/.exec(msg.slice(PREFIX.length));
  if (!m) return null;
  return {ack: m[1], payload: JSON.parse(m[2]) as unknown[]};
};

const forceUpdatesOff = async (page: Page) => {
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((msg) => server.send(msg));
    server.onMessage((msg) => {
      const frame = parseFrame(msg);
      // Sent on connect; the UI acts on whichever tier arrives first.
      if (frame && frame.payload[0] === 'updatesTier') {
        frame.payload[1] = 'off';
        ws.send(`${PREFIX}${frame.ack}${JSON.stringify(frame.payload)}`);
        return;
      }
      if (frame && frame.payload[0] === 'settings') {
        const data = frame.payload[1] as {flags?: Record<string, unknown>};
        data.flags = {...(data.flags ?? {}), updatesTier: 'off'};
        ws.send(`${PREFIX}${frame.ack}${JSON.stringify(frame.payload)}`);
        return;
      }
      if (frame && frame.payload[0] === 'reply:help') {
        const data = frame.payload[1] as Record<string, unknown>;
        data.versionCheck = false;
        delete data.latestVersion;
        ws.send(`${PREFIX}${frame.ack}${JSON.stringify(frame.payload)}`);
        return;
      }
      ws.send(msg);
    });
  });
};

const recordStatusRequests = (page: Page) => {
  const hits: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.endsWith('/admin/update/status')) hits.push(req.url());
  });
  return hits;
};

const expectNotice = async (page: Page) => {
  const notice = page.getByTestId('updates-off-notice').first();
  await expect(notice).toBeVisible({timeout: 30000});
  await expect(notice).toContainText('Update checks are disabled (updates.tier = "off").');
  await expect(notice).toContainText('you may not hear about security updates');
  await expect(notice.locator('code', {hasText: 'updates.tier'})).toBeVisible();
  await expect(notice.locator('code', {hasText: 'UPDATES_TIER'})).toBeVisible();
  const docs = notice.getByRole('link', {name: 'Read the update documentation'});
  await expect(docs).toHaveAttribute('href', 'https://docs.etherpad.org/admin/updates.html');
  return notice;
};

test.describe('admin UI with updates.tier "off"', () => {
  let statusHits: string[];

  test.beforeEach(async ({page}) => {
    await forceUpdatesOff(page);
    statusHits = recordStatusRequests(page);
    await loginToAdmin(page, 'admin', 'changeme1');
  });

  test('banner explains the setting and never requests /admin/update/status', async ({page}) => {
    await page.goto('http://localhost:9001/admin/');
    await expectNotice(page);
    if (process.env.UPDATES_OFF_SCREENSHOT) {
      await page.screenshot({path: process.env.UPDATES_OFF_SCREENSHOT, fullPage: false});
    }
    // Give a late fetch time to show up before asserting there was none.
    await page.waitForTimeout(1000);
    expect(statusHits).toEqual([]);
  });

  test('banner can be dismissed for the session', async ({page}) => {
    await page.goto('http://localhost:9001/admin/');
    const notice = await expectNotice(page);
    await notice.getByRole('button', {name: 'Dismiss'}).click();
    await expect(page.getByTestId('updates-off-notice')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('link', {name: /etherpad updates/i})).toBeVisible({timeout: 30000});
    await expect(page.getByTestId('updates-off-notice')).toHaveCount(0);
  });

  test('update page shows the notice and never requests /admin/update/status', async ({page}) => {
    await page.goto('http://localhost:9001/admin/update');
    await expect(page.getByRole('heading', {name: /etherpad updates/i})).toBeVisible({timeout: 30000});
    await expectNotice(page);
    // Only the page's own notice, not the banner's copy as well.
    await expect(page.getByTestId('updates-off-notice')).toHaveCount(1);
    await expect(page.getByTestId('updates-off-notice').getByRole('button', {name: 'Dismiss'}))
        .toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(statusHits).toEqual([]);
  });

  test('help page says the latest-version check is off', async ({page}) => {
    await page.goto('http://localhost:9001/admin/help');
    const off = page.getByTestId('version-check-off');
    await expect(off).toBeVisible({timeout: 30000});
    await expect(off).toContainText('Latest-version check is off');
    await expect(off.locator('code')).toHaveText('privacy.updateCheck');
    await expect(page.getByText(/update available: undefined/i)).toHaveCount(0);
  });

  test('docs link survives the reverse-proxy "/admin" rewrite', async ({request}) => {
    // Behind a proxy the server rewrites every "/admin" in the bundle to
    // "<proxy>/admin". The docs URL must not contain that literal.
    const headers = {'x-proxy-path': '/sub'};
    const html = await (await request.get('http://localhost:9001/admin/', {headers})).text();
    const src = /src="\/sub(\/admin\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
    expect(src, 'admin bundle script tag').toBeTruthy();
    const js = await (await request.get(`http://localhost:9001${src}`, {headers})).text();
    expect(js).toContain('admin/updates.html');
    expect(js).not.toContain('docs.etherpad.org/sub');
  });
});
