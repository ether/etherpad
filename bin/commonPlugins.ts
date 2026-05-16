import {PackageData} from "ep_etherpad-lite/node/types/PackageInfo";
import {writeFileSync} from "fs";
import {installedPluginsPath} from "ep_etherpad-lite/static/js/pluginfw/installer";
const pluginsModule = require('ep_etherpad-lite/static/js/pluginfw/plugins');

// Pure helper used by `pnpm run plugins update` to whittle the contents of
// var/installed_plugins.json down to names safe to re-install. Mirrors the
// gate inside pluginfw/plugins.getPackages: only entries that start with the
// plugin prefix (ep_) are real Etherpad plugins; ep_etherpad-lite is the
// vendored core, never installed via the plugin path. De-duplicates so a
// corrupted manifest with repeated entries triggers one install per name.
// Exported and kept side-effect-free so backend tests can exercise it.
export const filterUpdatablePluginNames = (
  entries: ReadonlyArray<{name?: unknown} | null | undefined>,
  prefix: string = pluginsModule.prefix as string,
): string[] => {
  const names = entries
    .map((e) => (e == null ? undefined : e.name))
    .filter(
      (n): n is string =>
        typeof n === 'string' && n.startsWith(prefix) && n !== 'ep_etherpad-lite',
    );
  return Array.from(new Set(names));
};

export const persistInstalledPlugins = async () => {
  const plugins:PackageData[] = []
  const installedPlugins = {plugins: plugins};
  for (const pkg of Object.values(await pluginsModule.getPackages()) as PackageData[]) {
    installedPlugins.plugins.push({
      name: pkg.name,
      version: pkg.version,
    });
  }
  installedPlugins.plugins = [...new Set(installedPlugins.plugins)];
  writeFileSync(installedPluginsPath, JSON.stringify(installedPlugins));
};
