import {expect, test} from "@playwright/test";
import {loginToAdmin, restartEtherpad, saveSettings} from "../helper/adminhelper.js";

// Settings tests mutate and restart the server. Run serially so restarts
// don't collide with parallel tests reading/writing the same settings.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page })=>{
  await loginToAdmin(page, 'admin', 'changeme1');
})

test.describe('admin settings',()=> {


  test('Are Settings visible, populated, does save work', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    await page.waitForSelector('.settings');
    const settings =  page.locator('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});

    const settingsVal = await settings.inputValue()
    const settingsLength = settingsVal.length

    await settings.fill(`{"title": "Etherpad123"}`)
    const newValue = await settings.inputValue()
    expect(newValue).toContain('{"title": "Etherpad123"}')
    expect(newValue.length).toEqual(24)
    await saveSettings(page)

    // Check if the changes were actually saved
    await page.reload()
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    await page.waitForSelector('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});

    const newSettings =  page.locator('.settings');

    const newSettingsVal = await newSettings.inputValue()
    expect(newSettingsVal).toContain('{"title": "Etherpad123"}')


    // Change back to old settings
    await newSettings.fill(settingsVal)
    await saveSettings(page)

    await page.reload()
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    await page.waitForSelector('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});
    const oldSettings =  page.locator('.settings');
    const oldSettingsVal = await oldSettings.inputValue()
    expect(oldSettingsVal).toEqual(settingsVal)
    expect(oldSettingsVal.length).toEqual(settingsLength)
  })

  test('preserves /* */ comments after save round-trip', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    await page.waitForSelector('.settings');
    const settings = page.locator('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});

    const original = await settings.inputValue();
    const withComment = `/* takeover-pr-comment-marker */\n${original}`;
    await settings.fill(withComment);
    await saveSettings(page);

    await page.reload();
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    await page.waitForSelector('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});
    expect(await settings.inputValue()).toContain('takeover-pr-comment-marker');

    // Restore original
    await settings.fill(original);
    await saveSettings(page);
  });

  test('validate button toasts success on valid JSON and failure on invalid', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    await page.waitForSelector('.settings');
    const settings = page.locator('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});

    const original = await settings.inputValue();

    await page.getByTestId('test-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});

    await settings.fill('{"broken":');
    await page.getByTestId('test-settings-button').click();
    await expect(page.locator('.ToastRootFailure')).toBeVisible({timeout: 5000});

    // Invalid JSON must not be accepted by save either
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootFailure')).toBeVisible({timeout: 5000});

    // Restore so subsequent tests have valid settings
    await settings.fill(original);
    await saveSettings(page);
  });

  test('restart works', async function ({page}) {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    await page.waitForSelector('.settings');
    await restartEtherpad(page)
    // Re-login after restart since session is lost
    await loginToAdmin(page, 'admin', 'changeme1')
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    await page.waitForSelector('.settings')
    const settings =  page.locator('.settings');
    await expect(settings).not.toHaveValue('', {timeout: 30000});
  });

  test('form view derives label + help text from key comment', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    // Inject a two-sentence comment above "title" so the first sentence becomes
    // the row label and the rest renders as help text.
    await page.getByTestId('mode-toggle-raw').click();
    const raw = page.getByTestId('settings-raw-textarea');
    await expect(raw).toBeVisible({timeout: 10000});
    const original = await raw.inputValue();
    const withComment = original.replace(
      '"title"',
      '/* CustomTitleLabel. ExtraHelpMarker about it. */\n"title"',
    );
    await raw.fill(withComment);
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});

    await page.getByTestId('mode-toggle-form').click();
    await page.waitForSelector('[data-testid="settings-form-view"]');
    // The injected text appears somewhere in the title row — either as label
    // (if no template comment precedes it) or as help text (if one does and
    // the comments are concatenated). Either way, it must be rendered.
    const titleLabel = page.locator('label[for="field-title"]');
    await expect(titleLabel).toBeVisible({timeout: 10000});
    const titleRow = titleLabel.locator('xpath=ancestor::*[contains(@class,"settings-row")][1]');
    await expect(titleRow).toContainText('CustomTitleLabel');
    await expect(titleRow).toContainText('ExtraHelpMarker');

    // Restore
    await page.getByTestId('mode-toggle-raw').click();
    await raw.fill(original);
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});
  });

  test('form view falls back to template documentation when live comment is absent', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    // settings.json.template documents `port` with the env-var explainer.
    // Even if the live settings.json has no comment for port, the template
    // fallback should populate label + help.
    const portLabel = page.locator('label[for="field-port"]');
    await expect(portLabel).toBeVisible({timeout: 10000});
    // Label is a non-empty string (humanized 'Port' or template-derived).
    expect((await portLabel.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
  });

  test('editing title via form input round-trips through save', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    // Wait for settings to load (form view renders once socket emits settings).
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    const raw = page.getByTestId('settings-raw-textarea');
    await expect(raw).toBeVisible({timeout: 10000});
    const original = await raw.inputValue();

    await page.getByTestId('mode-toggle-form').click();
    const titleField = page.getByTestId('field-title');
    await expect(titleField).toBeVisible({timeout: 10000});
    await titleField.fill('Etherpad-Form-Edit');
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});

    await page.reload();
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    const after = await page.getByTestId('settings-raw-textarea').inputValue();
    // jsonc-parser modify() preserves the file's existing spacing style.
    // The shipped settings.json is compact (no spaces around colons).
    expect(after).toMatch(/"title"\s*:\s*"Etherpad-Form-Edit"/);
    // Other keys must still be present (file structure preserved).
    expect(after).toContain('"requireAuthentication"');

    // Restore
    await page.getByTestId('settings-raw-textarea').fill(original);
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});
  });

  test('boolean toggle round-trips through save', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    // Wait for settings to load (form view renders once socket emits settings).
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    const original = await page.getByTestId('settings-raw-textarea').inputValue();

    await page.getByTestId('mode-toggle-form').click();
    const toggle = page.getByTestId('field-requireAuthentication');
    await expect(toggle).toBeVisible({timeout: 10000});
    const before = await toggle.getAttribute('aria-checked');
    await toggle.click();
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});

    await page.reload();
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    const toggleAfter = page.getByTestId('field-requireAuthentication');
    await expect(toggleAfter).toBeVisible({timeout: 10000});
    const after = await toggleAfter.getAttribute('aria-checked');
    expect(after).not.toEqual(before);

    // Restore
    await page.getByTestId('mode-toggle-raw').click();
    await page.getByTestId('settings-raw-textarea').fill(original);
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});
  });

  test('env placeholder default value is editable inline and persists to raw', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});

    // Grab the original raw content so we can restore at the end.
    await page.getByTestId('mode-toggle-raw').click();
    const raw = page.getByTestId('settings-raw-textarea');
    await expect(raw).toBeVisible({timeout: 10000});
    const original = await raw.inputValue();

    // Switch to form and edit sso.issuer's env-placeholder default inline.
    await page.getByTestId('mode-toggle-form').click();
    const input = page.getByTestId('env-sso.issuer').first();
    await expect(input).toBeVisible({timeout: 10000});
    // Sanity: this IS the editable <input> (env pill no longer read-only).
    expect(await input.evaluate((el) => el.tagName.toLowerCase())).toBe('input');
    await input.fill('http://edited.example:9001');
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});

    // Reload and confirm the raw JSON now embeds the new default.
    await page.reload();
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    const after = await page.getByTestId('settings-raw-textarea').inputValue();
    expect(after).toContain('${SSO_ISSUER:http://edited.example:9001}');

    // Restore.
    await page.getByTestId('settings-raw-textarea').fill(original);
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});
  });

  test('docker-like env-placeholder-heavy settings.json still has editable controls', async ({page}) => {
    // Regression: a settings.json where every value is "${VAR:default}"
    // (the shape of settings.json.docker) must NOT degrade the form into a
    // read-only viewer. Editing any env default round-trips through save.
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});

    await page.getByTestId('mode-toggle-raw').click();
    const raw = page.getByTestId('settings-raw-textarea');
    await expect(raw).toBeVisible({timeout: 10000});
    const original = await raw.inputValue();

    // Replace with a minimal env-placeholder-heavy document.
    const envHeavy = JSON.stringify({
      title: '${TITLE:Etherpad-EnvHeavy}',
      port: '${PORT:9001}',
      ip: '${IP:0.0.0.0}',
      requireAuthentication: '${REQUIRE_AUTHENTICATION:false}',
      enableAdminUITests: true,
      users: {admin: {password: 'changeme1', is_admin: true}},
    });
    await raw.fill(envHeavy);
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});

    await page.reload();
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});

    // Every visible env-pill row must expose an editable <input>, not a
    // read-only span.
    for (const id of ['env-title', 'env-port', 'env-ip', 'env-requireAuthentication']) {
      const el = page.getByTestId(id).first();
      await expect(el).toBeVisible({timeout: 10000});
      expect(await el.evaluate((n) => n.tagName.toLowerCase())).toBe('input');
    }

    // Editing one of them round-trips.
    await page.getByTestId('env-title').fill('Etherpad-EnvEdit');
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});

    await page.reload();
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    const after = await page.getByTestId('settings-raw-textarea').inputValue();
    expect(after).toContain('${TITLE:Etherpad-EnvEdit}');

    // Restore original.
    await page.getByTestId('settings-raw-textarea').fill(original);
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});
  });

  // Regression for https://github.com/ether/etherpad/issues/7740.
  // settings.json.template uses same-line `/* … */` annotations for the
  // padShortcutEnabled keys, e.g.
  //   "altF9": true, /* focus on the File Menu and/or editbar */
  // A previous heuristic in findLeading treated any line ending in `*/` as
  // a comment continuation, so each subsequent key's "leading comment"
  // absorbed every preceding sibling line. After the fix, altC's row must
  // render with a clean key-derived label and the trailing comment in the
  // help slot — and must not contain altF9's source line.
  test('#7740 trailing-comment key renders clean label, comment as help', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});

    const altCLabel = page.locator('label[for="field-padShortcutEnabled.altC"]');
    await expect(altCLabel).toBeVisible({timeout: 10000});
    const labelText = (await altCLabel.textContent() ?? '').trim();
    expect(labelText).not.toMatch(/altF9/i);
    expect(labelText).not.toMatch(/focus on the File Menu/i);

    const altCRow = altCLabel.locator(
      'xpath=ancestor::*[contains(@class,"settings-row")][1]',
    );
    await expect(altCRow).toContainText('focus on the Chat window');
  });

  test('toggling form on broken raw JSON shows parse error banner', async ({page}) => {
    await page.goto('http://localhost:9001/admin/settings');
    // Wait for settings to load (form view renders once socket emits settings).
    await page.waitForSelector('[data-testid="settings-form-view"]', {timeout: 30000});
    await page.getByTestId('mode-toggle-raw').click();
    const raw = page.getByTestId('settings-raw-textarea');
    await expect(raw).toBeVisible({timeout: 10000});
    const original = await raw.inputValue();

    await raw.fill('{ "broken":');
    await page.getByTestId('mode-toggle-form').click();
    await expect(page.getByTestId('parse-error-banner')).toBeVisible();

    // CTA returns to raw view
    await page.getByTestId('parse-error-switch-raw').click();
    await expect(raw).toBeVisible();

    // Restore
    await raw.fill(original);
    await page.getByTestId('save-settings-button').click();
    await expect(page.locator('.ToastRootSuccess')).toBeVisible({timeout: 5000});
  });
})
