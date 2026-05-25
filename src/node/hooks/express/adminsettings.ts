'use strict';


import {PAD_FILTERS, PadFilter, PadQueryResult, PadSearchQuery} from "../../types/PadSearchQuery.js";
import log4js from 'log4js';

import { promises as fsp } from 'fs';
import hooks from '../../../static/js/pluginfw/hooks.js';
import plugins from '../../../static/js/pluginfw/plugins.js';
import settings, {getEpVersion, getGitCommit, reloadSettings} from '../../utils/Settings.js';
import {getLatestVersion} from '../../utils/UpdateCheck.js';
import {redactSettings} from '../../utils/AdminSettingsRedact.js';
import * as padManager from '../../db/PadManager.js';
import * as api from '../../db/API.js';
import * as authorManager from '../../db/AuthorManager.js';
import {deleteRevisions} from '../../utils/Cleanup.js';


const queryPadLimit = 12;
// Cap on concurrent `padManager.getPad()` calls while hydrating the pad
// universe for filter chip / non-name sort. The old per-sortBy handlers
// awaited each getPad sequentially (concurrency = 1); the unified
// pipeline used to issue Promise.all over the full candidate set, which
// can fan out to thousands of in-flight DB reads on busy deployments.
// 16 is empirically enough to saturate a single ueberDB driver without
// pushing the event loop into back-pressure.
const PAD_HYDRATE_CONCURRENCY = 16;
const logger = log4js.getLogger('adminSettings');

// Concurrency-limited Promise.all replacement. Preserves the input
// order in the returned array (caller slices later). Used by padLoad
// to bound DB reads during hydration.
async function mapWithConcurrency<T, R>(
    items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  const workers = Array.from({length: Math.min(limit, items.length)}, worker);
  await Promise.all(workers);
  return out;
}


