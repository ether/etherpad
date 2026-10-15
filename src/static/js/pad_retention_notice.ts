'use strict';

import html10n from './vendors/html10n';

// clientVars.padRetention, set by src/node/utils/PadRetention.ts.
type RetentionInfo = null | undefined |
  {state: 'expiring', msRemaining: number} |
  {state: 'expired', deleteAfterDays: number};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const expiringText = (msRemaining: number): string => {
  // Round up so "0 days" never shows while there is still time left.
  if (msRemaining >= DAY_MS) {
    return html10n.get('pad.retention.expiring.days', {count: Math.ceil(msRemaining / DAY_MS)});
  }
  return html10n.get('pad.retention.expiring.hours',
      {count: Math.max(1, Math.ceil(msRemaining / HOUR_MS))});
};

export const showPadRetentionNotice = (info: RetentionInfo) => {
  if (info == null) return;
  const $ = (window as any).$;
  if (!$ || !$.gritter || typeof $.gritter.add !== 'function') return;

  if (info.state === 'expiring') {
    $.gritter.add({
      title: html10n.get('pad.retention.expiring.title'),
      text: expiringText(info.msRemaining),
      sticky: true,
      position: 'bottom',
      class_name: 'pad-retention-notice',
    });
  } else if (info.state === 'expired') {
    $.gritter.add({
      title: html10n.get('pad.retention.expired.title'),
      text: html10n.get('pad.retention.expired.text', {count: info.deleteAfterDays}),
      sticky: false,
      position: 'bottom',
      class_name: 'pad-retention-notice',
      time: 15000,
    });
  }
};

// End-to-end test hook, same as privacy_banner.ts: lets the Playwright spec
// drive the real function without a server configured for retention. Only
// set under webdriver, so real browsers never see it.
if (typeof navigator !== 'undefined' && (navigator as any).webdriver) {
  (globalThis as any).__etherpad_padRetention__ = {show: showPadRetentionNotice};
}
