import {Trans, useTranslation} from "react-i18next";
import {useEffect, useMemo, useState} from "react";
import {useStore} from "../store/store.ts";
import {PadSearchQuery, PadSearchResult} from "../utils/PadSearch.ts";
import {useDebounce} from "../utils/useDebounce.ts";
import * as Dialog from "@radix-ui/react-dialog";
import {ChevronLeft, ChevronRight, Eye, Trash2, FileStack, PlusIcon, Search, X, RefreshCw, History} from "lucide-react";
import {useForm} from "react-hook-form";

type PadCreateProps = { padName: string }
type FilterId = 'all' | 'active' | 'recent' | 'empty' | 'stale'

const PAD_FILTERS: {id: FilterId, label: string}[] = [
  {id: 'all',    label: 'Alle'},
  {id: 'active', label: 'Aktiv'},
  {id: 'recent', label: 'Diese Woche'},
  {id: 'empty',  label: 'Leer'},
  {id: 'stale',  label: 'Veraltet (>1J)'},
]

const isRecent = (ts: number) => (Date.now() - ts) < 86_400_000 * 7
const isStale  = (ts: number) => (Date.now() - ts) > 86_400_000 * 365

function relativeTime(ts: number): string {
  const d = (Date.now() - ts) / 1000
  if (d < 60)        return 'gerade eben'
  if (d < 3600)      return `vor ${Math.floor(d / 60)} Min`
  if (d < 86400)     return `vor ${Math.floor(d / 3600)} Std`
  if (d < 86400 * 7) return `vor ${Math.floor(d / 86400)} Tagen`
  if (d < 86400 * 30) return `vor ${Math.floor(d / 86400 / 7)} Wo`
  if (d < 86400 * 365) return `vor ${Math.floor(d / 86400 / 30)} Mon`
  return `vor ${Math.floor(d / 86400 / 365)} J`
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleDateString('de-DE', {day: '2-digit', month: 'short', year: 'numeric'}) +
    ' · ' +
    d.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})
  )
}

