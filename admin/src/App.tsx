import {useEffect, useState} from 'react'
import './App.css'
import {connect} from 'socket.io-client'
import {isJSONClean} from './utils/utils.ts'
import {NavLink, Outlet, useNavigate} from "react-router-dom";
import {useStore} from "./store/store.ts";
import {LoadingScreen} from "./utils/LoadingScreen.tsx";
import {Trans, useTranslation} from "react-i18next";
import {Cable, Construction, Crown, NotepadText, Wrench, PhoneCall, LucideMenu} from "lucide-react";

const WS_URL = import.meta.env.DEV ? 'http://localhost:9001' : ''
export const App = () => {
  const setSettings = useStore(state => state.setSettings);
  const {t} = useTranslation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true)

  useEffect(() => {
    fetch('/admin-auth/', {
      method: 'POST'
    }).then((value) => {
      if (!value.ok) {
        navigate('/login')
      }
    }).catch(() => {
      navigate('/login')
    })
  }, []);

  useEffect(() => {
    document.title = t('admin.page-title')

    useStore.getState().setShowLoading(true);
    const settingSocket = connect(`${WS_URL}/settings`, {
      transports: ['websocket'],
    });

    const pluginsSocket = connect(`${WS_URL}/pluginfw/installer`, {
      transports: ['websocket'],
    })

    pluginsSocket.on('connect', () => {
      useStore.getState().setPluginsSocket(pluginsSocket);
    });


    settingSocket.on('connect', () => {
      useStore.getState().setSettingsSocket(settingSocket);
      useStore.getState().setShowLoading(false)
      settingSocket.emit('load');
      console.log('connected');
    });

    settingSocket.on('disconnect', (reason) => {
      // The settingSocket.io client will automatically try to reconnect for all reasons other than "io
      // server disconnect".
      useStore.getState().setShowLoading(true)
      if (reason === 'io server disconnect') {
        settingSocket.connect();
      }
    });

    settingSocket.on('settings', (settings) => {
      /* Check whether the settings.json is authorized to be viewed */
      if (settings.results === 'NOT_ALLOWED') {
        console.log('Not allowed to view settings.json')
        return;
      }

      /* Check to make sure the JSON is clean before proceeding */
      if (isJSONClean(settings.results)) {
        setSettings(settings.results);
      } else {
        alert('Invalid JSON');
      }
      useStore.getState().setShowLoading(false);
    });

    settingSocket.on('saveprogress', (status) => {
      console.log(status)
    })

    return () => {
      settingSocket.disconnect();
      pluginsSocket.disconnect()
    }
  }, []);

  return <div id="wrapper" className={`${sidebarOpen ? '': 'closed' }`}>
    <LoadingScreen/>
    <div className="menu">
      <div className="inner-menu">
        <span>
                    <Crown width={40} height={40}/>
                    <h1>Etherpad</h1>
                </span>
        <ul onClick={()=>{
          if (window.innerWidth < 768) {
            setSidebarOpen(false)
          }
        }}>
          <li><NavLink to="/plugins"><Cable/><Trans i18nKey="admin_plugins"/></NavLink></li>
          <li><NavLink to={"/settings"}><Wrench/><Trans i18nKey="admin_settings"/></NavLink></li>
          <li><NavLink to={"/help"}> <Construction/> <Trans i18nKey="admin_plugins_info"/></NavLink></li>
          <li><NavLink to={"/pads"}><NotepadText/><Trans
            i18nKey="ep_admin_pads:ep_adminpads2_manage-pads"/></NavLink></li>
          <li><NavLink to={"/shout"}><PhoneCall/>Communication</NavLink></li>
        </ul>
      </div>
    </div>
      <button id="icon-button" onClick={() => {
        setSidebarOpen(!sidebarOpen)
      }}><LucideMenu/></button>
    <div className="innerwrapper">
      <Outlet/>
    </div>
  </div>
}

export default App
