import React, { useState } from 'react';
import { useStore } from '../store/store';
import { isJSONClean, cleanComments } from '../utils/utils';
import { Trans, useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { RotateCw, Save, AlignLeft, ShieldCheck } from 'lucide-react';
import { FormView } from '../components/settings/FormView';
import { ModeToggle, type Mode } from '../components/settings/ModeToggle';

const TAB_INDENT = '  ';

export const SettingsPage = () => {
  const { t } = useTranslation();
  const settingsSocket = useStore(state => state.settingsSocket);
  const settings = useStore(state => state.settings) ?? '';

  const [mode, setMode] = useState<Mode>('form');
  const [exposeExperimental] = useState(false);

  // Tab in textarea inserts two spaces instead of moving focus; rAF restores caret position after React re-renders.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const target = e.currentTarget;
    const { selectionStart, selectionEnd, value } = target;
    const next = value.substring(0, selectionStart) + TAB_INDENT + value.substring(selectionEnd);
    useStore.getState().setSettings(next);
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + TAB_INDENT.length;
    });
  };

  const showToast = (titleKey: string, success: boolean) => {
    useStore.getState().setToastState({ open: true, title: t(titleKey), success });
  };

  const testJSON = () => {
    if (isJSONClean(settings)) showToast('admin_settings.toast.validation_ok', true);
    else showToast('admin_settings.toast.validation_failed', false);
  };

  const prettifyJSON = () => {
    try {
      const obj = JSON.parse(cleanComments(settings) ?? '');
      if (window.confirm(t('admin_settings.prettify_confirm'))) {
        useStore.getState().setSettings(JSON.stringify(obj, null, 2));
      }
    } catch {
      showToast('admin_settings.toast.prettify_failed', false);
    }
  };

  const handleSave = () => {
    if (!isJSONClean(settings)) return showToast('admin_settings.toast.json_invalid', false);
    if (!settingsSocket?.connected) return showToast('admin_settings.toast.disconnected', false);
    // Toast is shown by the saveprogress socket listener in App.tsx on server ack.
    settingsSocket.emit('saveSettings', settings);
  };

  return (
    <div className="settings-page">
      <h1><Trans i18nKey="admin_settings.current" /></h1>

      <ModeToggle mode={mode} onChange={setMode} />

      {mode === 'form'
        ? <FormView onSwitchToRaw={() => setMode('raw')} />
        : (
          <textarea
            value={settings}
            className="settings"
            data-testid="settings-raw-textarea"
            spellCheck={false}
            onKeyDown={handleKeyDown}
            onChange={v => useStore.getState().setSettings(v.target.value)}
          />
        )
      }

      <div className="settings-button-bar">
        <IconButton
          className="settingsButton"
          data-testid="save-settings-button"
          icon={<Save />}
          title={<Trans i18nKey="admin_settings.current_save.value" />}
          onClick={handleSave}
        />
        <IconButton
          className="settingsButton"
          data-testid="test-settings-button"
          icon={<ShieldCheck />}
          title={<Trans i18nKey="admin_settings.current_test.value" />}
          onClick={testJSON}
        />
        {exposeExperimental && (
          <IconButton
            className="settingsButton"
            data-testid="prettify-settings-button"
            icon={<AlignLeft />}
            title={<Trans i18nKey="admin_settings.current_prettify.value" />}
            onClick={prettifyJSON}
          />
        )}
        <IconButton
          className="settingsButton"
          data-testid="restart-etherpad-button"
          icon={<RotateCw />}
          title={<Trans i18nKey="admin_settings.current_restart.value" />}
          onClick={() => settingsSocket?.emit('restartServer')}
        />
      </div>

      <div className="settings-links">
        <a rel="noopener noreferrer" target="_blank" href="https://github.com/ether/etherpad/wiki/Example-Production-Settings.JSON">
          <Trans i18nKey="admin_settings.current_example-prod" />
        </a>
        <a rel="noopener noreferrer" target="_blank" href="https://github.com/ether/etherpad/wiki/Example-Development-Settings.JSON">
          <Trans i18nKey="admin_settings.current_example-devel" />
        </a>
      </div>
    </div>
  );
};