export const socketio = (hookName: string, {io}: any) => {
  io.of('/settings').on('connection', (socket: any) => {
    // @ts-ignore
    const {session: {user: {is_admin: isAdmin} = {}} = {}} = socket.conn.request;
    if (!isAdmin) {
      // Previously this branch silently returned, so a non-admin client
      // (e.g. a misrouted Traefik / OIDC session that didn't carry the
      // admin cookie) would connect, emit load/save, and get nothing
      // back — no error toast, no way to tell the save was ignored. Emit
      // a dedicated event the SPA can surface, then drop the socket.
      socket.emit('admin_auth_error',
          {message: 'Not authenticated as admin. Re-authenticate and retry.'});
      socket.disconnect(true);
      return;
    }

    socket.on('load', async (query: string): Promise<any> => {
      let data;
      try {
        data = await fsp.readFile(settings.settingsFilename, 'utf8');
      } catch (err) {
        return logger.error(`Error loading settings: ${err}`);
      }
      const flags = {
        gdprAuthorErasure: !!(settings.gdprAuthorErasure &&
            settings.gdprAuthorErasure.enabled),
      };
      if (settings.showSettingsInAdminPage === false) {
        socket.emit('settings', {results: 'NOT_ALLOWED', flags});
      } else {
        const resolved = redactSettings(settings);
        socket.emit('settings', {results: data, resolved, flags});
      }
    });

    socket.on('saveSettings', async (newSettings: string) => {
      logger.info('Admin request to save settings through a socket on /admin/settings');
      try {
        await fsp.writeFile(settings.settingsFilename, newSettings);
        socket.emit('saveprogress', 'saved');
      } catch (err) {
        logger.error(`Error saving settings: ${err}`);
        socket.emit('saveprogress', 'error', {message: String(err)});
      }
    });


    type ShoutMessage = {
      message: string,
      sticky: boolean,
    }

    socket.on('shout', (message: ShoutMessage) => {
      const messageToSend = {
        type: "COLLABROOM",
        data: {
          type: "shoutMessage",
          payload: {
            message: message,
            timestamp: Date.now()
          }
        }
      }

      io.of('/settings').emit('shout', messageToSend);
      io.sockets.emit('shout', messageToSend);
    })


    socket.on('help', () => {
      const gitCommit = getGitCommit();
      const epVersion = getEpVersion();

      const hooks: Map<string, Map<string, string>> = plugins.getHooks('hooks', false);
      const clientHooks: Map<string, Map<string, string>> = plugins.getHooks('client_hooks', false);

      function mapToObject(map: Map<string, any>) {
        let obj = Object.create(null);
        for (let [k, v] of map) {
          if (v instanceof Map) {
            obj[k] = mapToObject(v);
          } else {
            obj[k] = v;
          }
        }
        return obj;
      }

      socket.emit('reply:help', {
        gitCommit,
        epVersion,
        installedPlugins: plugins.getPlugins(),
        installedParts: plugins.getParts(),
        installedServerHooks: mapToObject(hooks),
        installedClientHooks: mapToObject(clientHooks),
        latestVersion: getLatestVersion(),
      })
    });


    socket.on('padLoad', async (query: PadSearchQuery) => {
      const {padIDs} = await padManager.listAllPads();

      // ── 1. Pattern filter (cheap, by name only) ─────────────────────
      let candidateNames: string[] = padIDs;
      if (query.pattern) {
        candidateNames = candidateNames.filter(
            (padName: string) => padName.includes(query.pattern));
      }

      // ── 2. Resolve filter chip ──────────────────────────────────────
      // PadPage sends a chip id; "all" (default) means no additional
      // filtering. We accept missing values from older clients gracefully.
      const filter: PadFilter =
          (query.filter && PAD_FILTERS.includes(query.filter)) ? query.filter : 'all';

      // ── 3. Decide whether we need full metadata for every candidate ──
      // The fast path — name-sort with no filter chip — only needs to
      // hydrate metadata for the 12-row page slice. Any other path
      // (filter chip OR non-name sort) requires every candidate's revs
      // / users / lastEdited up front so we can sort and slice against
      // the right universe. The expensive call is `padManager.getPad`;
      // user counts come from an in-memory map.
      const needsFullScan = filter !== 'all' || query.sortBy !== 'padName';

      const loadMeta = async (padName: string): Promise<PadQueryResult> => {
        const pad = await padManager.getPad(padName);
        return {
          padName,
          lastEdited: await pad.getLastEdit(),
          userCount: api.padUsersCount(padName).padUsersCount,
          revisionNumber: pad.getHeadRevisionNumber(),
        };
      };

      // Lazily lifted so we don't load every pad twice on the fast path.
      let hydrated: PadQueryResult[] | null = null;
      const hydrateAll = async () => {
        if (hydrated == null) {
          hydrated = await mapWithConcurrency(
              candidateNames, PAD_HYDRATE_CONCURRENCY, loadMeta);
        }
        return hydrated;
      };

      // ── 4. Filter chip — applied to hydrated metadata ────────────────
      // Bucket boundaries match the client chips in PadPage.tsx so the
      // counts on the stats cards keep meaning the same thing. Compute
      // `now` once per request so a pad doesn't slip between buckets
      // mid-loop.
      const now = Date.now();
      const isRecent = (lastEdited: number) => now - lastEdited < 86_400_000 * 7;
      const isStale  = (lastEdited: number) => now - lastEdited > 86_400_000 * 365;
      const matchesFilter = (m: PadQueryResult) => {
        switch (filter) {
          case 'active': return m.userCount > 0;
          case 'recent': return isRecent(Number(m.lastEdited));
          case 'empty':  return m.revisionNumber === 0;
          case 'stale':  return isStale(Number(m.lastEdited));
          default:       return true;
        }
      };

      // ── 5. Total — i.e. the count the pagination footer reflects ────
      // For the fast path this is just the pattern-filtered name list;
      // for full-scan we report the post-chip total.
      let totalNames: string[] | null = needsFullScan ? null : candidateNames;
      let postFilterMetas: PadQueryResult[] | null = null;
      if (needsFullScan) {
        postFilterMetas = (await hydrateAll()).filter(matchesFilter);
      }
      const total = needsFullScan ? postFilterMetas!.length : totalNames!.length;

      // ── 6. Clamp offset/limit ──────────────────────────────────────
      const maxOffset = Math.max(total - 1, 0);
      if (query.offset && query.offset < 0) {
        query.offset = 0;
      } else if (query.offset > maxOffset) {
        query.offset = maxOffset;
      }
      if (query.limit && query.limit < 0) {
        query.limit = 0;
      } else if (query.limit > queryPadLimit) {
        query.limit = queryPadLimit;
      }

      // ── 7. Sort + slice ────────────────────────────────────────────
      const dir = query.ascending ? 1 : -1;
      const cmpStr = (a: string, b: string) => a < b ? -dir : a > b ? dir : 0;
      const cmpNum = (a: number, b: number) => a < b ? -dir : a > b ? dir : 0;

      let results: PadQueryResult[];
      if (needsFullScan) {
        const sorted = postFilterMetas!.sort((a, b) => {
          switch (query.sortBy) {
            case 'padName':        return cmpStr(a.padName, b.padName);
            case 'revisionNumber': return cmpNum(a.revisionNumber, b.revisionNumber);
            case 'userCount':      return cmpNum(a.userCount, b.userCount);
            case 'lastEdited':     return cmpStr(String(a.lastEdited), String(b.lastEdited));
            default:               return 0;
          }
        });
        results = sorted.slice(query.offset, query.offset + query.limit);
      } else {
        const sliceNames = totalNames!.sort(cmpStr).slice(query.offset, query.offset + query.limit);
        results = await Promise.all(sliceNames.map(loadMeta));
      }

      const data: {total: number, results?: PadQueryResult[]} = {total, results};
      socket.emit('results:padLoad', data);
    })


    socket.on('deletePad', async (padId: string) => {
      const padExists = await padManager.doesPadExists(padId);
      if (padExists) {
        logger.info(`Deleting pad: ${padId}`);
        const pad = await padManager.getPad(padId);
        await pad.remove();
        socket.emit('results:deletePad', padId);
      }
    })

   type PadCreationOptions = {
     padName: string,
   }

   socket.on('createPad', async ({padName}: PadCreationOptions)=>{
    const padExists = await padManager.doesPadExists(padName);
    if (padExists) {
     socket.emit('results:createPad', {
      error: 'Pad already exists',
     });
     return;
    }
    padManager.getPad(padName);
     socket.emit('results:createPad', {
      success: `Pad created ${padName}`,
     });
     return;
   })

    socket.on('cleanupPadRevisions', async (padId: string) => {
     if (!settings.cleanup.enabled) {
      socket.emit('results:cleanupPadRevisions', {
       error: 'Cleanup disabled. Enable cleanup in settings.json: cleanup.enabled => true',
      });
      return;
     }

     const padExists = await padManager.doesPadExists(padId);
     if (padExists) {
      logger.info(`Cleanup pad revisions: ${padId}`);
      try {
       const result = await deleteRevisions(padId, settings.cleanup.keepRevisions)
       if (result) {
        socket.emit('results:cleanupPadRevisions', {
         padId: padId,
         keepRevisions: settings.cleanup.keepRevisions,
        });
        logger.info('successful cleaned up pad: ', padId)
       } else {
        socket.emit('results:cleanupPadRevisions', {
         error: 'Error cleaning up pad',
        });
       }
      } catch (err: any) {
       logger.error(`Error in pad ${padId}: ${err.stack || err}`);
       socket.emit('results:cleanupPadRevisions', {
        error: err.toString(),
       });
       return;
      }
     }
    })

    // The admin author-erasure UI (PR #7667) is gated as a single
    // feature: when gdprAuthorErasure.enabled is false, all three
    // socket handlers refuse so the page is fully off by default per
    // project rule "new features behind a feature flag, disabled by
    // default" (Qodo Compliance ID 6). The destructive
    // anonymizeAuthor stays gated as before; the read paths
    // (authorLoad / preview) are also gated so listing data isn't
    // exposed without an explicit opt-in.
    const erasureEnabled = () =>
        !!(settings.gdprAuthorErasure && settings.gdprAuthorErasure.enabled);

    socket.on('authorLoad', async (payload: any) => {
      try {
        if (!erasureEnabled()) {
          socket.emit('results:authorLoad',
              {total: 0, results: [], error: 'disabled'});
          return;
        }
        const query = payload || {};
        const data = await authorManager.searchAuthors({
          pattern: query.pattern || '',
          offset: query.offset || 0,
          limit: query.limit || 12,
          sortBy: query.sortBy === 'lastSeen' ? 'lastSeen' : 'name',
          ascending: query.ascending !== false,
          includeErased: query.includeErased === true,
        });
        socket.emit('results:authorLoad', data);
      } catch (err: any) {
        logger.error(`authorLoad failed: ${err.stack || err}`);
        socket.emit('results:authorLoad',
            {total: 0, results: [], error: String(err.message || err)});
      }
    });

    socket.on('anonymizeAuthorPreview', async (payload: any) => {
      const authorID = payload?.authorID;
      try {
        if (!erasureEnabled()) {
          socket.emit('results:anonymizeAuthorPreview',
              {authorID, error: 'disabled'});
          return;
        }
        if (!authorID) {
          socket.emit('results:anonymizeAuthorPreview',
              {authorID, error: 'authorID is required'});
          return;
        }
        const rec = await authorManager.getAuthor(authorID);
        const counters =
            await authorManager.anonymizeAuthor(authorID, {dryRun: true});
        socket.emit('results:anonymizeAuthorPreview',
            {authorID, name: rec ? rec.name : null, ...counters});
      } catch (err: any) {
        logger.error(`anonymizeAuthorPreview failed: ${err.stack || err}`);
        socket.emit('results:anonymizeAuthorPreview',
            {authorID, error: String(err.message || err)});
      }
    });

    socket.on('anonymizeAuthor', async (payload: any) => {
      const authorID = payload?.authorID;
      try {
        if (!erasureEnabled()) {
          socket.emit('results:anonymizeAuthor', {authorID, error: 'disabled'});
          return;
        }
        if (!authorID) {
          socket.emit('results:anonymizeAuthor',
              {authorID, error: 'authorID is required'});
          return;
        }
        const counters = await authorManager.anonymizeAuthor(authorID);
        logger.info(`anonymizeAuthor (admin socket): ${authorID}`);
        socket.emit('results:anonymizeAuthor', {authorID, ...counters});
      } catch (err: any) {
        logger.error(`anonymizeAuthor failed: ${err.stack || err}`);
        socket.emit('results:anonymizeAuthor',
            {authorID, error: String(err.message || err)});
      }
    });

    socket.on('restartServer', async () => {
      logger.info('Admin request to restart server through a socket on /admin/settings');
      reloadSettings();
      await plugins.update();
      await hooks.aCallAll('loadSettings', {settings});
      await hooks.aCallAll('restartServer');
    });
  });
};


const searchPad = async (query: PadSearchQuery) => {

}
