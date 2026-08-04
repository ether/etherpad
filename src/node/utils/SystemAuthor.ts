'use strict';

/**
 * Stable author id used to attribute inserts coming from internal callers
 * (HTTP API setText/appendText/setHTML with no authorId, the default pad
 * content written on pad creation, server-side import flows, plugins like
 * ep_post_data). Without ANY author attribute, pad.atext.text and
 * pad.atext.attribs drift out of sync — clients then fail setDocAText
 * reconciliation in ace2_inner.ts when loading the pad.
 *
 * It is changeset bookkeeping, not a real contributor: there is deliberately
 * no `globalAuthor:a.etherpad-system` record in the database, so callers that
 * resolve pool authors to author records must skip it (see
 * `Pad.getAllAuthors()` consumers) rather than reporting it as missing.
 *
 * This lives in its own leaf module because `Pad.SYSTEM_AUTHOR_ID` cannot be
 * imported from the modules that need it without a circular require at module
 * init time (Pad -> padManager -> ImportEtherpad/ImportHtml -> Pad, and
 * PadMessageHandler -> padManager -> Pad), which previously forced each of
 * them to duplicate the literal.
 */
export const SYSTEM_AUTHOR_ID = 'a.etherpad-system';

/**
 * True iff `authorId` is the reserved system author.
 */
export const isSystemAuthor = (authorId: string|null|undefined): boolean =>
  authorId === SYSTEM_AUTHOR_ID;
