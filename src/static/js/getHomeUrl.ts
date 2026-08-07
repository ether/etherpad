'use strict';

/**
 * Resolve the Etherpad home URL from a pad URL.
 *
 * Pad pages live at `{prefix}/p/{padId}`. One `..` segment removes the pad id
 * and lands on `{prefix}/`, which is correct both for root deployments
 * (`/p/testpad` -> `/`) and reverse-proxy prefixes (`/etherpad/p/testpad`
 * -> `/etherpad/`). See issue #8111.
 */
export const getHomeUrl = (fromHref: string): string =>
  new URL('..', fromHref).href;
