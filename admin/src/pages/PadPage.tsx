import {Trans, useTranslation} from "react-i18next";
import {useEffect, useMemo, useState} from "react";
import {useStore} from "../store/store.ts";
import {PadFilter, PadSearchQuery, PadSearchResult} from "../utils/PadSearch.ts";
import {useDebounce} from "../utils/useDebounce.ts";
import * as Dialog from "@radix-ui/react-dialog";
import {VisuallyHidden} from "@radix-ui/react-visually-hidden";
import {ChevronLeft, ChevronRight, Eye, Trash2, FileStack, PlusIcon, Search, X, RefreshCw, History} from "lucide-react";
import {useForm} from "react-hook-form";
import type {TFunction} from "i18next";

type PadCreateProps = { padName: string }

const PAD_FILTER_IDS: PadFilter[] = ['all', 'active', 'recent', 'empty', 'stale']

function relativeTime(t: TFunction, ts: number): string {
  const d = (Date.now() - ts) / 1000
  if (d < 60)        return t('admin_pads.relative.just_now')
  if (d < 3600)      return t('admin_pads.relative.minutes', {count: Math.floor(d / 60)})
  if (d < 86400)     return t('admin_pads.relative.hours',   {count: Math.floor(d / 3600)})
  if (d < 86400 * 7) return t('admin_pads.relative.days',    {count: Math.floor(d / 86400)})
  if (d < 86400 * 30) return t('admin_pads.relative.weeks',  {count: Math.floor(d / 86400 / 7)})
  if (d < 86400 * 365) return t('admin_pads.relative.months', {count: Math.floor(d / 86400 / 30)})
  return t('admin_pads.relative.years', {count: Math.floor(d / 86400 / 365)})
}

function fmtDate(locale: string, ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleDateString(locale, {day: '2-digit', month: 'short', year: 'numeric'}) +
    ' · ' +
    d.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'})
  )
}

// i18next's language detector reads ?lng= from the URL, so the value can be
// attacker-controlled and structurally invalid (e.g. "en_US", "💥", "  ").
// Intl.* throws RangeError on bad tags, which would crash the pads page
// during render. Normalise underscores → dashes and let the Intl runtime
// tell us which subset of the tag it can support; on failure, fall back to
// 'en' to mirror i18next's fallbackLng so dates render in a sane locale
// rather than the user's browser default fighting the page copy.
function sanitizeLocale(lng?: string): string {
  if (!lng) return 'en'
  const normalized = lng.trim().replace(/_/g, '-')
  if (!normalized) return 'en'
  try {
    const [supported] = Intl.DateTimeFormat.supportedLocalesOf([normalized])
    return supported ?? 'en'
  } catch {
    return 'en'
  }
}

