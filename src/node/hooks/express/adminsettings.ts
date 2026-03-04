'use strict';


import {PadQueryResult, PadSearchQuery} from "../../types/PadSearchQuery";
import log4js from 'log4js';

const fsp = require('fs').promises;
const hooks = require('../../../static/js/pluginfw/hooks');
const plugins = require('../../../static/js/pluginfw/plugins');
import settings, {getEpVersion, getGitCommit, reloadSettings} from '../../utils/Settings';
import {getLatestVersion} from '../../utils/UpdateCheck';
const padManager = require('../../db/PadManager');
const api = require('../../db/API');
import {deleteRevisions} from '../../utils/Cleanup';


const queryPadLimit = 12;
const logger = log4js.getLogger('adminSettings');


exports.socketio = (hookName: string, {io}: any) => {
    io.of('/settings').on('connection', (socket: any) => {
        // @ts-ignore
        const {session: {user: {is_admin: isAdmin} = {}} = {}} = socket.conn.request;
        if (!isAdmin) return;

        socket.on('load', async (query: string): Promise<any> => {
            let data;
            try {
                data = await fsp.readFile(settings.settingsFilename, 'utf8');
            } catch (err) {
                return logger.error(`Error loading settings: ${err}`);
            }
            // if showSettingsInAdminPage is set to false, then return NOT_ALLOWED in the result
            if (settings.showSettingsInAdminPage === false) {
                socket.emit('settings', {results: 'NOT_ALLOWED'});
            } else {
                socket.emit('settings', {results: data});
            }
        });

        socket.on('saveSettings', async (newSettings: string) => {
            logger.info('Admin request to save settings through a socket on /admin/settings');
            try {
                await fsp.writeFile(settings.settingsFilename, newSettings);
            } catch (err) {
                logger.error(`Error saving settings: ${err}`);
            }
            socket.emit('saveprogress', 'saved');
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

            const data: {
                total: number,
                results?: PadQueryResult[]
            } = {
                total: padIDs.length,
            };
            let result: string[] = padIDs;
            let maxResult;

            // Filter out matches
            if (query.pattern) {
                result = result.filter((padName: string) => padName.includes(query.pattern));
            }

            data.total = result.length;

            maxResult = result.length - 1;
            if (maxResult < 0) {
                maxResult = 0;
            }

            // Reset to default values if out of bounds
            if (query.offset && query.offset < 0) {
                query.offset = 0;
            } else if (query.offset > maxResult) {
                query.offset = maxResult;
            }

            if (query.limit && query.limit < 0) {
              // Too small
                query.limit = 0;
            } else if (query.limit > queryPadLimit) {
              // Too big
                query.limit = queryPadLimit;
            }


            if (query.sortBy === 'padName') {
                result = result.sort((a, b) => {
                    if (a < b) return query.ascending ? -1 : 1;
                    if (a > b) return query.ascending ? 1 : -1;
                    return 0;
                }).slice(query.offset, query.offset + query.limit);

                data.results = await Promise.all(result.map(async (padName: string) => {
                    const pad = await padManager.getPad(padName);
                    const revisionNumber = pad.getHeadRevisionNumber()
                    const userCount = api.padUsersCount(padName).padUsersCount;
                    const lastEdited = await pad.getLastEdit();

                    return {
                        padName,
                        lastEdited,
                        userCount,
                        revisionNumber
                    }
                }));
            } else if (query.sortBy === "revisionNumber") {
                const currentWinners: PadQueryResult[] = []
                const padMapping = [] as {padId: string, revisionNumber: number}[]
                for (let res of result) {
                    const pad = await padManager.getPad(res);
                    const revisionNumber = pad.getHeadRevisionNumber()
                    padMapping.push({padId: res, revisionNumber})
                }
                padMapping.sort((a, b) => {
                    if (a.revisionNumber < b.revisionNumber) return query.ascending ? -1 : 1;
                    if (a.revisionNumber > b.revisionNumber) return query.ascending ? 1 : -1;
                    return 0;
                })

              for (const padRetrieval of padMapping.slice(query.offset, query.offset + query.limit)) {
                let pad = await padManager.getPad(padRetrieval.padId);
                currentWinners.push({
                  padName: padRetrieval.padId,
                  lastEdited: await pad.getLastEdit(),
                  userCount: api.padUsersCount(pad.padName).padUsersCount,
                  revisionNumber: padRetrieval.revisionNumber
                })
              }

              data.results = currentWinners;
            } else if (query.sortBy === "userCount") {
              const currentWinners: PadQueryResult[] = []
              const padMapping = [] as {padId: string, userCount: number}[]
              for (let res of result) {
                const userCount = api.padUsersCount(res).padUsersCount
                padMapping.push({padId: res, userCount})
              }
              padMapping.sort((a, b) => {
                if (a.userCount < b.userCount) return query.ascending ? -1 : 1;
                if (a.userCount > b.userCount) return query.ascending ? 1 : -1;
                return 0;
              })

              for (const padRetrieval of padMapping.slice(query.offset, query.offset + query.limit)) {
                let pad = await padManager.getPad(padRetrieval.padId);
                currentWinners.push({
                  padName: padRetrieval.padId,
                  lastEdited: await pad.getLastEdit(),
                  userCount: padRetrieval.userCount,
                  revisionNumber: pad.getHeadRevisionNumber()
                })
              }
              data.results = currentWinners;
            } else if (query.sortBy === "lastEdited") {
              const currentWinners: PadQueryResult[] = []
              const padMapping = [] as {padId: string, lastEdited: string}[]
              for (let res of result) {
                const pad = await padManager.getPad(res);
                const lastEdited = await pad.getLastEdit();
                padMapping.push({padId: res, lastEdited})
              }
              padMapping.sort((a, b) => {
                if (a.lastEdited < b.lastEdited) return query.ascending ? -1 : 1;
                if (a.lastEdited > b.lastEdited) return query.ascending ? 1 : -1;
                return 0;
              })

              for (const padRetrieval of padMapping.slice(query.offset, query.offset + query.limit)) {
                let pad = await padManager.getPad(padRetrieval.padId);
                currentWinners.push({
                  padName: padRetrieval.padId,
                  lastEdited: padRetrieval.lastEdited,
                  userCount: api.padUsersCount(pad.padName).padUsersCount,
                  revisionNumber: pad.getHeadRevisionNumber()
                })
              }
              data.results = currentWinners;
            }

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
