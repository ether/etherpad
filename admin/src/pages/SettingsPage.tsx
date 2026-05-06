import React, { useState } from 'react';
import { useStore } from "../store/store.ts";
import { isJSONClean, cleanComments } from "../utils/utils.ts"; 
import { Trans } from "react-i18next";
import { IconButton } from "../components/IconButton.tsx";
import { RotateCw, Save, AlignLeft, ShieldCheck } from "lucide-react";

export const SettingsPage = () => {
  const settingsSocket = useStore(state => state.settingsSocket);
  
  // FIX: Initialize with empty string to prevent uncontrolled->controlled warning
  const settings = useStore(state => state.settings) ?? ""; 
  
  // FIX: New features disabled by default per project maintenance rules
  const [exposeExperimental] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart, selectionEnd, value } = e.currentTarget;
      const newValue = value.substring(0, selectionStart) + "  " + value.substring(selectionEnd);
      useStore.getState().setSettings(newValue);
      
      // Maintain cursor position after state update
      setTimeout(() => {
        e.currentTarget.selectionStart = e.currentTarget.selectionEnd = selectionStart + 2;
      }, 0);
    }
  };

  // Dry-run validation without saving
  const testJSON = () => {
    try {
      const cleaned = cleanComments(settings);
      JSON.parse(cleaned ?? ""); 
      useStore.getState().setToastState({
        open: true,
        title: "Validation Success: JSON is structurally sound.",
        success: true
      });
    } catch (e) {
      useStore.getState().setToastState({
        open: true,
        title: "Validation Failed: Check for syntax errors or stray characters.",
        success: false
      });
    }
  };

  const prettifyJSON = () => {
    try {
      const cleaned = cleanComments(settings); 
      const obj = JSON.parse(cleaned ?? "");
      const formatted = JSON.stringify(obj, null, 2);
      
      if (window.confirm("Prettifying will remove all comments. Do you wish to proceed?")) {
        useStore.getState().setSettings(formatted);
      }
    } catch (e) {
      useStore.getState().setToastState({
        open: true,
        title: "Cannot prettify: Please fix syntax errors first.",
        success: false
      });
    }
  };

  return (
    <div className="settings-page">
      <h1><Trans i18nKey="admin_settings.current" /></h1>
      
      <textarea
        value={settings}
        className="settings"
        spellCheck={false}
        onKeyDown={handleKeyDown}
        onChange={v => useStore.getState().setSettings(v.target.value)}
        style={{
          fontFamily: '"Fira Code", "Cascadia Code", monospace',
          width: '100%',
          height: '500px',
          padding: '15px',
          backgroundColor: '#1e1e1e',
          color: '#d4d4d4',
          lineHeight: '1.5',
          border: '1px solid #333',
          resize: 'vertical'
        }}
      />

      <div className="settings-button-bar">
        <IconButton 
          className="settingsButton" 
          icon={<Save />}
          title={<Trans i18nKey="admin_settings.current_save.value" />} 
          onClick={() => {
            // FIX: Separate validation logic from socket logic
            if (!isJSONClean(settings)) {
              useStore.getState().setToastState({
                open: true, title: "Syntax Error: Check commas and braces.", success: false
              });
              return;
            }
            if (!settingsSocket?.connected) {
              useStore.getState().setToastState({
                open: true, title: "Error: Not connected to server.", success: false
              });
              return;
            }
            settingsSocket.emit('saveSettings', settings);
            useStore.getState().setToastState({
              open: true, title: "Settings saved successfully.", success: true
            });
          }} 
        />

        {/* Dry-run Button */}
        <IconButton 
          className="settingsButton" 
          icon={<ShieldCheck />} 
          title="Test JSON (Dry-run)" 
          onClick={testJSON} 
        />
        
        {/* FIX: Feature Flag Gating */}
        {exposeExperimental && (
          <IconButton 
            className="settingsButton" 
            icon={<AlignLeft />} 
            title="Prettify JSON" 
            onClick={prettifyJSON} 
          />
        )}

        <IconButton 
          className="settingsButton" 
          icon={<RotateCw />}
          // FIX: Stable ID for Playwright automation
          data-testid="restart-etherpad-button" 
          title={<Trans i18nKey="admin_settings.current_restart.value" />} 
          onClick={() => {
            settingsSocket?.emit('restartServer');
          }} 
        />
      </div>
      
      <div className="separator" style={{ margin: '20px 0', borderBottom: '1px solid #eee' }} />
      
      <div className="settings-links" style={{ display: 'flex', gap: '20px' }}>
        {/* FIX: Protocol-independent URLs */}
        <a rel="noopener noreferrer" target="_blank" href="//github.com/ether/etherpad-lite/wiki/Example-Production-Settings.JSON">
          <Trans i18nKey="admin_settings.current_example-prod" />
        </a>
        <a rel="noopener noreferrer" target="_blank" href="//github.com/ether/etherpad-lite/wiki/Example-Development-Settings.JSON">
          <Trans i18nKey="admin_settings.current_example-devel" />
        </a>
      </div>
    </div>
  );
};