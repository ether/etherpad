import {IPluginInfo, PluginManager} from "live-plugin-manager";
import path from "path";
import {node_modules, pluginInstallPath} from "./installer";
import {accessSync, constants, rmSync, symlinkSync, unlinkSync} from "node:fs";
import {dependencies, name} from '../../../package.json'
import {pathToFileURL} from 'node:url';
import settings from '../../../node/utils/Settings';
import {readFileSync} from "fs";

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
        if (this.dependenciesMap.has(dependency)) {
            console.debug(`Dependency ${dependency} is still being used by other plugins`)
            return
        }
        // Read sub dependencies
        try {
            const json:IPluginInfo = JSON.parse(
                readFileSync(pathToFileURL(path.join(pluginInstallPath, dependency, 'package.json'))) as unknown as string);
            if(json.dependencies){
                for (let [subDependency] of Object.entries(json.dependencies)) {
                    await this.removeSubDependency(dependency, subDependency)
                }
            }
        } catch (e){}
        this.uninstallDependency(dependency)
    }

    private uninstallDependency(dependency: string) {
        try {
            console.debug(`Uninstalling dependency ${dependency}`)
            // Check if the dependency is already installed
            accessSync(path.join(pluginInstallPath, dependency), constants.F_OK)
            rmSync(path.join(pluginInstallPath, dependency), {
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
                readFileSync(pathToFileURL(path.join(pluginInstallPath, dependency, 'package.json'))) as unknown as string);
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
        if (this.dependenciesMap.has(dependency)) {
            // We already added the sub dependency
            this.dependenciesMap.get(dependency)?.add(plugin)
        } else {

            try {
                this.linkDependency(dependency)
                // Read sub dependencies
                const json:IPluginInfo = JSON.parse(
                    readFileSync(pathToFileURL(path.join(pluginInstallPath, dependency, 'package.json'))) as unknown as string);
                if(json.dependencies){
                    Object.keys(json.dependencies).forEach((subDependency: string) => {
                        this.addSubDependency(dependency, subDependency)
                    })
                }
            } catch (err) {
                console.error(`Error reading package.json ${err} for ${pathToFileURL(path.join(pluginInstallPath, dependency, 'package.json')).toString()}`)
            }
            this.dependenciesMap.set(dependency, new Set([plugin]))
        }
    }

    private linkDependency(dependency: string) {
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
        try {
            // Check if the dependency is already installed
            accessSync(path.join(node_modules, dependency), constants.F_OK)
            unlinkSync(path.join(node_modules, dependency))
        } catch (err) {
            // Symlink does not exist
            // So nothing to do
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
        this.dependenciesMap.set(plugin.name, new Set())
    }
}
