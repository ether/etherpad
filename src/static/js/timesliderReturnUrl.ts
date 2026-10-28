'use strict';

/**
 * Resolve where the timeslider's "Return to pad" button navigates to.
 *
 * The referrer is only followed when it is a pad page on the same origin as
 * the timeslider. Anything else, including a cross-origin referrer that merely
 * has a `/p/` path, falls back to the pad the timeslider belongs to
 * (`{prefix}/p/{padId}/timeslider` -> `{prefix}/p/{padId}`). See
 * GHSA-35rj-7vrx-29wq.
 */
export const getReturnToPadUrl = (referrer: string, timesliderHref: string): string => {
  const here = new URL(timesliderHref);
  try {
    const ref = new URL(referrer);
    if (ref.origin === here.origin && ref.pathname.includes('/p/')) return ref.href;
  } catch {
    // Empty or unparsable referrer.
  }
  const pad = new URL(here.href);
  pad.pathname = pad.pathname.substring(0, pad.pathname.lastIndexOf('/'));
  pad.search = '';
  pad.hash = '';
  return pad.href;
};
