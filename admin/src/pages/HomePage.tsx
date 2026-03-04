import {useStore} from "../store/store.ts";
import {useEffect, useMemo, useState} from "react";
import {InstalledPlugin, PluginDef, SearchParams} from "./Plugin.ts";
import {useDebounce} from "../utils/useDebounce.ts";
import {Trans, useTranslation} from "react-i18next";
import {SearchField} from "../components/SearchField.tsx";
import {ArrowUpFromDot, Download, Trash} from "lucide-react";
import {IconButton} from "../components/IconButton.tsx";
import {determineSorting} from "../utils/sorting.ts";


export const HomePage = () => {
    const pluginsSocket = useStore(state=>state.pluginsSocket)
    const [plugins,setPlugins] = useState<PluginDef[]>([])
  const installedPlugins = useStore(state=>state.installedPlugins)
  const setInstalledPlugins = useStore(state=>state.setInstalledPlugins)
  const [searchParams, setSearchParams] = useState<SearchParams>({
    offset: 0,
    limit: 99999,
    sortBy: 'name',
    sortDir: 'asc',
    searchTerm: ''
  })

  const filteredInstallablePlugins = useMemo(()=>{
    return plugins.sort((a, b)=>{
      if(searchParams.sortBy === "version"){
        if(searchParams.sortDir === "asc"){
          return a.version.localeCompare(b.version)
        }
        return b.version.localeCompare(a.version)
      }

      if(searchParams.sortBy === "last-updated"){
        if(searchParams.sortDir === "asc"){
          return a.time.localeCompare(b.time)
        }
        return b.time.localeCompare(a.time)
      }


      if (searchParams.sortBy === "name") {
        if(searchParams.sortDir === "asc"){
          return a.name.localeCompare(b.name)
        }
        return b.name.localeCompare(a.name)
      }
      return 0
    })
  }, [plugins, searchParams])

    const sortedInstalledPlugins = useMemo(()=>{
        return useStore.getState().installedPlugins.sort((a, b)=>{

            if(a.name < b.name){
                return -1
            }
            if(a.name > b.name){
                return 1
            }
            return 0
        })

    } ,[installedPlugins, searchParams])

    const [searchTerm, setSearchTerm] = useState<string>('')
    const {t} = useTranslation()


    useEffect(() => {
        if(!pluginsSocket){
            return
        }

        pluginsSocket.on('results:installed', (data:{
            installed: InstalledPlugin[]
        })=>{
            setInstalledPlugins(data.installed)
        })

        pluginsSocket.on('results:updatable', (data) => {
          const newInstalledPlugins = useStore.getState().installedPlugins.map(plugin => {
            if (data.updatable.includes(plugin.name)) {
              return {
                ...plugin,
                updatable: true
              }
            }
            return plugin
          })
         setInstalledPlugins(newInstalledPlugins)
        })

        pluginsSocket.on('finished:install', () => {
            pluginsSocket!.emit('getInstalled');
        })

        pluginsSocket.on('finished:uninstall', () => {
            console.log("Finished uninstall")
        })


        // Reload on reconnect
        pluginsSocket.on('connect', ()=>{
            // Initial retrieval of installed plugins
            pluginsSocket.emit('getInstalled');
            pluginsSocket.emit('search', searchParams)
        })

        pluginsSocket.emit('getInstalled');

        // check for updates every 5mins
        const interval = setInterval(() => {
            pluginsSocket.emit('checkUpdates');
        }, 1000 * 60 * 5);

        return ()=>{
            clearInterval(interval)
        }
        }, [pluginsSocket]);


    useEffect(() => {
        if (!pluginsSocket) {
            return
        }
        pluginsSocket?.emit('search', searchParams)
        pluginsSocket!.on('results:search', (data: {
            results: PluginDef[]
        }) => {
            setPlugins(data.results)
        })
        pluginsSocket!.on('results:searcherror', (data: {error: string}) => {
            console.log(data.error)
            useStore.getState().setToastState({
                open: true,
                title: "Error retrieving plugins",
                success: false
            })
        })
    }, [searchParams, pluginsSocket]);

    const uninstallPlugin  = (pluginName: string)=>{
        pluginsSocket!.emit('uninstall', pluginName);
        // Remove plugin
        setInstalledPlugins(installedPlugins.filter(i=>i.name !== pluginName))
    }

    const installPlugin = (pluginName: string)=>{
        pluginsSocket!.emit('install', pluginName);
        setPlugins(plugins.filter(plugin=>plugin.name !== pluginName))
    }

    useDebounce(()=>{
        setSearchParams({
            ...searchParams,
            offset: 0,
            searchTerm: searchTerm
        })
    }, 500, [searchTerm])


    return <div>
        <h1><Trans i18nKey="admin_plugins"/></h1>

        <h2><Trans i18nKey="admin_plugins.installed"/></h2>

        <table id="installed-plugins">
            <thead>
            <tr>
                <th><Trans i18nKey="admin_plugins.name"/></th>
                <th><Trans i18nKey="admin_plugins.version"/></th>
                <th><Trans i18nKey="ep_admin_pads:ep_adminpads2_action"/></th>
            </tr>
            </thead>
            <tbody style={{overflow: 'auto'}}>
            {sortedInstalledPlugins.map((plugin, index) => {
                return <tr key={index}>
                    <td><a rel="noopener noreferrer" href={`https://npmjs.com/${plugin.name}`} target="_blank">{plugin.name}</a></td>
                    <td>{plugin.version}</td>
                    <td>
                    {
                        plugin.updatable ?
                            <IconButton onClick={() => installPlugin(plugin.name)} icon={<ArrowUpFromDot/>} title="Update"></IconButton>
                            : <IconButton disabled={plugin.name == "ep_etherpad-lite"} icon={<Trash/>} title={<Trans i18nKey="admin_plugins.installed_uninstall.value"/>} onClick={() => uninstallPlugin(plugin.name)}/>
                    }
                    </td>
                        </tr>
                    })}
            </tbody>
        </table>


        <h2><Trans i18nKey="admin_plugins.available"/></h2>
        <SearchField onChange={v=>{setSearchTerm(v.target.value)}} placeholder={t('admin_plugins.available_search.placeholder')} value={searchTerm}/>

      <div className="table-container">
        <table id="available-plugins">
            <thead>
            <tr>
                <th className={determineSorting(searchParams.sortBy, searchParams.sortDir == "asc", 'name')} onClick={()=>{
                  setSearchParams({
                    ...searchParams,
                    sortBy: 'name',
                    sortDir: searchParams.sortDir === "asc"? "desc": "asc"
                  })
                }}>
                  <Trans i18nKey="admin_plugins.name" /></th>
                <th style={{width: '30%'}}><Trans i18nKey="admin_plugins.description"/></th>
                <th className={determineSorting(searchParams.sortBy, searchParams.sortDir == "asc", 'version')} onClick={()=>{
                  setSearchParams({
                    ...searchParams,
                    sortBy: 'version',
                    sortDir: searchParams.sortDir === "asc"? "desc": "asc"
                  })
                }}><Trans i18nKey="admin_plugins.version"/></th>
                <th className={determineSorting(searchParams.sortBy, searchParams.sortDir == "asc", 'last-updated')} onClick={()=>{
                  setSearchParams({
                    ...searchParams,
                    sortBy: 'last-updated',
                    sortDir: searchParams.sortDir === "asc"? "desc": "asc"
                  })
                }}><Trans i18nKey="admin_plugins.last-update"/></th>
                <th><Trans i18nKey="ep_admin_pads:ep_adminpads2_action"/></th>
            </tr>
            </thead>
            <tbody style={{overflow: 'auto'}}>
            {(filteredInstallablePlugins.length > 0) ?
              filteredInstallablePlugins.map((plugin) => {
                        return <tr key={plugin.name}>
                            <td><a rel="noopener noreferrer" href={`https://npmjs.com/${plugin.name}`} target="_blank">{plugin.name}</a></td>
                            <td>{plugin.description}</td>
                            <td>{plugin.version}</td>
                            <td>{plugin.time}</td>
                            <td>
                                <IconButton icon={<Download/>} onClick={() => installPlugin(plugin.name)} title={<Trans i18nKey="admin_plugins.available_install.value"/>}/>
                            </td>
                        </tr>
                    })
                :
                <tr><td colSpan={5}>{searchTerm == '' ? <Trans i18nKey="pad.loading"/>: <Trans i18nKey="admin_plugins.available_not-found"/>}</td></tr>
            }
            </tbody>
        </table>
      </div>
    </div>
}