export const PadPage = () => {
  const settingsSocket = useStore(state => state.settingsSocket)
  const [searchParams, setSearchParams] = useState<PadSearchQuery>({
    offset: 0, limit: 12, pattern: '', sortBy: 'lastEdited', ascending: false,
  })
  const {t} = useTranslation()
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState<FilterId>('all')
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

  const filteredResults = useMemo(() => {
    const r = pads?.results ?? []
    if (filter === 'active') return r.filter(p => p.userCount > 0)
    if (filter === 'recent') return r.filter(p => isRecent(p.lastEdited))
    if (filter === 'empty')  return r.filter(p => p.revisionNumber === 0)
    if (filter === 'stale')  return r.filter(p => isStale(p.lastEdited))
    return r
  }, [pads, filter])

  const totalUsers  = useMemo(() => (pads?.results ?? []).reduce((s, p) => s + p.userCount, 0), [pads])
  const activeCount = useMemo(() => (pads?.results ?? []).filter(p => p.userCount > 0).length, [pads])
  const emptyCount  = useMemo(() => (pads?.results ?? []).filter(p => p.revisionNumber === 0).length, [pads])
  const lastActivity = useMemo(() => {
    const r = pads?.results ?? []
    return r.length ? Math.max(...r.map(p => p.lastEdited)) : null
  }, [pads])

  const allSelected = filteredResults.length > 0 && filteredResults.every(p => selected.has(p.padName))
  const toggleAll = () => {
    const s = new Set(selected)
    if (allSelected) filteredResults.forEach(p => s.delete(p.padName))
    else filteredResults.forEach(p => s.add(p.padName))
    setSelected(s)
  }
  const toggleOne = (name: string) => {
    const s = new Set(selected)
    s.has(name) ? s.delete(name) : s.add(name)
    setSelected(s)
  }

  useDebounce(() => {
    setSearchParams({...searchParams, pattern: searchTerm})
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
            <div>{t('ep_admin_pads:ep_adminpads2_confirm', {padID: padToDelete})}</div>
            <div className="settings-button-bar">
              <button onClick={() => setDeleteDialog(false)}>Abbrechen</button>
              <button onClick={() => { deletePad(padToDelete); setDeleteDialog(false) }}>OK</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={errorText !== null}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-confirm-overlay"/>
          <Dialog.Content className="dialog-confirm-content">
            <div>Fehler: {errorText}</div>
            <div className="settings-button-bar">
              <button onClick={() => setErrorText(null)}>OK</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={createPadDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-confirm-overlay"/>
          <Dialog.Content className="dialog-confirm-content">
            <Dialog.Title className="dialog-confirm-title"><Trans i18nKey="index.newPad"/></Dialog.Title>
            <form onSubmit={handleSubmit(onPadCreate)}>
              <button className="dialog-close-button" type="button" onClick={() => setCreatePadDialogOpen(false)}>×</button>
              <div style={{display: 'grid', gap: '10px', gridTemplateColumns: 'auto auto', marginBottom: '1rem'}}>
                <label><Trans i18nKey="ep_admin_pads:ep_adminpads2_padname"/></label>
                <input {...register('padName', {required: true})}/>
              </div>
              <input type="submit" value={t('admin_settings.createPad')} className="login-button"/>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* ── Page header ── */}
      <div className="pm-header">
        <div>
          <div className="pm-crumbs">Admin <span className="pm-crumbs-sep">›</span> Pads</div>
          <h1 className="pm-title"><Trans i18nKey="ep_admin_pads:ep_adminpads2_manage-pads"/></h1>
          <p className="pm-subtitle">Übersicht aller Pads dieser Etherpad-Instanz. Suchen, aufräumen, öffnen.</p>
        </div>
        <div className="pm-header-actions">
          <button className="pm-btn pm-btn-ghost" onClick={() => settingsSocket?.emit('padLoad', searchParams)}>
            <RefreshCw size={14}/> Aktualisieren
          </button>
          <button className="pm-btn pm-btn-primary" onClick={() => setCreatePadDialogOpen(true)}>
            <PlusIcon size={14}/> <Trans i18nKey="index.newPad"/>
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="pm-stats">
        <div className="pm-stat pm-stat--primary">
          <div className="pm-stat-label">Pads gesamt</div>
          <div className="pm-stat-value">{pads?.total ?? '—'}</div>
          <div className="pm-stat-hint">{activeCount > 0 ? `${activeCount} gerade aktiv` : 'Keine aktiven Nutzer'}</div>
        </div>
        <div className="pm-stat">
          <div className="pm-stat-label">Aktive Nutzer</div>
          <div className="pm-stat-value">{totalUsers}</div>
          <div className="pm-stat-hint">über alle Pads hinweg</div>
        </div>
        <div className={`pm-stat${emptyCount > 0 ? ' pm-stat--warn' : ''}`}>
          <div className="pm-stat-label">Leere Pads</div>
          <div className="pm-stat-value">{emptyCount}</div>
          <div className="pm-stat-hint">0 Revisionen</div>
          {emptyCount > 0 && (
            <button className="pm-stat-action" onClick={() => setFilter('empty')}>Anzeigen →</button>
          )}
        </div>
        <div className="pm-stat">
          <div className="pm-stat-label">Letzte Aktivität</div>
          <div className="pm-stat-value pm-stat-value--sm">
            {lastActivity ? relativeTime(lastActivity) : '—'}
          </div>
          <div className="pm-stat-hint">{pads?.results?.[0]?.padName ?? ''}</div>
        </div>
      </div>

      {/* ── Pads section ── */}
      <section className="pm-section">
        <div className="pm-section-header">
          <h2>Alle Pads</h2>
          <span className="pm-count-badge">{filteredResults.length}</span>
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
              onChange={e => setSearchParams({
                ...searchParams,
                sortBy: e.target.value,
                ascending: e.target.value === 'padName',
              })}
            >
              <option value="lastEdited">Zuletzt bearbeitet</option>
              <option value="padName">Name (A–Z)</option>
              <option value="userCount">Nutzer</option>
              <option value="revisionNumber">Revisionen</option>
            </select>
          </div>
        </div>

        {/* Filter chips */}
        <div className="pm-chips">
          {PAD_FILTERS.map(f => (
            <button key={f.id} className={`pm-chip${filter === f.id ? ' is-on' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Bulk bar */}
        {selected.size > 0 && (
          <div className="pm-bulk">
            <span className="pm-bulk-count">{selected.size} ausgewählt</span>
            <div className="pm-spacer"/>
            <button className="pm-btn pm-btn-ghost" onClick={() => {
              selected.forEach(name => cleanupPad(name))
              setSelected(new Set())
            }}>
              <History size={14}/> Historie aufräumen
            </button>
            <button className="pm-btn pm-btn-danger" onClick={() => {
              selected.forEach(name => deletePad(name))
              setSelected(new Set())
            }}>
              <Trash2 size={14}/> Löschen
            </button>
            <button className="pm-btn pm-btn-icon" onClick={() => setSelected(new Set())} title="Auswahl aufheben">
              <X size={14}/>
            </button>
          </div>
        )}

        {filteredResults.length > 0 ? (
          <div className="pm-table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{width: 40}}>
                    <label className="pm-check">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}/>
                    </label>
                  </th>
                  <th>Pad</th>
                  <th style={{width: 100, textAlign: 'center'}}>Nutzer</th>
                  <th style={{width: 110, textAlign: 'right'}}>Revisionen</th>
                  <th style={{width: 210}}>Zuletzt bearbeitet</th>
                  <th style={{width: 170, textAlign: 'right'}}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map(pad => {
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
                              {isEmpty ? 'leer · noch nie bearbeitet' : `${pad.revisionNumber} Revisionen`}
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
                      <td className="pm-num">{pad.revisionNumber.toLocaleString('de-DE')}</td>
                      <td>
                        <div className="pm-time">
                          <span className="pm-time-rel">{relativeTime(pad.lastEdited)}</span>
                          <span className="pm-time-abs">{fmtDate(pad.lastEdited)}</span>
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
                            <Eye size={13}/> Öffnen
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
            <div className="pm-empty-title">Keine Pads gefunden</div>
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
              setSearchParams({...searchParams, offset: p * searchParams.limit})
            }}
          >
            <ChevronLeft size={14}/> Zurück
          </button>
          <span className="pm-pagination-info">{currentPage + 1} / {pages || 1}</span>
          <button
            className="pm-btn pm-btn-ghost"
            disabled={pages === 0 || pages === currentPage + 1}
            onClick={() => {
              const p = currentPage + 1
              setCurrentPage(p)
              setSearchParams({...searchParams, offset: p * searchParams.limit})
            }}
          >
            Weiter <ChevronRight size={14}/>
          </button>
        </div>
      </section>
    </div>
  )
}
