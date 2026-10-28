'use strict';

/**
 * Resolve where the timeslider's "Return to pad" button navigates to.
 *
 * The referrer is only followed when it is this timeslider's own pad page on
 * the same origin (so its query string, e.g. `?showChat=false`, is kept).
 * Anything else, including a cross-origin referrer that merely has a `/p/`
 * path, falls back to the pad the timeslider belongs to
 * (`{prefix}/p/{padId}/timeslider` -> `{prefix}/p/{padId}`). See
 * GHSA-35rj-7vrx-29wq.
 */
export const getReturnToPadUrl = (referrer: string, timesliderHref: string): string => {
  const pad = new URL(timesliderHref);
  pad.pathname = pad.pathname.substring(0, pad.pathname.lastIndexOf('/'));
  pad.search = '';
  pad.hash = '';
  try {
    const ref = new URL(referrer);
    if (ref.origin === pad.origin && ref.pathname === pad.pathname) return ref.href;
  } catch {
    // Empty or unparsable referrer.
  }
  return pad.href;
};
