import {Trans, useTranslation} from "react-i18next";
import {useEffect, useMemo, useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {ChevronLeft, ChevronRight, Trash2} from "lucide-react";
import {useStore} from "../store/store.ts";
import {SearchField} from "../components/SearchField.tsx";
import {ColorSwatch} from "../components/ColorSwatch.tsx";
import {IconButton} from "../components/IconButton.tsx";
import {determineSorting} from "../utils/sorting.ts";
import {useDebounce} from "../utils/useDebounce.ts";
import {
  AnonymizePreview, AnonymizeResult, AuthorRow, AuthorSearchQuery,
  AuthorSearchResult, AuthorSortBy,
} from "../utils/AuthorSearch.ts";

type DialogState =
  | {phase: 'closed'}
  | {phase: 'loading-preview', authorID: string, name: string | null}
  | {phase: 'preview', preview: AnonymizePreview}
  | {phase: 'committing', preview: AnonymizePreview};

export const AuthorPage = () => {
  const {t} = useTranslation();
  const settingsSocket = useStore((s) => s.settingsSocket);
  const authors = useStore((s) => s.authors);
  const setAuthors = useStore((s) => s.setAuthors);
  const erasureEnabled = useStore((s) => s.gdprAuthorErasureEnabled);

  const [searchTerm, setSearchTerm] = useState('');
  const [includeErased, setIncludeErased] = useState(false);
  const [searchParams, setSearchParams] = useState<AuthorSearchQuery>({
    pattern: '', offset: 0, limit: 12,
    sortBy: 'name', ascending: true, includeErased: false,
  });
  const [currentPage, setCurrentPage] = useState(0);
  const [dialog, setDialog] = useState<DialogState>({phase: 'closed'});

  const pages = useMemo(() => {
    if (!authors) return 0;
    return Math.ceil(authors.total / searchParams.limit);
  }, [authors, searchParams.limit]);

  useDebounce(() => {
    setCurrentPage(0);
    setSearchParams((p) => ({...p, pattern: searchTerm, offset: 0}));
  }, 500, [searchTerm]);

  useEffect(() => {
    setSearchParams((p) => ({...p, includeErased, offset: 0}));
    setCurrentPage(0);
  }, [includeErased]);

  useEffect(() => {
    if (!settingsSocket) return;
    settingsSocket.emit('authorLoad', searchParams);
  }, [settingsSocket, searchParams]);

  useEffect(() => {
    if (!settingsSocket) return;
    const onLoad = (data: AuthorSearchResult) => setAuthors(data);
    const onPreview = (data: AnonymizePreview) => {
      if (data.error) {
        useStore.getState().setToastState({
          open: true, success: false,
          title: t('ep_admin_authors:erase-error-toast', {error: data.error}),
        });
        setDialog({phase: 'closed'});
        return;
      }
      setDialog((cur) =>
          cur.phase === 'loading-preview' && cur.authorID === data.authorID
              ? {phase: 'preview', preview: data}
              : cur);
    };
    const onErase = (data: AnonymizeResult) => {
      if (data.error) {
        useStore.getState().setToastState({
          open: true, success: false,
          title: t('ep_admin_authors:erase-error-toast', {error: data.error}),
        });
        setDialog({phase: 'closed'});
        return;
      }
      useStore.getState().setToastState({
        open: true, success: true,
        title: t('ep_admin_authors:erase-success-toast', {authorID: data.authorID}),
      });
      const cur = useStore.getState().authors;
      if (cur) {
        setAuthors({
          ...cur,
          results: cur.results.map((r): AuthorRow =>
              r.authorID === data.authorID
                  ? {...r, name: null, erased: true, mapper: []}
                  : r),
        });
      }
      setDialog({phase: 'closed'});
    };
    settingsSocket.on('results:authorLoad', onLoad);
    settingsSocket.on('results:anonymizeAuthorPreview', onPreview);
    settingsSocket.on('results:anonymizeAuthor', onErase);
    return () => {
      settingsSocket.off('results:authorLoad', onLoad);
      settingsSocket.off('results:anonymizeAuthorPreview', onPreview);
      settingsSocket.off('results:anonymizeAuthor', onErase);
    };
  }, [settingsSocket, setAuthors, t]);

  const sortBy = (col: AuthorSortBy) => () => {
    setCurrentPage(0);
    setSearchParams((p) => ({
      ...p, sortBy: col,
      ascending: p.sortBy === col ? !p.ascending : true,
      offset: 0,
    }));
  };

  const openErase = (row: AuthorRow) => {
    setDialog({phase: 'loading-preview', authorID: row.authorID, name: row.name});
    settingsSocket?.emit('anonymizeAuthorPreview', {authorID: row.authorID});
  };

  const commitErase = () => {
    if (dialog.phase !== 'preview') return;
    setDialog({phase: 'committing', preview: dialog.preview});
    settingsSocket?.emit('anonymizeAuthor', {authorID: dialog.preview.authorID});
  };

  const lastSeenLabel = (row: AuthorRow) =>
      row.lastSeen
          ? new Date(row.lastSeen).toLocaleString()
          : t('ep_admin_authors:never-seen');

  const mapperLabel = (row: AuthorRow) => {
    if (row.mapper.length === 0) return t('ep_admin_authors:no-mappers');
    if (row.mapper.length === 1) return row.mapper[0];
    return `${row.mapper[0]} +${row.mapper.length - 1}`;
  };

  return <div>
    {!erasureEnabled && (
      <div role="alert"
           style={{margin: '0 0 12px', padding: '12px',
                   background: '#fff8e1', border: '1px solid #f0c36d',
                   borderRadius: 4}}>
        <Trans i18nKey="ep_admin_authors:feature-disabled-banner"
               ns="ep_admin_authors"/>
      </div>
    )}

    <Dialog.Root open={dialog.phase !== 'closed'}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-confirm-overlay"/>
        <Dialog.Content className="dialog-confirm-content">
          {dialog.phase === 'loading-preview' && <div>
            <Trans i18nKey="ep_admin_authors:loading-preview" ns="ep_admin_authors"/>
          </div>}
          {(dialog.phase === 'preview' || dialog.phase === 'committing') && (() => {
            const p = dialog.preview;
            return <div>
              <Dialog.Title asChild>
                <h3>{t('ep_admin_authors:confirm-preview-title',
                    {name: p.name || p.authorID})}</h3>
              </Dialog.Title>
              <p>{t('ep_admin_authors:confirm-preview-counters', {
                tokenMappings: p.removedTokenMappings,
                externalMappings: p.removedExternalMappings,
                chatMessages: p.clearedChatMessages,
                affectedPads: p.affectedPads,
              })}</p>
              <p><strong>
                <Trans i18nKey="ep_admin_authors:confirm-irreversible"
                       ns="ep_admin_authors"/>
              </strong></p>
              <div className="settings-button-bar">
                <button onClick={() => setDialog({phase: 'closed'})}
                        disabled={dialog.phase === 'committing'}>
                  <Trans i18nKey="ep_admin_authors:cancel"
                         ns="ep_admin_authors"/>
                </button>
                <button onClick={commitErase}
                        disabled={dialog.phase === 'committing' || !erasureEnabled}
                        title={erasureEnabled ? undefined :
                            t('ep_admin_authors:erase-disabled-tooltip')}>
                  <Trans i18nKey="ep_admin_authors:continue"
                         ns="ep_admin_authors"/>
                </button>
              </div>
              {dialog.phase === 'committing' && <p style={{marginTop: 8}}>
                <Trans i18nKey="ep_admin_authors:erasing"
                       ns="ep_admin_authors"/>
              </p>}
            </div>;
          })()}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <span className="manage-pads-header">
      <h1>
        <Trans i18nKey="ep_admin_authors:title" ns="ep_admin_authors"/>
      </h1>
    </span>

    <SearchField value={searchTerm}
                 onChange={(v) => setSearchTerm(v.target.value)}
                 placeholder={t('ep_admin_authors:search-placeholder')}/>

    <label style={{display: 'inline-flex', alignItems: 'center', gap: 6,
                   margin: '8px 0'}}>
      <input type="checkbox" checked={includeErased}
             onChange={(e) => setIncludeErased(e.target.checked)}/>
      <Trans i18nKey="ep_admin_authors:show-erased" ns="ep_admin_authors"/>
    </label>

    {authors?.cappedAt != null && (
      <p style={{color: '#a35'}}>
        <Trans i18nKey="ep_admin_authors:cap-warning" ns="ep_admin_authors"/>
      </p>
    )}

    <table>
      <thead>
        <tr className="search-pads">
          <th><Trans i18nKey="ep_admin_authors:column.color" ns="ep_admin_authors"/></th>
          <th className={determineSorting(searchParams.sortBy, searchParams.ascending, 'name')}
              onClick={sortBy('name')}>
            <Trans i18nKey="ep_admin_authors:column.name" ns="ep_admin_authors"/>
          </th>
          <th><Trans i18nKey="ep_admin_authors:column.mapper" ns="ep_admin_authors"/></th>
          <th className={determineSorting(searchParams.sortBy, searchParams.ascending, 'lastSeen')}
              onClick={sortBy('lastSeen')}>
            <Trans i18nKey="ep_admin_authors:column.last-seen" ns="ep_admin_authors"/>
          </th>
          <th><Trans i18nKey="ep_admin_authors:column.author-id" ns="ep_admin_authors"/></th>
          <th><Trans i18nKey="ep_admin_authors:column.actions" ns="ep_admin_authors"/></th>
        </tr>
      </thead>
      <tbody className="search-pads-body">
      {authors?.results.length === 0 && <tr><td colSpan={6}
          style={{textAlign: 'center', padding: '12px'}}>
        <Trans i18nKey="ep_admin_authors:no-results" ns="ep_admin_authors"/>
      </td></tr>}
      {authors?.results.map((row) => (
        <tr key={row.authorID}>
          <td style={{textAlign: 'center'}}><ColorSwatch color={row.colorId}/></td>
          <td style={{textAlign: 'center'}}>
            {row.erased
                ? <em><Trans i18nKey="ep_admin_authors:erased-stub"
                             ns="ep_admin_authors"/></em>
                : (row.name ?? '—')}
          </td>
          <td style={{textAlign: 'center'}} title={row.mapper.join(', ')}>
            {mapperLabel(row)}
          </td>
          <td style={{textAlign: 'center'}}>{lastSeenLabel(row)}</td>
          <td style={{textAlign: 'center', fontFamily: 'monospace'}}>
            {row.authorID}
          </td>
          <td>
            <div className="settings-button-bar">
              <IconButton icon={<Trash2/>}
                          title={<Trans i18nKey="ep_admin_authors:erase"
                                        ns="ep_admin_authors"/>}
                          onClick={() => openErase(row)}
                          disabled={!erasureEnabled || row.erased}/>
            </div>
          </td>
        </tr>
      ))}
      </tbody>
    </table>

    <div className="settings-button-bar pad-pagination">
      <button disabled={currentPage === 0} onClick={() => {
        setCurrentPage(currentPage - 1);
        setSearchParams((p) => ({...p,
            offset: (currentPage - 1) * searchParams.limit}));
      }}><ChevronLeft/><span>
        <Trans i18nKey="ep_admin_authors:prev-page" ns="ep_admin_authors"/>
      </span></button>
      <span>{t('ep_admin_authors:page-counter',
          {current: currentPage + 1, total: pages})}</span>
      <button disabled={pages === 0 || pages === currentPage + 1} onClick={() => {
        const next = currentPage + 1;
        setCurrentPage(next);
        setSearchParams((p) => ({...p,
            offset: next * searchParams.limit}));
      }}><span>
        <Trans i18nKey="ep_admin_authors:next-page" ns="ep_admin_authors"/>
      </span><ChevronRight/></button>
    </div>
  </div>;
};
