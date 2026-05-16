import {useStore} from "../store/store.ts";
import {useEffect, useMemo, useState} from "react";
import {InstalledPlugin, PluginDef, SearchParams} from "./Plugin.ts";
import {useDebounce} from "../utils/useDebounce.ts";
import {Trans, useTranslation} from "react-i18next";
import {ArrowUpFromDot, Download, ExternalLink, Plug, RefreshCw, Search, Trash, X} from "lucide-react";
import {IconButton} from "../components/IconButton.tsx";

export const HomePage = () => {
  const pluginsSocket = useStore(state => state.pluginsSocket)
  const [plugins, setPlugins] = useState<PluginDef[]>([])
  const installedPlugins = useStore(state => state.installedPlugins)
  const setInstalledPlugins = useStore(state => state.setInstalledPlugins)
  // Default sort: name ascending. PR #7716 set this to "downloads desc" but
  // the backend (src/static/js/pluginfw/installer.ts) never populates
  // `downloads`, so the "Most popular" sort/"Popular" tag/Downloads column
  // were dead UI — removed alongside this default.
  const [searchParams, setSearchParams] = useState<SearchParams>({
    offset: 0,
    limit: 99999,
    sortBy: 'name',
    sortDir: 'asc',
    searchTerm: '',
  })
  const [searchTerm, setSearchTerm] = useState<string>('')
  const {t} = useTranslation()

  const updatableCount = useMemo(
    () => installedPlugins.filter(p => p.updatable).length,
    [installedPlugins]
  )

  // "Core" plugins are the ones Etherpad ships as part of the runtime
  // (currently just ep_etherpad-lite). Derive from data rather than
  // hardcoding 1 — future packaging changes may bundle more.
  const coreCount = useMemo(
    () => installedPlugins.filter(p => p.name === 'ep_etherpad-lite').length,
    [installedPlugins]
  )

  const sortedInstalledPlugins = useMemo(
    () => [...installedPlugins].sort((a, b) => a.name.localeCompare(b.name)),
    [installedPlugins]
  )

  const filteredInstallablePlugins = useMemo(() => {
    return [...plugins].sort((a, b) => {
      const dir = searchParams.sortDir === 'asc' ? 1 : -1
      if (searchParams.sortBy === 'version') {
        return a.version.localeCompare(b.version) * dir
      }
      if (searchParams.sortBy === 'last-updated') {
        return a.time.localeCompare(b.time) * dir
      }
      return a.name.localeCompare(b.name) * dir
    })
  }, [plugins, searchParams])

  useEffect(() => {
    if (!pluginsSocket) return

    const onInstalled = (data: {installed: InstalledPlugin[]}) => {
      setInstalledPlugins(data.installed)
    }
    const onUpdatable = (data: {updatable: string[]}) => {
      const updated = useStore.getState().installedPlugins.map(plugin =>
        data.updatable.includes(plugin.name) ? {...plugin, updatable: true} : plugin
      )
      setInstalledPlugins(updated)
    }
    const onFinishedInstall = (data: {plugin: string; code?: string | null; error?: string | null}) => {
      if (data?.error) {
        const key = data.code === 'PLUGIN_REQUIRES_NEWER_ETHERPAD'
          ? 'admin_plugins.install_error_requires_newer_etherpad'
          : 'admin_plugins.install_error'
        useStore.getState().setToastState({
          open: true,
          title: t(key, {plugin: data.plugin, error: data.error}),
          success: false,
        })
      }
      pluginsSocket.emit('getInstalled')
    }
    const onFinishedUninstall = () => {
      console.log('Finished uninstall')
    }
    const onConnect = () => {
      pluginsSocket.emit('getInstalled')
      pluginsSocket.emit('search', searchParams)
    }

    pluginsSocket.on('results:installed', onInstalled)
    pluginsSocket.on('results:updatable', onUpdatable)
    pluginsSocket.on('finished:install', onFinishedInstall)
    pluginsSocket.on('finished:uninstall', onFinishedUninstall)
    pluginsSocket.on('connect', onConnect)

    pluginsSocket.emit('getInstalled')

    const interval = setInterval(() => pluginsSocket.emit('checkUpdates'), 1000 * 60 * 5)
    return () => {
      clearInterval(interval)
      pluginsSocket.off('results:installed', onInstalled)
      pluginsSocket.off('results:updatable', onUpdatable)
      pluginsSocket.off('finished:install', onFinishedInstall)
      pluginsSocket.off('finished:uninstall', onFinishedUninstall)
      pluginsSocket.off('connect', onConnect)
    }
  }, [pluginsSocket])

  useEffect(() => {
    if (!pluginsSocket) return

    const onSearchResults = (data: {results: PluginDef[]}) => {
      setPlugins(data.results)
    }
    const onSearchError = () => {
      useStore.getState().setToastState({open: true, title: t('admin_plugins.error_retrieving'), success: false})
    }

    pluginsSocket.emit('search', searchParams)
    pluginsSocket.on('results:search', onSearchResults)
    pluginsSocket.on('results:searcherror', onSearchError)

    return () => {
      pluginsSocket.off('results:search', onSearchResults)
      pluginsSocket.off('results:searcherror', onSearchError)
    }
  }, [searchParams, pluginsSocket])

  const uninstallPlugin = (pluginName: string) => {
    pluginsSocket!.emit('uninstall', pluginName)
    setInstalledPlugins(installedPlugins.filter(i => i.name !== pluginName))
  }

  const installPlugin = (pluginName: string) => {
    pluginsSocket!.emit('install', pluginName)
    setPlugins(plugins.filter(p => p.name !== pluginName))
  }

  useDebounce(() => {
    setSearchParams({...searchParams, offset: 0, searchTerm})
  }, 500, [searchTerm])

  return (
    <div className="pm-page">

      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="pm-header">
        <div>
          <div className="pm-crumbs">
            Admin <span className="pm-crumbs-sep">›</span> <Trans i18nKey="admin_plugins.crumbs"/>
          </div>
          <h1 className="pm-title">{t('admin_plugins')}</h1>
          <p className="pm-subtitle">
            <Trans i18nKey="admin_plugins.subtitle"/>
          </p>
        </div>
        <div className="pm-header-actions">
          <button
            className="pm-btn pm-btn-ghost"
            onClick={() => pluginsSocket?.emit('search', searchParams)}
          >
            <RefreshCw size={14}/> <Trans i18nKey="admin_plugins.reload_catalog"/>
          </button>
          <a
            className="pm-btn pm-btn-primary pm-btn-link"
            href={`//www.npmjs.com/search?q=${encodeURIComponent(searchTerm ? `keywords:etherpad ${searchTerm}` : 'keywords:etherpad')}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14}/> <Trans i18nKey="admin_plugins.search_npm"/>
          </a>
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────── */}
      <div className="pm-stats">
        <div className="pm-stat pm-stat--primary">
          <div className="pm-stat-label"><Trans i18nKey="admin_plugins.installed"/></div>
          <div className="pm-stat-value">{installedPlugins.length}</div>
          <div className="pm-stat-hint">{t('admin_plugins.core_count', {count: coreCount})}</div>
        </div>
        <div className="pm-stat">
          <div className="pm-stat-label"><Trans i18nKey="admin_plugins.available"/></div>
          <div className="pm-stat-value">{plugins.length}</div>
        </div>
        <div className={`pm-stat${updatableCount > 0 ? ' pm-stat--warn' : ''}`}>
          <div className="pm-stat-label"><Trans i18nKey="admin_plugins.updates_available"/></div>
          <div className="pm-stat-value">{updatableCount}</div>
          {updatableCount > 0 && (
            <button
              className="pm-stat-action"
              onClick={() => pluginsSocket?.emit('checkUpdates')}
            >
              <Trans i18nKey="admin_plugins.update_now"/> →
            </button>
          )}
        </div>
        <div className="pm-stat">
          <div className="pm-stat-label"><Trans i18nKey="admin_plugins.source"/></div>
          <div className="pm-stat-value pm-stat-value--sm">npm</div>
          <div className="pm-stat-hint">registry.npmjs.org</div>
        </div>
      </div>

      {/* ── Installed plugins ──────────────────────────────────────────── */}
      <section className="pm-section">
        <div className="pm-section-header">
          <h2><Trans i18nKey="admin_plugins.installed"/></h2>
          <span className="pm-count-badge">{installedPlugins.length}</span>
          <div className="pm-spacer"/>
          <button
            className="pm-btn pm-btn-ghost"
            onClick={() => pluginsSocket?.emit('checkUpdates')}
          >
            <RefreshCw size={14}/> <Trans i18nKey="admin_plugins.check_updates"/>
          </button>
        </div>

        <div className="pm-installed">
          {sortedInstalledPlugins.map(plugin => (
            <div key={plugin.name} className="pm-installed-row">
              <div className="pm-installed-icon">
                <Plug size={16}/>
              </div>
              <div className="pm-installed-main">
                <div className="pm-installed-title">
                  <a
                    className="pm-mono pm-plugin-link"
                    href={`https://npmjs.com/${plugin.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >{plugin.name}</a>
                  {plugin.name === 'ep_etherpad-lite' && (
                    <span className="pm-tag pm-tag--core"><Trans i18nKey="admin_plugins.tag_core"/></span>
                  )}
                  <span className="pm-tag pm-tag--ver">v{plugin.version}</span>
                </div>
                {plugin.description && (
                  <div className="pm-installed-desc">{plugin.description}</div>
                )}
              </div>
              <div className="pm-installed-actions">
                {plugin.updatable ? (
                  <IconButton
                    onClick={() => installPlugin(plugin.name)}
                    icon={<ArrowUpFromDot size={14}/>}
                    title={t('admin_plugins.update_tooltip')}
                  />
                ) : (
                  <IconButton
                    disabled={plugin.name === 'ep_etherpad-lite'}
                    icon={<Trash size={14}/>}
                    title={<Trans i18nKey="admin_plugins.installed_uninstall.value"/>}
                    onClick={() => uninstallPlugin(plugin.name)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Available plugins ──────────────────────────────────────────── */}
      <section className="pm-section">
        <div className="pm-section-header">
          <h2><Trans i18nKey="admin_plugins.available"/></h2>
          <span className="pm-count-badge">{filteredInstallablePlugins.length}</span>
          <div className="pm-spacer"/>
          <div className="pm-toolbar">
            <div className="pm-search">
              <Search size={14} className="pm-search-icon"/>
              <input
                className="pm-search-input"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder={t('admin_plugins.available_search.placeholder')}
              />
              {searchTerm && (
                <button className="pm-search-clear" onClick={() => setSearchTerm('')}>
                  <X size={12}/>
                </button>
              )}
            </div>
            <select
              className="pm-select"
              value={searchParams.sortBy}
              onChange={e => {
                const sortBy = e.target.value as SearchParams['sortBy']
                setSearchParams({
                  ...searchParams,
                  sortBy,
                  sortDir: 'asc',
                })
              }}
            >
              <option value="name">{t('admin_plugins.sort.name')}</option>
              <option value="version">{t('admin_plugins.sort.version')}</option>
              <option value="last-updated">{t('admin_plugins.sort.last_updated')}</option>
            </select>
            <button
              className="pm-sort-dir"
              onClick={() => setSearchParams({
                ...searchParams,
                sortDir: searchParams.sortDir === 'asc' ? 'desc' : 'asc',
              })}
              title={t(searchParams.sortDir === 'asc'
                ? 'admin_plugins.sort_ascending'
                : 'admin_plugins.sort_descending')}
              aria-label={t(searchParams.sortDir === 'asc'
                ? 'admin_plugins.sort_ascending'
                : 'admin_plugins.sort_descending')}
            >
              {searchParams.sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>

        {filteredInstallablePlugins.length > 0 ? (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th><Trans i18nKey="admin_plugins.name"/></th>
                  <th><Trans i18nKey="admin_plugins.description"/></th>
                  <th style={{width: 62, textAlign: 'right'}}><Trans i18nKey="admin_plugins.version"/></th>
                  <th style={{width: 96}}><Trans i18nKey="admin_plugins.last-update"/></th>
                  <th style={{width: 108, textAlign: 'right'}}></th>
                </tr>
              </thead>
              <tbody>
                {filteredInstallablePlugins.map(plugin => (
                  <tr key={plugin.name}>
                    <td>
                      <div className="pm-cell-name">
                        <span className="pm-cell-icon"><Plug size={13}/></span>
                        <div className="pm-cell-title">
                          <a
                            className="pm-mono pm-plugin-link"
                            href={`https://npmjs.com/${plugin.name}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >{plugin.name}</a>
                        </div>
                      </div>
                    </td>
                    <td className="pm-cell-desc">
                      {plugin.description}
                      {plugin.disables && plugin.disables.length > 0 && (
                        <div
                          className="plugin-disables"
                          role="alert"
                          title={t('admin_plugins.disables.warning_title')}
                        >
                          <strong><Trans i18nKey="admin_plugins.disables.label"/></strong>{' '}
                          {plugin.disables
                            .map(tag => tag.replace(/^@feature:/, ''))
                            .join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="pm-num">{plugin.version}</td>
                    <td className="pm-cell-date">{plugin.time}</td>
                    <td className="pm-cell-action">
                      <button
                        className="pm-btn pm-btn-primary pm-btn--sm"
                        onClick={() => installPlugin(plugin.name)}
                      >
                        <Download size={13}/> <Trans i18nKey="admin_plugins.available_install.value"/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pm-empty">
            <div className="pm-empty-icon">∅</div>
            <div className="pm-empty-title">
              {searchTerm === ''
                ? <Trans i18nKey="pad.loading"/>
                : <Trans i18nKey="admin_plugins.available_not-found"/>}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
