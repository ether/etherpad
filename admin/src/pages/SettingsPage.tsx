import {useStore} from "../store/store.ts";
import {isJSONClean, cleanComments} from "../utils/utils.ts";
import {Trans} from "react-i18next";
import {IconButton} from "../components/IconButton.tsx";
import {RotateCw, Save} from "lucide-react";

export const SettingsPage = ()=>{
    const settingsSocket = useStore(state=>state.settingsSocket)
    const settings = cleanComments(useStore(state=>state.settings))

    return <div className="settings-page">
        <h1><Trans i18nKey="admin_settings.current"/></h1>
        <textarea value={settings} className="settings" onChange={v => {
            useStore.getState().setSettings(v.target.value)
        }}/>
        <div className="settings-button-bar">
            <IconButton className="settingsButton" icon={<Save/>}
                        title={<Trans i18nKey="admin_settings.current_save.value"/>} onClick={() => {
                if (isJSONClean(settings!)) {
                    // JSON is clean so emit it to the server
                    settingsSocket!.emit('saveSettings', settings!);
                    useStore.getState().setToastState({
                        open: true,
                        title: "Successfully saved settings",
                        success: true
                    })
                } else {
                    useStore.getState().setToastState({
                        open: true,
                        title: "Error saving settings",
                        success: false
                    })
                }
            }}/>
            <IconButton className="settingsButton" icon={<RotateCw/>}
                        title={<Trans i18nKey="admin_settings.current_restart.value"/>} onClick={() => {
                settingsSocket!.emit('restartServer');
            }}/>
        </div>
        <div className="separator"/>
        <div className="settings-button-bar">
            <a rel="noopener noreferrer" target="_blank"
               href="https://github.com/ether/etherpad-lite/wiki/Example-Production-Settings.JSON"><Trans
                i18nKey="admin_settings.current_example-prod"/></a>
            <a rel="noopener noreferrer" target="_blank"
               href="https://github.com/ether/etherpad-lite/wiki/Example-Development-Settings.JSON"><Trans
                i18nKey="admin_settings.current_example-devel"/></a>
        </div>
    </div>
}
