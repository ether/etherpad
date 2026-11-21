import {IPluginInfo, PluginManager} from "live-plugin-manager";
import path from "path";
import {node_modules, pluginInstallPath} from "./installer";
import {
  accessSync, constants, lstatSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync,
} from "node:fs";
import {dependencies, name} from '../../../package.json'
import settings from '../../../node/utils/Settings';
import {readFileSync} from "fs";
import {isValidDependencyName, resolveDependencyPath} from "./dependencyPath";

// Core's own dependencies. Uninstalling a plugin must never unlink or delete
// these, whatever the dependency map says (#8532).
const coreDependencies = new Set(Object.keys(dependencies));

const isInside = (parent: string, child: string) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

export class LinkInstaller {
  private livePluginManager: PluginManager;
  private loadedPlugins: IPluginInfo[] = [];
  /*
  * A map of dependencies to their dependents
  *
  */
  private readonly dependenciesMap: Map<string, Set<string>>;

  constructor() {
    this.livePluginManager = new PluginManager({
      pluginsPath: pluginInstallPath,
      hostRequire: undefined,
      cwd: path.join(settings.root, 'src')
    });
    this.dependenciesMap = new Map();

  }


  public async init() {
    // Insert Etherpad lite dependencies
    for (let [dependency] of Object.entries(dependencies)) {
      if (this.dependenciesMap.has(dependency)) {
        this.dependenciesMap.get(dependency)?.add(name)
      } else {
        this.dependenciesMap.set(dependency, new Set([name]))
      }
    }
  }

  public async installFromPath(path: string) {
    const installedPlugin = await this.livePluginManager.installFromPath(path)
    this.linkDependency(installedPlugin.name)
    await this.checkLinkedDependencies(installedPlugin)
  }

  public async installFromGitHub(repository: string) {
    const installedPlugin = await this.livePluginManager.installFromGithub(repository)
    this.linkDependency(installedPlugin.name)
    await this.checkLinkedDependencies(installedPlugin)
  }

  public async installPlugin(pluginName: string, version?: string) {
    if (version) {
      const installedPlugin = await this.livePluginManager.install(pluginName, version);
      this.linkDependency(pluginName)
      await this.checkLinkedDependencies(installedPlugin)
    } else {
      const installedPlugin = await this.livePluginManager.install(pluginName);
      this.linkDependency(pluginName)
      await this.checkLinkedDependencies(installedPlugin)
    }
  }

  public async listPlugins() {
    const plugins = this.livePluginManager.list()
    if (plugins && plugins.length > 0 && this.loadedPlugins.length == 0) {
      this.loadedPlugins = plugins
      // Check already installed plugins
      for (let plugin of plugins) {
        await this.checkLinkedDependencies(plugin)
      }
    }
    return plugins
  }

  public async uninstallPlugin(pluginName: string) {
    const installedPlugin = this.livePluginManager.getInfo(pluginName)
    if (installedPlugin) {
      console.debug(`Uninstalling plugin ${pluginName}`)
      await this.removeSymlink(installedPlugin)
      await this.livePluginManager.uninstall(pluginName)
      await this.removeSubDependencies(installedPlugin)
    }
  }

  private async removeSubDependencies(plugin: IPluginInfo) {
    const pluginDependencies = Object.keys(plugin.dependencies)
    console.debug("Removing sub dependencies",pluginDependencies)
    for (let dependency of pluginDependencies) {
      await this.removeSubDependency(plugin.name, dependency)
    }
  }

  private async removeSubDependency(_name: string, dependency:string) {
    const dependencyPath = resolveDependencyPath(pluginInstallPath, dependency)
    if (dependencyPath == null) {
      console.error(`Skipping plugin dependency with invalid name: ${dependency}`)
      return
    }
    if (coreDependencies.has(dependency) || this.dependenciesMap.has(dependency)) {
      console.debug(`Dependency ${dependency} is still being used by core or other plugins`)
      return
    }
    // Read sub dependencies
    try {
      const json:IPluginInfo = JSON.parse(
        readFileSync(path.join(dependencyPath, 'package.json'), 'utf-8'));
      if(json.dependencies){
        for (let [subDependency] of Object.entries(json.dependencies)) {
          await this.removeSubDependency(dependency, subDependency)
        }
      }
    } catch (e){}
    this.uninstallDependency(dependency)
  }

  private uninstallDependency(dependency: string) {
    const dependencyPath = resolveDependencyPath(pluginInstallPath, dependency)
    if (dependencyPath == null) {
      console.error(`Skipping plugin dependency with invalid name: ${dependency}`)
      return
    }
    try {
      console.debug(`Uninstalling dependency ${dependency}`)
      // Check if the dependency is already installed
      accessSync(dependencyPath, constants.F_OK)
      rmSync(dependencyPath, {
        force: true,
        recursive: true
      })
    } catch (err) {
      // Symlink does not exist
      // So nothing to do
    }
  }

  private async removeSymlink(plugin: IPluginInfo) {
    try {
      accessSync(path.join(node_modules, plugin.name), constants.F_OK)
      await this.unlinkSubDependencies(plugin)
      // Remove the plugin itself
      this.unlinkDependency(plugin.name)
    } catch (err) {
      console.error(`Symlink for ${plugin.name} does not exist`)
      // Symlink does not exist
      // So nothing to do
    }
  }

