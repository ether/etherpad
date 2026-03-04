import {Trans, useTranslation} from "react-i18next";
import {useEffect, useMemo, useState} from "react";
import {useStore} from "../store/store.ts";
import {PadSearchQuery, PadSearchResult} from "../utils/PadSearch.ts";
import {useDebounce} from "../utils/useDebounce.ts";
import {determineSorting} from "../utils/sorting.ts";
import * as Dialog from "@radix-ui/react-dialog";
import {IconButton} from "../components/IconButton.tsx";
import {ChevronLeft, ChevronRight, Eye, Trash2, FileStack, PlusIcon} from "lucide-react";
import {SearchField} from "../components/SearchField.tsx";
import {useForm} from "react-hook-form";

type PadCreateProps = {
    padName: string
}

export const PadPage = ()=>{
    const settingsSocket = useStore(state=>state.settingsSocket)
    const [searchParams, setSearchParams] = useState<PadSearchQuery>({
        offset: 0,
        limit: 12,
        pattern: '',
        sortBy: 'padName',
        ascending: true
    })
    const {t} = useTranslation()
    const [searchTerm, setSearchTerm] = useState<string>('')
    const pads = useStore(state=>state.pads)
    const [currentPage, setCurrentPage] = useState<number>(0)
    const [deleteDialog, setDeleteDialog] = useState<boolean>(false)
    const [errorText, setErrorText] = useState<string|null>(null)
    const [padToDelete, setPadToDelete] = useState<string>('')
    const [createPadDialogOpen, setCreatePadDialogOpen] = useState<boolean>(false)
    const {register, handleSubmit} = useForm<PadCreateProps>()
    const pages = useMemo(()=>{
        if(!pads){
            return 0;
        }

        return Math.ceil(pads!.total / searchParams.limit)
    },[pads, searchParams.limit])

    useDebounce(()=>{
        setSearchParams({
            ...searchParams,
            pattern: searchTerm
        })

    }, 500, [searchTerm])

    useEffect(() => {
        if(!settingsSocket){
            return
        }

        settingsSocket.emit('padLoad', searchParams)

    }, [settingsSocket, searchParams]);

    useEffect(() => {
        if(!settingsSocket){
            return
        }

        settingsSocket.on('results:padLoad', (data: PadSearchResult)=>{
            useStore.getState().setPads(data);
        })


        settingsSocket.on('results:deletePad', (padID: string)=>{
            const newPads = useStore.getState().pads?.results?.filter((pad)=>{
                return pad.padName !== padID
            })
            useStore.getState().setPads({
                total: useStore.getState().pads!.total-1,
                results: newPads
            })
        })

      type SettingsSocketCreateReponse = {
          error: string
      } | {
        success: string
      }

      settingsSocket.on('results:createPad', (rep: SettingsSocketCreateReponse)=>{
        if ('error' in rep) {
          useStore.getState().setToastState({
            open: true,
            title: rep.error,
            success: false
          })
        } else {
          useStore.getState().setToastState({
            open: true,
            title: rep.success,
            success: true
          })
          setCreatePadDialogOpen(false)
          // reload pads
          settingsSocket.emit('padLoad', searchParams)
        }
      })

        settingsSocket.on('results:cleanupPadRevisions', (data)=>{
          const newPads = useStore.getState().pads?.results ?? []

          if (data.error) {
            setErrorText(data.error)
            return
          }

          newPads.forEach((pad)=>{
            if (pad.padName === data.padId) {
              pad.revisionNumber = data.keepRevisions
            }
          })

          useStore.getState().setPads({
            results: newPads,
            total: useStore.getState().pads!.total
          })
        })
    }, [settingsSocket, pads]);

    const deletePad = (padID: string)=>{
        settingsSocket?.emit('deletePad', padID)
    }

    const cleanupPad = (padID: string)=>{
        settingsSocket?.emit('cleanupPadRevisions', padID)
    }

    const onPadCreate = (data: PadCreateProps)=>{
      settingsSocket?.emit('createPad', {
        padName: data.padName
      })
    }


    return <div>
        <Dialog.Root open={deleteDialog}><Dialog.Portal>
            <Dialog.Overlay className="dialog-confirm-overlay" />
            <Dialog.Content  className="dialog-confirm-content">
                <div className="">
                    <div className=""></div>
                    <div className="">
                        {t("ep_admin_pads:ep_adminpads2_confirm", {
                        padID: padToDelete,
                        })}
                    </div>
                    <div className="settings-button-bar">
                        <button onClick={()=>{
                            setDeleteDialog(false)
                        }}>Cancel</button>
                        <button onClick={()=>{
                            deletePad(padToDelete)
                            setDeleteDialog(false)
                        }}>Ok</button>
                    </div>
                </div>
            </Dialog.Content>
        </Dialog.Portal>
        </Dialog.Root>
        <Dialog.Root open={errorText !== null}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-confirm-overlay"/>
            <Dialog.Content className="dialog-confirm-content">
              <div>
                <div>Error occured: {errorText}</div>
                <div className="settings-button-bar">
                  <button onClick={() => {
                    setErrorText(null)
                  }}>OK</button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      <Dialog.Root open={createPadDialogOpen}>
        <Dialog.Portal>
        <Dialog.Overlay className="dialog-confirm-overlay" />
        <Dialog.Content  className="dialog-confirm-content">
          <Dialog.Title className="dialog-confirm-title"><Trans i18nKey="index.newPad"/></Dialog.Title>
          <form  onSubmit={handleSubmit(onPadCreate)}>
            <button className="dialog-close-button" onClick={()=>{
              setCreatePadDialogOpen(false);
            }}>x</button>
              <div style={{display: 'grid', gap: '10px', gridTemplateColumns: 'auto auto', marginBottom: '1rem'}}>
                <label><Trans i18nKey="ep_admin_pads:ep_adminpads2_padname"/></label>
                <input {...register('padName', {
                  required: true
                })}/>
              </div>
            <input type="submit" value={t('admin_settings.createPad')} className="login-button" />
          </form>
        </Dialog.Content>
      </Dialog.Portal>
      </Dialog.Root>
      <span className="manage-pads-header">
                <h1><Trans i18nKey="ep_admin_pads:ep_adminpads2_manage-pads"/></h1>
        <span style={{width: '29px', marginBottom: 'auto', marginTop: 'auto', flexGrow: 1}}><IconButton style={{float: 'right'}} icon={<PlusIcon/>} title={<Trans i18nKey="index.newPad"/>} onClick={()=>{
          setCreatePadDialogOpen(true)
        }}/></span>
      </span>
        <SearchField value={searchTerm} onChange={v=>setSearchTerm(v.target.value)} placeholder={t('ep_admin_pads:ep_adminpads2_search-heading')}/>
        <table>
            <thead>
            <tr className="search-pads">
                <th className={determineSorting(searchParams.sortBy, searchParams.ascending, 'padName')} onClick={()=>{
                    setSearchParams({
                        ...searchParams,
                        sortBy: 'padName',
                        ascending: !searchParams.ascending
                    })
                }}><Trans i18nKey="ep_admin_pads:ep_adminpads2_padname"/></th>
                <th className={determineSorting(searchParams.sortBy, searchParams.ascending, 'userCount')} onClick={()=>{
                    setSearchParams({
                        ...searchParams,
                        sortBy: 'userCount',
                        ascending: !searchParams.ascending
                    })
                }}><Trans i18nKey="ep_admin_pads:ep_adminpads2_pad-user-count"/></th>
                <th className={determineSorting(searchParams.sortBy, searchParams.ascending, 'lastEdited')} onClick={()=>{
                    setSearchParams({
                        ...searchParams,
                        sortBy: 'lastEdited',
                        ascending: !searchParams.ascending
                    })
                }}><Trans i18nKey="ep_admin_pads:ep_adminpads2_last-edited"/></th>
                <th className={determineSorting(searchParams.sortBy, searchParams.ascending, 'revisionNumber')} onClick={()=>{
                    setSearchParams({
                        ...searchParams,
                        sortBy: 'revisionNumber',
                        ascending: !searchParams.ascending
                    })
                }}>Revision number</th>
                <th><Trans i18nKey="ep_admin_pads:ep_adminpads2_action"/></th>
            </tr>
            </thead>
            <tbody className="search-pads-body">
            {
                pads?.results?.map((pad)=>{
                    return <tr key={pad.padName}>
                        <td style={{textAlign: 'center'}}>{pad.padName}</td>
                        <td style={{textAlign: 'center'}}>{pad.userCount}</td>
                        <td style={{textAlign: 'center'}}>{new Date(pad.lastEdited).toLocaleString()}</td>
                        <td style={{textAlign: 'center'}}>{pad.revisionNumber}</td>
                        <td>
                            <div className="settings-button-bar">
                                <IconButton icon={<Trash2/>} title={<Trans i18nKey="ep_admin_pads:ep_adminpads2_delete.value"/>} onClick={()=>{
                                    setPadToDelete(pad.padName)
                                    setDeleteDialog(true)
                                }}/>
                                <IconButton icon={<FileStack/>} title={<Trans i18nKey="ep_admin_pads:ep_adminpads2_cleanup"/>} onClick={()=>{
                                  cleanupPad(pad.padName)
                                }}/>
                                <IconButton icon={<Eye/>} title={<Trans i18nKey="index.createOpenPad"/>} onClick={()=>window.open(`../../p/${pad.padName}`, '_blank')}/>
                            </div>
                        </td>
                    </tr>
                })
            }
            </tbody>
        </table>
        <div className="settings-button-bar pad-pagination">
            <button disabled={currentPage == 0} onClick={()=>{
                setCurrentPage(currentPage-1)
                    setSearchParams({
                        ...searchParams,
                        offset: (Number(currentPage)-1)*searchParams.limit})
            }}><ChevronLeft/><span>Previous Page</span></button>
            <span>{currentPage+1} out of {pages}</span>
            <button disabled={pages == 0 || pages == currentPage+1} onClick={()=>{
              const newCurrentPage = currentPage+1
                setCurrentPage(newCurrentPage)
                setSearchParams({
                    ...searchParams,
                    offset: (Number(newCurrentPage))*searchParams.limit
                })
            }}><span>Next Page</span><ChevronRight/></button>
        </div>
    </div>
}
