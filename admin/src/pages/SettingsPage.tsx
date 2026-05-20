import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { isJSONClean, cleanComments } from '../utils/utils';
import { Trans, useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { RotateCw, Save, AlignLeft, ShieldCheck, Info } from 'lucide-react';
import { FormView } from '../components/settings/FormView';
import { ModeToggle, type Mode } from '../components/settings/ModeToggle';

const TAB_INDENT = '  ';

// Heuristic: `${VAR}` or `${VAR:default}` in the file means the operator is
// running with env-var substitution (overwhelmingly Docker / Kubernetes).
// We use this to gate the Docker-aware UX (the explanatory banner and the
// Effective-config tab) so non-container installs see the existing UI
// unchanged. Conservative on purpose — false negatives just keep the old
// behaviour.
const ENV_VAR_PATTERN = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::[^}]*)?\}/;

export const SettingsPage = () => {
  const { t } = useTranslation();
  const settingsSocket = useStore(state => state.settingsSocket);
  const settings = useStore(state => state.settings) ?? '';
  const resolved = useStore(state => state.resolved);

  const usesEnvVars = useMemo(() => ENV_VAR_PATTERN.test(settings), [settings]);

  const [mode, setMode] = useState<Mode>('form');
  const [exposeExperimental] = useState(false);

  // The Effective tab is only meaningful when there is a `resolved`
  // payload AND the file uses substitution. Falling back to Raw on
  // either condition keeps the toggle honest if the user opens this
  // page against an older server.
  const canShowEffective = usesEnvVars && resolved != null;
  useEffect(() => {
    if (mode === 'effective' && !canShowEffective) setMode('raw');
  }, [mode, canShowEffective]);

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

  const effectiveJson = useMemo(() => {
    if (resolved == null) return '';
    try { return JSON.stringify(resolved, null, 2); } catch { return ''; }
  }, [resolved]);

  return (
    <div className="settings-page">
      <h1><Trans i18nKey="admin_settings.current" /></h1>

      {usesEnvVars && (
        <div
          className="settings-envvar-banner"
          role="note"
          data-testid="settings-envvar-banner"
        >
          <Info size={18} aria-hidden="true" />
          <div>
            <strong><Trans i18nKey="admin_settings.envvar_banner.title" /></strong>
            <p><Trans i18nKey="admin_settings.envvar_banner.body" /></p>
          </div>
        </div>
      )}

      <ModeToggle mode={mode} onChange={setMode} showEffective={canShowEffective} />

      {mode === 'form' && <FormView onSwitchToRaw={() => setMode('raw')} />}
      {mode === 'raw' && (
        <textarea
          value={settings}
          className="settings"
          data-testid="settings-raw-textarea"
          spellCheck={false}
          onKeyDown={handleKeyDown}
          onChange={v => useStore.getState().setSettings(v.target.value)}
        />
      )}
      {mode === 'effective' && (
        <textarea
          value={effectiveJson}
          className="settings"
          data-testid="settings-effective-textarea"
          spellCheck={false}
          readOnly
          aria-readonly="true"
        />
      )}

      <div className="settings-button-bar">
        {mode !== 'effective' && (
          <>
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
          </>
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
