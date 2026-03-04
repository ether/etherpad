'use strict';

import {linkInstaller, checkForMigration} from "ep_etherpad-lite/static/js/pluginfw/installer";
import {persistInstalledPlugins} from "./commonPlugins";
import fs from "node:fs";
const settings = require('ep_etherpad-lite/node/utils/Settings');

if (process.argv.length === 2) {
  console.error('Expected at least one argument!');
  process.exit(1);
}

let args = process.argv.slice(2)


const possibleActions = [
  "i",
  "install",
  "rm",
  "remove",
  "ls",
  "list"
]

const install = ()=> {
  const argsAsString: string = args.join(" ");
  const regexRegistryPlugins = /(?<=(?:i|install)\s)(.*?)(?=--github|--path|$)/;
  const regexLocalPlugins = /(?<=--path\s)(.*?)(?=--github|$)/;
  const regexGithubPlugins = /(?<=--github\s)(.*?)(?=--path|$)/;
  const registryPlugins = argsAsString.match(regexRegistryPlugins)?.[0]?.split(" ")?.filter(s => s) || [];
  const localPlugins = argsAsString.match(regexLocalPlugins)?.[0]?.split(" ")?.filter(s => s) || [];
  const githubPlugins = argsAsString.match(regexGithubPlugins)?.[0]?.split(" ")?.filter(s => s) || [];

  async function run() {
    for (const plugin of registryPlugins) {
      if (possibleActions.includes(plugin)){
        continue
      }
      console.log(`Installing plugin from registry: ${plugin}`)
      if (plugin.includes('@')) {
        const [name, version] = plugin.split('@');
        await linkInstaller.installPlugin(name, version);
        continue;
      }
      await linkInstaller.installPlugin(plugin);
    }

    for (const plugin of localPlugins) {
      console.log(`Installing plugin from path: ${plugin}`);
      await linkInstaller.installFromPath(plugin);
    }

    for (const plugin of githubPlugins) {
      console.log(`Installing plugin from github: ${plugin}`);
      await linkInstaller.installFromGitHub(plugin);
    }
  }

  (async () => {
    await checkForMigration();
    await run();
    await persistInstalledPlugins();
  })();
}

const list = ()=>{
  const walk =  async () => {
    const plugins = fs.readFileSync(settings.root+"/var/installed_plugins.json", "utf-8")
    const pluginNames = JSON.parse(plugins).plugins.map((plugin: any) => plugin.name).join(", ")

    console.log("Installed plugins are:", pluginNames)
  }

  (async () => {
    await walk();
  })();
}

const remove = (plugins: string[])=>{
  const walk =  async () => {
    for (const plugin of plugins) {
      console.log(`Uninstalling plugin: ${plugin}`)
      await linkInstaller.uninstallPlugin(plugin);
    }
    await persistInstalledPlugins();
  }

  (async () => {
    await checkForMigration();
    await walk();
  })();
}

let action = args[0];

switch (action) {
  case "install":
    install();
    break;
  case "i":
    install();
    break;
  case "ls":
    list();
    break;
  case "list":
    list();
    break;
  case "rm":
    remove(args.slice(1));
    break;
  case "remove":
    remove(args.slice(1));
    break;
  default:
    console.error('Expected at least one argument!');
    process.exit(1);
}


