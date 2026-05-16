import {Trans, useTranslation} from "react-i18next";
import {useStore} from "../store/store.ts";
import {useEffect, useMemo, useState} from "react";
import {HelpObj} from "./Plugin.ts";
import {Copy, Search, X, Plug} from "lucide-react";

export const HelpPage = () => {
  const settingsSocket = useStore(state => state.settingsSocket)
  const {t} = useTranslation()
  const [helpData, setHelpData] = useState<HelpObj>()
  const [tab, setTab] = useState<'server' | 'client'>('server')
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!settingsSocket) return
    settingsSocket.on('reply:help', (data) => setHelpData(data))
    settingsSocket.emit('help')
  }, [settingsSocket])

  const serverHooks = useMemo(() => {
    if (!helpData) return []
    return Object.keys(helpData.installedServerHooks).map(hookName => ({
      name: hookName,
      parts: Object.keys((helpData.installedServerHooks as Record<string, Record<string, unknown>>)[hookName] ?? {}),
    }))
  }, [helpData])

  const clientHooks = useMemo(() => {
    if (!helpData) return []
    return Object.keys(helpData.installedClientHooks).map(hookName => ({
      name: hookName,
      parts: Object.keys(helpData.installedClientHooks[hookName] ?? {}),
    }))
  }, [helpData])

  const hooks = tab === 'server' ? serverHooks : clientHooks

  const filteredHooks = useMemo(() => {
    if (!q.trim()) return hooks
    const s = q.toLowerCase()
    return hooks.filter(h =>
      h.name.toLowerCase().includes(s) || h.parts.some(p => p.toLowerCase().includes(s))
    )
  }, [hooks, q])

  const totalBindings = hooks.reduce((n, h) => n + h.parts.length, 0)

  const updateAvailable = helpData
    ? helpData.epVersion.localeCompare(helpData.latestVersion, undefined, {numeric: true}) < 0
    : false

  const copyDiag = () => {
    if (!helpData) return
    navigator.clipboard?.writeText(JSON.stringify({
      version: helpData.epVersion,
      latestVersion: helpData.latestVersion,
      gitCommit: helpData.gitCommit,
      plugins: helpData.installedPlugins.length,
      parts: helpData.installedParts.length,
      hookBindings: totalBindings,
    }, null, 2))
  }

  if (!helpData) return (
    <div className="pm-page">
      <div className="pm-empty"><div className="pm-empty-icon">⋯</div></div>
    </div>
  )

  return (
    <div className="pm-page">

      {/* ── Page header ── */}
      <div className="pm-header">
        <div>
          <div className="pm-crumbs">Admin <span className="pm-crumbs-sep">›</span> <Trans i18nKey="admin_plugins_info"/></div>
          <h1 className="pm-title"><Trans i18nKey="admin_plugins_info"/></h1>
          <p className="pm-subtitle"><Trans i18nKey="admin_plugins_info.subtitle"/></p>
        </div>
        <div className="pm-header-actions">
          <button className="pm-btn pm-btn-ghost" onClick={copyDiag}>
            <Copy size={14}/> <Trans i18nKey="admin_plugins_info.copy_diagnostics"/>
          </button>
        </div>
      </div>

      {/* ── Version block ── */}
      <section className="pm-help-version">
        <div className="pm-hv-main">
          <div className="pm-hv-lbl"><Trans i18nKey="admin_plugins_info.version"/></div>
          <div className="pm-hv-num">{helpData.epVersion}</div>
          <div className={`pm-hv-status${updateAvailable ? ' is-warn' : ' is-ok'}`}>
            <span className="pm-hv-dot"/>
            {updateAvailable
              ? t('admin_plugins_info.update_available', {version: helpData.latestVersion})
              : t('admin_plugins_info.up_to_date')}
          </div>
        </div>
        <div className="pm-hv-meta">
          <div className="pm-hv-cell">
            <div className="pm-hv-cell-lbl"><Trans i18nKey="admin_plugins_info.version_latest"/></div>
            <div className="pm-hv-cell-val">{helpData.latestVersion}</div>
          </div>
          <div className="pm-hv-cell">
            <div className="pm-hv-cell-lbl"><Trans i18nKey="admin_plugins_info.git_sha"/></div>
            <div className="pm-hv-cell-val pm-mono">
              {helpData.gitCommit}
              <button
                className="pm-mini-btn"
                onClick={() => navigator.clipboard?.writeText(helpData.gitCommit)}
                title={t('admin_plugins_info.copy_value', {label: t('admin_plugins_info.git_sha')})}
              >
                <Copy size={11}/>
              </button>
            </div>
          </div>
          <div className="pm-hv-cell">
            <div className="pm-hv-cell-lbl"><Trans i18nKey="admin_plugins.installed"/></div>
            <div className="pm-hv-cell-val">{helpData.installedPlugins.length}</div>
          </div>
          <div className="pm-hv-cell">
            <div className="pm-hv-cell-lbl"><Trans i18nKey="admin_plugins_info.parts"/></div>
            <div className="pm-hv-cell-val">{helpData.installedParts.length}</div>
          </div>
          <div className="pm-hv-cell">
            <div className="pm-hv-cell-lbl"><Trans i18nKey="admin_plugins_info.hook_bindings"/></div>
            <div className="pm-hv-cell-val">{totalBindings}</div>
          </div>
        </div>
      </section>

      {/* ── Plugins + Parts ── */}
      <section className="pm-section">
        <div className="pm-help-grid">
          <div className="pm-help-card">
            <div className="pm-section-header pm-sec-tight">
              <h2><Trans i18nKey="admin_plugins.installed"/></h2>
              <span className="pm-count-badge">{helpData.installedPlugins.length}</span>
            </div>
            <div className="pm-tag-cloud">
              {helpData.installedPlugins.map(p => (
                <span key={p} className="pm-pill pm-pill-mono">
                  <span className="pm-pill-ico"><Plug size={11}/></span>
                  {p}
                </span>
              ))}
            </div>
          </div>

          <div className="pm-help-card">
            <div className="pm-section-header pm-sec-tight">
              <h2><Trans i18nKey="admin_plugins_info.parts"/></h2>
              <span className="pm-count-badge">{helpData.installedParts.length}</span>
            </div>
            <div className="pm-tag-cloud">
              {helpData.installedParts.map(p => {
                const slash = p.indexOf('/')
                const ns   = slash >= 0 ? p.slice(0, slash) : p
                const name = slash >= 0 ? p.slice(slash + 1) : ''
                return (
                  <span key={p} className="pm-pill pm-pill-mono" title={p}>
                    <span className="pm-pill-ns">{ns}</span>
                    {name && <><span className="pm-pill-sep">/</span><span>{name}</span></>}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Hooks ── */}
      <section className="pm-section">
        <div className="pm-section-header">
          <h2><Trans i18nKey="admin_plugins_info.hooks"/></h2>
          <span className="pm-count-badge">{filteredHooks.length}</span>
          <div className="pm-spacer"/>
          <div className="pm-toolbar">
            <div className="pm-tabs">
              <button className={`pm-tab${tab === 'server' ? ' is-on' : ''}`} onClick={() => setTab('server')}>
                <Trans i18nKey="admin_plugins_info.tab_server"/> <span className="pm-tab-n">{serverHooks.length}</span>
              </button>
              <button className={`pm-tab${tab === 'client' ? ' is-on' : ''}`} onClick={() => setTab('client')}>
                <Trans i18nKey="admin_plugins_info.tab_client"/> <span className="pm-tab-n">{clientHooks.length}</span>
              </button>
            </div>
            <div className="pm-search">
              <Search size={14} className="pm-search-icon"/>
              <input
                className="pm-search-input"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={t('admin_plugins_info.search_placeholder')}
              />
              {q && <button className="pm-search-clear" onClick={() => setQ('')}><X size={12}/></button>}
            </div>
          </div>
        </div>

        {filteredHooks.length > 0 ? (
          <div className="pm-hooks">
            {filteredHooks.map(h => (
              <div key={h.name} className="pm-hook">
                <div className="pm-hook-h">
                  <span className="pm-hook-name">{h.name}</span>
                  <span className="pm-hook-count">{t('admin_plugins_info.bindings_label', {count: h.parts.length})}</span>
                </div>
                <div className="pm-hook-parts">
                  {h.parts.map(p => (
                    <span key={p} className="pm-pill pm-pill-mono pm-pill-sm">{p}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="pm-empty">
            <div className="pm-empty-icon">∅</div>
            <div className="pm-empty-title"><Trans i18nKey="admin_plugins_info.no_hooks"/></div>
          </div>
        )}
      </section>
    </div>
  )
}
