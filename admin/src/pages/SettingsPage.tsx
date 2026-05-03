import { useStore } from "../store/store.ts";
import { isJSONClean } from "../utils/utils.ts";
import { Trans } from "react-i18next";
import { IconButton } from "../components/IconButton.tsx";
import { RotateCw, Save, AlignLeft } from "lucide-react"; // Added AlignLeft icon

export const SettingsPage = () => {
  const settingsSocket = useStore(state => state.settingsSocket)
  const settings = useStore(state => state.settings)

  // Handlers for better UX
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const value = e.currentTarget.value;
      
      // Insert 2 spaces (Etherpad standard)
      const newValue = value.substring(0, start) + "  " + value.substring(end);
      useStore.getState().setSettings(newValue);
      
      // Reset cursor position (needed after state update)
      setTimeout(() => {
        e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
      }, 0);
    }
  };

  const prettifyJSON = () => {
    try {
      // Note: This only works if there are NO comments. 
      const obj = JSON.parse(settings!);
      const formatted = JSON.stringify(obj, null, 2);
      useStore.getState().setSettings(formatted);
    } catch (e) {
      alert("Cannot prettify: JSON has syntax errors or comments.");
    }
  };

  return (
    <div className="settings-page">
      <h1><Trans i18nKey="admin_settings.current" /></h1>
      
      <div className="editor-container" style={{ border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <textarea
          value={settings}
          className="settings"
          spellCheck={false}
          onKeyDown={handleKeyDown} // Tab key support
          onChange={v => useStore.getState().setSettings(v.target.value)}
          style={{
            fontFamily: '"Fira Code", monospace',
            width: '100%',
            height: '500px',
            padding: '15px',
            backgroundColor: '#1e1e1e',
            color: '#d4d4d4',
            lineHeight: '1.5',
            border: 'none',
            outline: 'none',
            resize: 'vertical'
          }}
        />
      </div>

      <div className="settings-button-bar">
        <IconButton 
          className="settingsButton" 
          icon={<Save />}
          title={<Trans i18nKey="admin_settings.current_save.value" />} 
          onClick={() => {
            try {
              if (isJSONClean(settings!)) {
                settingsSocket!.emit('saveSettings', settings!);
                useStore.getState().setToastState({
                  open: true,
                  title: "Successfully saved settings",
                  success: true
                });
              } else {
                throw new Error();
              }
            } catch (err) {
              useStore.getState().setToastState({
                open: true,
                title: "Syntax Error: Check for missing commas or braces",
                success: false
              });
            }
          }} 
        />
        
        {/* NEW: Prettify Button */}
        <IconButton 
          className="settingsButton" 
          icon={<AlignLeft />} 
          title="Prettify JSON" 
          onClick={prettifyJSON} 
        />

        <IconButton 
          className="settingsButton" 
          icon={<RotateCw />}
          title={<Trans i18nKey="admin_settings.current_restart.value" />} 
          onClick={() => {
            settingsSocket!.emit('restartServer');
          }} 
        />
      </div>
      
      <div className="separator" />
      <div className="settings-button-bar">
        <a rel="noopener noreferrer" target="_blank" href="https://github.com/ether/etherpad-lite/wiki/Example-Production-Settings.JSON">
          <Trans i18nKey="admin_settings.current_example-prod" />
        </a>
        <a rel="noopener noreferrer" target="_blank" href="https://github.com/ether/etherpad-lite/wiki/Example-Development-Settings.JSON">
          <Trans i18nKey="admin_settings.current_example-devel" />
        </a>
      </div>
    </div>
  )
}