import {expect, Page, test} from "@playwright/test";
import {loginToAdmin} from "../helper/adminhelper";

// The admin catalog labels plugins published by the Etherpad project as
// "Official" and everything else as "Third-party", and asks for confirmation
// before installing a third-party plugin. Which plugin is which is decided on
// the server (pluginTrust.ts, covered by the backend specs); this spec checks
// what the admin sees. The live feed changes daily, so the search results are
// replaced with a fixture on the socket, and `install` events are recorded and
// swallowed so nothing is ever actually installed.

const NS = '/pluginfw/installer';
const PREFIX = `42${NS},`;

const fixture = [
  {name: 'ep_fixture_official', description: 'Official fixture plugin',
    version: '1.0.0', time: '2026-11-01', official: true},
  {name: 'ep_fixture_community', description: 'Third-party fixture plugin',
    version: '2.0.0', time: '2026-11-02', official: false},
];

// Splits a socket.io event frame for the installer namespace into its
// optional ack id and its [event, ...args] payload.
const parseFrame = (msg: string | Buffer) => {
  if (typeof msg !== 'string' || !msg.startsWith(PREFIX)) return null;
  const m = /^(\d*)(\[.*)$/s.exec(msg.slice(PREFIX.length));
  if (!m) return null;
  return {ack: m[1], payload: JSON.parse(m[2]) as unknown[]};
};

const useFixtureCatalog = async (page: Page) => {
  const installs: string[] = [];
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((msg) => {
      const frame = parseFrame(msg);
      if (frame && frame.payload[0] === 'install') {
        installs.push(String(frame.payload[1]));
        return;
      }
      server.send(msg);
    });
    server.onMessage((msg) => {
      const frame = parseFrame(msg);
      if (frame && frame.payload[0] === 'results:search') {
        const data = frame.payload[1] as {results: unknown[]};
        data.results = fixture;
        ws.send(`${PREFIX}${frame.ack}${JSON.stringify(frame.payload)}`);
        return;
      }
      ws.send(msg);
    });
  });
  return installs;
};

test.describe('Plugin catalog: official and third-party plugins', () => {
  let installs: string[];

  test.beforeEach(async ({page}) => {
    installs = await useFixtureCatalog(page);
    await loginToAdmin(page, 'admin', 'changeme1');
    await page.goto('http://localhost:9001/admin/plugins');
    await page.waitForSelector('.pm-search-input');
    await expect(page.locator('table tbody tr')).toHaveCount(fixture.length, {timeout: 30000});
  });

  const row = (page: Page, name: string) =>
    page.locator('table tbody tr').filter({hasText: name});

  test('labels official and third-party plugins', async ({page}) => {
    await expect(row(page, 'ep_fixture_official').locator('.pm-tag--official'))
        .toHaveText('Official');
    await expect(row(page, 'ep_fixture_official').locator('.pm-tag--third-party'))
        .toHaveCount(0);
    await expect(row(page, 'ep_fixture_community').locator('.pm-tag--third-party'))
        .toHaveText('Third-party');
    await expect(row(page, 'ep_fixture_community').locator('.pm-tag--third-party'))
        .toHaveAttribute('title', 'Not maintained by the Etherpad project. Plugins run code on your server.');
  });

  test('installs an official plugin with one click', async ({page}) => {
    await row(page, 'ep_fixture_official').getByRole('button', {name: 'Install'}).click();
    await expect(page.getByTestId('third-party-confirm')).toHaveCount(0);
    await expect.poll(() => installs).toEqual(['ep_fixture_official']);
  });

  test('asks before installing a third-party plugin, and cancel installs nothing',
      async ({page}) => {
        await row(page, 'ep_fixture_community').getByRole('button', {name: 'Install'}).click();
        const dialog = page.getByTestId('third-party-confirm');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('heading')).toHaveText('Install a third-party plugin?');
        await expect(dialog).toContainText(
            'ep_fixture_community is not maintained by the Etherpad project');
        await expect(dialog).toContainText('Plugins run code on your server');
        await dialog.getByRole('button', {name: 'Cancel'}).click();
        await expect(dialog).toHaveCount(0);
        await expect(row(page, 'ep_fixture_community')).toHaveCount(1);
        expect(installs).toEqual([]);
      });

  test('Escape dismisses the confirmation without installing', async ({page}) => {
    await row(page, 'ep_fixture_community').getByRole('button', {name: 'Install'}).click();
    await expect(page.getByTestId('third-party-confirm')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('third-party-confirm')).toHaveCount(0);
    expect(installs).toEqual([]);
  });

  test('confirming installs the third-party plugin', async ({page}) => {
    await row(page, 'ep_fixture_community').getByRole('button', {name: 'Install'}).click();
    const dialog = page.getByTestId('third-party-confirm');
    await dialog.getByRole('button', {name: 'Install'}).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => installs).toEqual(['ep_fixture_community']);
  });
});
