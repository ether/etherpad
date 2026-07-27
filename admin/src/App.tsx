import {useEffect, useState} from 'react'
import './App.css'
import {connect} from 'socket.io-client'
import {isJSONClean} from './utils/utils.ts'
import {NavLink, Outlet, useNavigate} from "react-router-dom";
import {useStore} from "./store/store.ts";
import {LoadingScreen} from "./utils/LoadingScreen.tsx";
import {Trans, useTranslation} from "react-i18next";
import {Cable, Construction, Crown, NotepadText, Wrench, PhoneCall, LucideMenu, Bell, Users} from "lucide-react";
import {UpdateBanner} from "./components/UpdateBanner";

const WS_URL = import.meta.env.DEV ? 'http://localhost:9001' : ''

export const App = () => {
  const setSettings = useStore(state => state.setSettings);
  const erasureEnabled = useStore(state => state.gdprAuthorErasureEnabled)
  const {t} = useTranslation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true)
  const updateStatus = useStore(state => state.updateStatus)
  const version = updateStatus?.currentVersion ?? null

  useEffect(() => {
    fetch('/admin-auth/', {method: 'POST'}).then((value) => {
      if (!value.ok) navigate('/login')
    }).catch(() => navigate('/login'))
  }, []);

  useEffect(() => {
    document.title = t('admin.page-title')
    useStore.getState().setShowLoading(true);

    const settingSocket = connect(`${WS_URL}/settings`, {transports: ['websocket']});
    const pluginsSocket = connect(`${WS_URL}/pluginfw/installer`, {transports: ['websocket']})
    // When the server explicitly rejects us for not being admin, we must
    // NOT reconnect on the subsequent `disconnect` event — otherwise the
    // socket cycles forever (connect → admin_auth_error → server
    // disconnect → SPA auto-reconnect → …). The flag is reset on each
    // successful connect.
    let authErrored = false;

    pluginsSocket.on('connect', () => {
      useStore.getState().setPluginsSocket(pluginsSocket);
    });

    settingSocket.on('connect', () => {
      authErrored = false;
      useStore.getState().setSettingsSocket(settingSocket);
      useStore.getState().setShowLoading(false)
      settingSocket.emit('load');
      console.log('connected');
    });

    settingSocket.on('disconnect', (reason) => {
      useStore.getState().setShowLoading(true)
      if (reason === 'io server disconnect' && !authErrored) settingSocket.connect();
    });

    settingSocket.on('settings', (settings: any) => {
      if (settings && typeof settings.flags === 'object' && settings.flags) {
        useStore.getState().setGdprAuthorErasureEnabled(
            !!settings.flags.gdprAuthorErasure);
      }
      if (settings.results === 'NOT_ALLOWED') {
        console.log('Not allowed to view settings.json')
        useStore.getState().setResolved(null);
        return;
      }
      if (isJSONClean(settings.results)) setSettings(settings.results);
      else alert(t('admin_settings.invalid_json'));
      // The resolved field is optional — old servers won't send it,
      // and the SPA degrades to today's behaviour when it's null.
      useStore.getState().setResolved(settings.resolved ?? null);
      useStore.getState().setShowLoading(false);
    });

    settingSocket.on('saveprogress', (status: string, payload?: {message?: string}) => {
      const {setToastState} = useStore.getState();
      if (status === 'saved') {
        setToastState({open: true, title: t('admin_settings.toast.saved'), success: true});
      } else {
        const detail = payload?.message ?? '';
        setToastState({open: true, title: t('admin_settings.toast.save_failed') + (detail ? ` (${detail})` : ''), success: false});
      }
    });

    // Backend emits this when the connecting socket does not have an
    // admin session. Previously the server just dropped silently, so the
    // SPA would sit on a loading screen with no clue. Surface it AND
    // suppress the automatic reconnect — without this flag the SPA would
    // immediately reconnect to a socket that will reject it again.
    settingSocket.on('admin_auth_error', (payload?: {message?: string}) => {
      authErrored = true;
      const {setToastState} = useStore.getState();
      setToastState({
        open: true,
        title: payload?.message || t('admin_settings.toast.auth_error'),
        success: false,
      });
      useStore.getState().setShowLoading(false);
    })

    return () => {
      settingSocket.disconnect();
      pluginsSocket.disconnect()
    }
  }, []);

  const closeOnMobile = () => {
    if (window.innerWidth < 768) setSidebarOpen(false)
  }

  return (
    <div id="wrapper" className={sidebarOpen ? '' : 'closed'}>
      <LoadingScreen/>
      <div className="menu">
        <div className="inner-menu">
          <div className="sidebar-top">
            <button
              className="sidebar-burger"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={t('admin.toggle_sidebar')}
            >
              <LucideMenu size={20}/>
            </button>
            {sidebarOpen && (
              <div className="sidebar-brand">
                <div className="sidebar-brand-mark"><Crown size={20} strokeWidth={1.8}/></div>
                <span className="sidebar-brand-name">Etherpad</span>
              </div>
            )}
          </div>

          <nav className="sidebar-nav" onClick={closeOnMobile}>
            <NavLink
              to="/plugins"
              className={({isActive}) => `sidebar-nav-item${isActive ? ' is-active' : ''}`}
              title={sidebarOpen ? undefined : t('admin_plugins')}
            >
              <span className="sidebar-nav-icon"><Cable size={18}/></span>
              {sidebarOpen && <span className="sidebar-nav-label"><Trans i18nKey="admin_plugins"/></span>}
            </NavLink>
            <NavLink
              to="/settings"
              className={({isActive}) => `sidebar-nav-item${isActive ? ' is-active' : ''}`}
              title={sidebarOpen ? undefined : t('admin_settings')}
            >
              <span className="sidebar-nav-icon"><Wrench size={18}/></span>
              {sidebarOpen && <span className="sidebar-nav-label"><Trans i18nKey="admin_settings"/></span>}
            </NavLink>
            <NavLink
              to="/help"
              className={({isActive}) => `sidebar-nav-item${isActive ? ' is-active' : ''}`}
              title={sidebarOpen ? undefined : t('admin_plugins_info')}
            >
              <span className="sidebar-nav-icon"><Construction size={18}/></span>
              {sidebarOpen && <span className="sidebar-nav-label"><Trans i18nKey="admin_plugins_info"/></span>}
            </NavLink>
            <NavLink
              to="/pads"
              className={({isActive}) => `sidebar-nav-item${isActive ? ' is-active' : ''}`}
              title={sidebarOpen ? undefined : undefined}
            >
              <span className="sidebar-nav-icon"><NotepadText size={18}/></span>
              {sidebarOpen && <span className="sidebar-nav-label"><Trans i18nKey="ep_admin_pads:ep_adminpads2_manage-pads"/></span>}
            </NavLink>
            {erasureEnabled && (
              <NavLink
                to="/authors"
                className={({isActive}) => `sidebar-nav-item${isActive ? ' is-active' : ''}`}
                title={sidebarOpen ? undefined : t('ep_admin_authors:title', {ns: 'ep_admin_authors'})}
              >
                <span className="sidebar-nav-icon"><Users size={18}/></span>
                {sidebarOpen && <span className="sidebar-nav-label"><Trans i18nKey="ep_admin_authors:title" ns="ep_admin_authors"/></span>}
              </NavLink>
            )}
            <NavLink
              to="/shout"
              className={({isActive}) => `sidebar-nav-item${isActive ? ' is-active' : ''}`}
              title={sidebarOpen ? undefined : t('admin.shout')}
            >
              <span className="sidebar-nav-icon"><PhoneCall size={18}/></span>
              {sidebarOpen && <span className="sidebar-nav-label"><Trans i18nKey="admin.shout"/></span>}
            </NavLink>
            <NavLink
              to="/update"
              className={({isActive}) => `sidebar-nav-item${isActive ? ' is-active' : ''}`}
              title={sidebarOpen ? undefined : t('update.page.title')}
            >
              <span className="sidebar-nav-icon"><Bell size={18}/></span>
              {sidebarOpen && <span className="sidebar-nav-label"><Trans i18nKey="update.page.title"/></span>}
            </NavLink>
          </nav>

          {sidebarOpen && (
            <div className="sidebar-footer">
              <div className="sidebar-footer-row">
                <span className="sidebar-status-dot"/>
                <span>{version ? `v${version}` : 'Etherpad'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="innerwrapper">
        <UpdateBanner/>
        <Outlet/>
      </div>
    </div>
  )
}

export default App
