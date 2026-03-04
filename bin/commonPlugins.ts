import {PackageData} from "ep_etherpad-lite/node/types/PackageInfo";
import {writeFileSync} from "fs";
import {installedPluginsPath} from "ep_etherpad-lite/static/js/pluginfw/installer";
const pluginsModule = require('ep_etherpad-lite/static/js/pluginfw/plugins');

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