  private async unlinkSubDependencies(plugin: IPluginInfo) {
    const pluginDependencies = Object.keys(plugin.dependencies)
    for (let dependency of pluginDependencies) {
      this.dependenciesMap.get(dependency)?.delete(plugin.name)
      await this.unlinkSubDependency(plugin.name, dependency)
    }
  }

  private async unlinkSubDependency(plugin: string, dependency: string) {
    const dependencyPath = resolveDependencyPath(pluginInstallPath, dependency)
    if (dependencyPath == null) {
      console.error(`Skipping plugin dependency with invalid name: ${dependency}`)
      return
    }
    if (coreDependencies.has(dependency)) {
      // Core needs it, so neither it nor its own dependencies may go.
      this.dependenciesMap.get(dependency)?.delete(plugin)
      return
    }
    if (this.dependenciesMap.has(dependency)) {
      this.dependenciesMap.get(dependency)?.delete(plugin)
      if (this.dependenciesMap.get(dependency)!.size > 0) {
        // We have other dependants so do not uninstall
        return
      }
    }
    this.unlinkDependency(dependency)
    // Read sub dependencies
    try {
      const json:IPluginInfo = JSON.parse(
        readFileSync(path.join(dependencyPath, 'package.json'), 'utf-8'));
      if(json.dependencies){
        for (let [subDependency] of Object.entries(json.dependencies)) {
          await this.unlinkSubDependency(dependency, subDependency)
        }
      }
    } catch (e){}

    console.debug("Unlinking sub dependency",dependency)
    this.dependenciesMap.delete(dependency)
  }


  private async addSubDependencies(plugin: IPluginInfo) {
    const pluginDependencies = Object.keys(plugin.dependencies)
    for (let dependency of pluginDependencies) {
      await this.addSubDependency(plugin.name, dependency)
    }
  }

  private async addSubDependency(plugin: string, dependency: string) {
    if (!isValidDependencyName(dependency)) {
      console.error(`Skipping plugin dependency with invalid name: ${dependency}`)
      return
    }
    if (this.dependenciesMap.has(dependency)) {
      // We already added the sub dependency
      this.dependenciesMap.get(dependency)?.add(plugin)
    } else {

      try {
        this.linkDependency(dependency)
        // Read sub dependencies
        const json:IPluginInfo = JSON.parse(
          readFileSync(path.join(pluginInstallPath, dependency, 'package.json'), 'utf-8'));
        if(json.dependencies){
          Object.keys(json.dependencies).forEach((subDependency: string) => {
            this.addSubDependency(dependency, subDependency)
          })
        }
        this.dependenciesMap.set(dependency, new Set([plugin]))
      } catch (err) {
        console.error(`Error reading package.json ${err} for ${path.join(pluginInstallPath, dependency, 'package.json')}`)
      }
    }
  }

  private linkDependency(dependency: string) {
    if (!isValidDependencyName(dependency)) {
      console.error(`Skipping plugin dependency with invalid name: ${dependency}`)
      return
    }
    try {
      // Check if the dependency is already installed
      accessSync(path.join(node_modules, dependency), constants.F_OK)
    } catch (err) {
      try {
        if(dependency.startsWith("@")){
          const newDependency = dependency.split("@")[0]
          symlinkSync(path.join(pluginInstallPath, dependency), path.join(node_modules, newDependency), 'dir')
        } else {
          symlinkSync(path.join(pluginInstallPath, dependency), path.join(node_modules, dependency), 'dir')
        }
      } catch (e) {
        // Nothing to do. We're all set
      }
    }
  }

  private unlinkDependency(dependency: string) {
    const linkPath = resolveDependencyPath(node_modules, dependency)
    if (linkPath == null) {
      console.error(`Skipping plugin dependency with invalid name: ${dependency}`)
      return
    }
    try {
      // Check if the dependency is already installed
      accessSync(linkPath, constants.F_OK)
      if (!this.isPluginLink(linkPath)) {
        console.debug(`Not unlinking ${dependency}: ${linkPath} is not a plugin link`)
        return
      }
      unlinkSync(linkPath)
    } catch (err) {
      // Symlink does not exist
      // So nothing to do
    }
  }


  // True only for a symlink in node_modules that points into
  // pluginInstallPath, i.e. one that linkDependency() or checkForMigration()
  // made. Everything else in node_modules (pnpm's links for core's own
  // dependencies, real directories) belongs to core and is left alone.
  private isPluginLink(linkPath: string) {
    try {
      if (!lstatSync(linkPath).isSymbolicLink()) return false
      const target = path.resolve(path.dirname(linkPath), readlinkSync(linkPath))
      if (isInside(path.resolve(pluginInstallPath), target)) return true
      return isInside(realpathSync(pluginInstallPath), realpathSync(linkPath))
    } catch (err) {
      return false
    }
  }

  private async checkLinkedDependencies(plugin: IPluginInfo) {
    // Check if the plugin really exists at source
    try {
      accessSync(path.join(pluginInstallPath, plugin.name), constants.F_OK)
      // Skip if the plugin is already linked
    } catch (err) {
      // The plugin is not installed
      console.debug(`Plugin ${plugin.name} is not installed`)
    }
    await this.addSubDependencies(plugin)
    // live-plugin-manager lists every package in pluginInstallPath, sub
    // dependencies included, so this also runs for packages like log4js that
    // core and other plugins depend on. Don't wipe their dependents (#8532).
    if (!this.dependenciesMap.has(plugin.name)) {
      this.dependenciesMap.set(plugin.name, new Set())
    }
  }
}