export const PadPage = () => {
  const settingsSocket = useStore(state => state.settingsSocket)
  const [searchParams, setSearchParams] = useState<PadSearchQuery>({
    offset: 0, limit: 12, pattern: '', sortBy: 'lastEdited', ascending: false, filter: 'all',
  })
  const {t, i18n} = useTranslation()
  const locale = sanitizeLocale(i18n.resolvedLanguage ?? i18n.language)
  const [searchTerm, setSearchTerm] = useState('')
  // Read filter off searchParams so chip changes round-trip through
  // the server (`filter` is applied before pagination there). Clicking
  // a chip used to filter only the current 12-row page slice.
  //
  // All searchParams mutations go through functional updaters because the
  // debounced pattern handler captures a render-time snapshot and would
  // otherwise revert a faster chip click / sort change made in between.
  const filter: PadFilter = searchParams.filter ?? 'all'
  const setFilter = (f: PadFilter) => {
    setCurrentPage(0)
    setSearchParams((sp) => ({...sp, filter: f, offset: 0}))
  }
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const pads = useStore(state => state.pads)
  const [currentPage, setCurrentPage] = useState(0)
  const [deleteDialog, setDeleteDialog] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [padToDelete, setPadToDelete] = useState('')
  const [createPadDialogOpen, setCreatePadDialogOpen] = useState(false)
  const {register, handleSubmit} = useForm<PadCreateProps>()

  const pages = useMemo(
    () => pads ? Math.ceil(pads.total / searchParams.limit) : 0,
    [pads, searchParams.limit]
  )

  // The server applies `filter` before paginating; the page payload is
  // already the filtered slice. The stats cards still reflect the
  // current page (pre-existing behaviour) — making them global would
  // require a separate aggregate query.
  const visibleResults = pads?.results ?? []
  const totalUsers  = useMemo(() => visibleResults.reduce((s, p) => s + p.userCount, 0), [pads])
  const activeCount = useMemo(() => visibleResults.filter(p => p.userCount > 0).length, [pads])
  const emptyCount  = useMemo(() => visibleResults.filter(p => p.revisionNumber === 0).length, [pads])
  const lastActivity = useMemo(() => {
    return visibleResults.length ? Math.max(...visibleResults.map(p => p.lastEdited)) : null
  }, [pads])

  const allSelected = visibleResults.length > 0 && visibleResults.every(p => selected.has(p.padName))
  const toggleAll = () => {
    const s = new Set(selected)
    if (allSelected) visibleResults.forEach(p => s.delete(p.padName))
    else visibleResults.forEach(p => s.add(p.padName))
    setSelected(s)
  }
  const toggleOne = (name: string) => {
    const s = new Set(selected)
    s.has(name) ? s.delete(name) : s.add(name)
    setSelected(s)
  }

  useDebounce(() => {
    // Functional updater so this delayed callback can't clobber a faster
    // user interaction (e.g. clicking a filter chip mid-typing).
    setSearchParams((sp) => ({...sp, pattern: searchTerm, offset: 0}))
    setCurrentPage(0)
  }, 500, [searchTerm])

  useEffect(() => {
    if (!settingsSocket) return
    settingsSocket.emit('padLoad', searchParams)
  }, [settingsSocket, searchParams])

  useEffect(() => {
    if (!settingsSocket) return

    settingsSocket.on('results:padLoad', (data: PadSearchResult) => {
      useStore.getState().setPads(data)
    })

    settingsSocket.on('results:deletePad', (padID: string) => {
      const newPads = useStore.getState().pads?.results?.filter(p => p.padName !== padID)
      useStore.getState().setPads({total: useStore.getState().pads!.total - 1, results: newPads})
    })

    type CreateResponse = {error: string} | {success: string}
    settingsSocket.on('results:createPad', (rep: CreateResponse) => {
      if ('error' in rep) {
        useStore.getState().setToastState({open: true, title: rep.error, success: false})
      } else {
        useStore.getState().setToastState({open: true, title: rep.success, success: true})
        setCreatePadDialogOpen(false)
        settingsSocket.emit('padLoad', searchParams)
      }
    })

    settingsSocket.on('results:cleanupPadRevisions', (data) => {
      const newPads = useStore.getState().pads?.results ?? []
      if (data.error) { setErrorText(data.error); return }
      newPads.forEach(p => { if (p.padName === data.padId) p.revisionNumber = data.keepRevisions })
      useStore.getState().setPads({results: newPads, total: useStore.getState().pads!.total})
    })
  }, [settingsSocket, pads])

  const deletePad  = (id: string) => settingsSocket?.emit('deletePad', id)
  const cleanupPad = (id: string) => settingsSocket?.emit('cleanupPadRevisions', id)
  const onPadCreate = (data: PadCreateProps) => settingsSocket?.emit('createPad', {padName: data.padName})

  return (
    <div className="pm-page">

      {/* ── Dialogs ── */}
      <Dialog.Root open={deleteDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-confirm-overlay"/>
          <Dialog.Content className="dialog-confirm-content">
            <VisuallyHidden asChild><Dialog.Title>{t('admin_pads.delete_pad_dialog_title')}</Dialog.Title></VisuallyHidden>
            <Dialog.Description asChild>
              <div>{t('ep_admin_pads:ep_adminpads2_confirm', {padID: padToDelete})}</div>
            </Dialog.Description>
            <div className="settings-button-bar">
              <button onClick={() => setDeleteDialog(false)}><Trans i18nKey="admin_pads.cancel"/></button>
              <button onClick={() => { deletePad(padToDelete); setDeleteDialog(false) }}>{t('admin_pads.confirm_button')}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={errorText !== null}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-confirm-overlay"/>
          <Dialog.Content className="dialog-confirm-content">
            <VisuallyHidden asChild><Dialog.Title>{t('admin_pads.error_prefix')}</Dialog.Title></VisuallyHidden>
            <Dialog.Description asChild>
              <div>{t('admin_pads.error_prefix')}: {errorText}</div>
            </Dialog.Description>
            <div className="settings-button-bar">
              <button onClick={() => setErrorText(null)}>{t('admin_pads.confirm_button')}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={createPadDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-confirm-overlay"/>
          <Dialog.Content className="dialog-confirm-content">
            <Dialog.Title className="dialog-confirm-title"><Trans i18nKey="index.newPad"/></Dialog.Title>
            <VisuallyHidden asChild><Dialog.Description>{t('admin_pads.create_pad_dialog_description')}</Dialog.Description></VisuallyHidden>
            <form onSubmit={handleSubmit(onPadCreate)}>
              <button className="dialog-close-button" type="button" onClick={() => setCreatePadDialogOpen(false)}>×</button>
              <div style={{display: 'grid', gap: '10px', gridTemplateColumns: 'auto auto', marginBottom: '1rem'}}>
                <label><Trans i18nKey="ep_admin_pads:ep_adminpads2_padname"/></label>
                <input {...register('padName', {required: true})}/>
              </div>
              <input type="submit" value={t('admin_settings.create_pad')} className="login-button"/>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* ── Page header ── */}
      <div className="pm-header">
        <div>
          <div className="pm-crumbs">Admin <span className="pm-crumbs-sep">›</span> <Trans i18nKey="ep_admin_pads:ep_adminpads2_manage-pads"/></div>
          <h1 className="pm-title"><Trans i18nKey="ep_admin_pads:ep_adminpads2_manage-pads"/></h1>
          <p className="pm-subtitle"><Trans i18nKey="admin_pads.subtitle"/></p>
        </div>
        <div className="pm-header-actions">
          <button className="pm-btn pm-btn-ghost" onClick={() => settingsSocket?.emit('padLoad', searchParams)}>
            <RefreshCw size={14}/> <Trans i18nKey="admin_pads.refresh"/>
          </button>
          <button className="pm-btn pm-btn-primary" onClick={() => setCreatePadDialogOpen(true)}>
            <PlusIcon size={14}/> <Trans i18nKey="index.newPad"/>
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="pm-stats">
        <div className="pm-stat pm-stat--primary">
          <div className="pm-stat-label"><Trans i18nKey="admin_pads.stats.total"/></div>
          <div className="pm-stat-value">{pads?.total ?? '—'}</div>
          <div className="pm-stat-hint">{activeCount > 0
            ? t('admin_pads.stats.users_active', {count: activeCount})
            : t('admin_pads.stats.no_active_users')}</div>
        </div>
        <div className="pm-stat">
          <div className="pm-stat-label"><Trans i18nKey="admin_pads.stats.active_users"/></div>
          <div className="pm-stat-value">{totalUsers}</div>
          <div className="pm-stat-hint"><Trans i18nKey="admin_pads.stats.across_pads"/></div>
        </div>
        <div className={`pm-stat${emptyCount > 0 ? ' pm-stat--warn' : ''}`}>
          <div className="pm-stat-label"><Trans i18nKey="admin_pads.stats.empty_pads"/></div>
          <div className="pm-stat-value">{emptyCount}</div>
          <div className="pm-stat-hint"><Trans i18nKey="admin_pads.stats.revisions_zero"/></div>
          {emptyCount > 0 && (
            <button className="pm-stat-action" onClick={() => setFilter('empty')}>{t('admin_pads.show')} →</button>
          )}
        </div>
        <div className="pm-stat">
          <div className="pm-stat-label"><Trans i18nKey="admin_pads.stats.last_activity"/></div>
          <div className="pm-stat-value pm-stat-value--sm">
            {lastActivity ? relativeTime(t, lastActivity) : '—'}
          </div>
          <div className="pm-stat-hint">{pads?.results?.[0]?.padName ?? ''}</div>
        </div>
      </div>

      {/* ── Pads section ── */}
      <section className="pm-section">
        <div className="pm-section-header">
          <h2><Trans i18nKey="admin_pads.all_pads"/></h2>
          <span className="pm-count-badge">{visibleResults.length}</span>
          <div className="pm-spacer"/>
          <div className="pm-toolbar">
            <div className="pm-search">
              <Search size={14} className="pm-search-icon"/>
              <input
                className="pm-search-input"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder={t('ep_admin_pads:ep_adminpads2_search-heading')}
              />
              {searchTerm && (
                <button className="pm-search-clear" onClick={() => setSearchTerm('')}><X size={12}/></button>
              )}
            </div>
            <select
              className="pm-select"
              value={searchParams.sortBy}
              onChange={e => setSearchParams((sp) => ({
                ...sp,
                sortBy: e.target.value,
                // Keep current direction when only the column changes; the
                // ↑/↓ button below is the sole control for direction.
              }))}
            >
              <option value="lastEdited">{t('ep_admin_pads:ep_adminpads2_last-edited')}</option>
              <option value="padName">{t('admin_pads.sort.name')}</option>
              <option value="userCount">{t('admin_pads.sort.user_count')}</option>
              <option value="revisionNumber">{t('admin_pads.sort.revision_number')}</option>
            </select>
            <button
              className="pm-sort-dir"
              onClick={() => setSearchParams((sp) => ({
                ...sp,
                ascending: !sp.ascending,
              }))}
              title={t(searchParams.ascending
                ? 'admin_plugins.sort_ascending'
                : 'admin_plugins.sort_descending')}
              aria-label={t(searchParams.ascending
                ? 'admin_plugins.sort_ascending'
                : 'admin_plugins.sort_descending')}
            >
              {searchParams.ascending ? '↑' : '↓'}
            </button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="pm-chips">
          {PAD_FILTER_IDS.map(id => (
            <button key={id} className={`pm-chip${filter === id ? ' is-on' : ''}`} onClick={() => setFilter(id)}>
              {t(`admin_pads.filter.${id}`)}
            </button>
          ))}
        </div>

        {/* Bulk bar */}
        {selected.size > 0 && (
          <div className="pm-bulk">
            <span className="pm-bulk-count">{t('admin_pads.selected_count', {count: selected.size})}</span>
            <div className="pm-spacer"/>
            <button className="pm-btn pm-btn-ghost" onClick={() => {
              selected.forEach(name => cleanupPad(name))
              setSelected(new Set())
            }}>
              <History size={14}/> <Trans i18nKey="admin_pads.bulk.cleanup_history"/>
            </button>
            <button className="pm-btn pm-btn-danger" onClick={() => {
              selected.forEach(name => deletePad(name))
              setSelected(new Set())
            }}>
              <Trash2 size={14}/> <Trans i18nKey="admin_pads.bulk.delete"/>
            </button>
            <button className="pm-btn pm-btn-icon" onClick={() => setSelected(new Set())} title={t('admin_pads.bulk.clear_selection')}>
              <X size={14}/>
            </button>
          </div>
        )}

        {visibleResults.length > 0 ? (
          <div className="pm-table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{width: 40}}>
                    <label className="pm-check">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}/>
                    </label>
                  </th>
                  <th><Trans i18nKey="admin_pads.col.pad"/></th>
                  <th style={{width: 100, textAlign: 'center'}}><Trans i18nKey="admin_pads.col.users"/></th>
                  <th style={{width: 110, textAlign: 'right'}}><Trans i18nKey="admin_pads.col.revisions"/></th>
                  <th style={{width: 210}}><Trans i18nKey="ep_admin_pads:ep_adminpads2_last-edited"/></th>
                  <th style={{width: 170, textAlign: 'right'}}><Trans i18nKey="ep_admin_pads:ep_adminpads2_action"/></th>
                </tr>
              </thead>
              <tbody>
                {visibleResults.map(pad => {
                  const isEmpty = pad.revisionNumber === 0
                  const isSel = selected.has(pad.padName)
                  return (
                    <tr key={pad.padName} className={`${isSel ? 'is-sel' : ''} ${isEmpty ? 'is-empty' : ''}`}>
                      <td>
                        <label className="pm-check">
                          <input type="checkbox" checked={isSel} onChange={() => toggleOne(pad.padName)}/>
                        </label>
                      </td>
                      <td>
                        <div className="pm-pad-name">
                          <span className="pm-pad-mark" data-empty={isEmpty || undefined}>
                            <FileStack size={13}/>
                          </span>
                          <div>
                            <div className="pm-pad-title">{pad.padName}</div>
                            <div className="pm-pad-sub">
                              {isEmpty
                                ? t('admin_pads.empty_never_edited')
                                : t('admin_pads.revisions_count', {count: pad.revisionNumber})}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{textAlign: 'center'}}>
                        {pad.userCount > 0 ? (
                          <span className="pm-users-pill"><span className="pm-users-dot"/> {pad.userCount}</span>
                        ) : (
                          <span className="pm-users-pill is-muted">0</span>
                        )}
                      </td>
                      <td className="pm-num">{pad.revisionNumber.toLocaleString(locale)}</td>
                      <td>
                        <div className="pm-time">
                          <span className="pm-time-rel">{relativeTime(t, pad.lastEdited)}</span>
                          <span className="pm-time-abs">{fmtDate(locale, pad.lastEdited)}</span>
                        </div>
                      </td>
                      <td className="pm-cell-action">
                        <div className="pm-row-actions">
                          <button
                            className="pm-btn-icon"
                            title={t('ep_admin_pads:ep_adminpads2_cleanup')}
                            onClick={() => cleanupPad(pad.padName)}
                          >
                            <History size={14}/>
                          </button>
                          <button
                            className="pm-btn-icon pm-btn-icon--danger"
                            title={t('ep_admin_pads:ep_adminpads2_delete.value')}
                            onClick={() => { setPadToDelete(pad.padName); setDeleteDialog(true) }}
                          >
                            <Trash2 size={14}/>
                          </button>
                          <button
                            className="pm-btn pm-btn-primary pm-btn--sm"
                            onClick={() => window.open(`../../p/${pad.padName}`, '_blank')}
                          >
                            <Eye size={13}/> <Trans i18nKey="admin_pads.open"/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pm-empty">
            <div className="pm-empty-icon">∅</div>
            <div className="pm-empty-title"><Trans i18nKey="ep_admin_pads:ep_adminpads2_no-results"/></div>
          </div>
        )}

        {/* Pagination */}
        <div className="pm-pagination">
          <button
            className="pm-btn pm-btn-ghost"
            disabled={currentPage === 0}
            onClick={() => {
              const p = currentPage - 1
              setCurrentPage(p)
              setSearchParams((sp) => ({...sp, offset: p * sp.limit}))
            }}
          >
            <ChevronLeft size={14}/> <Trans i18nKey="admin_pads.pagination.previous"/>
          </button>
          <span className="pm-pagination-info">{currentPage + 1} / {pages || 1}</span>
          <button
            className="pm-btn pm-btn-ghost"
            disabled={pages === 0 || pages === currentPage + 1}
            onClick={() => {
              const p = currentPage + 1
              setCurrentPage(p)
              setSearchParams((sp) => ({...sp, offset: p * sp.limit}))
            }}
          >
            <Trans i18nKey="admin_pads.pagination.next"/> <ChevronRight size={14}/>
          </button>
        </div>
      </section>
    </div>
  )
}
