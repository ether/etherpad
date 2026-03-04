'use strict';
import semver from 'semver';
import settings, {getEpVersion} from './Settings';
import axios from 'axios';
const headers = {
  'User-Agent': 'Etherpad/' + getEpVersion(),
}

type Infos = {
  latestVersion: string
}


const updateInterval = 60 * 60 * 1000; // 1 hour
let infos: Infos;
let lastLoadingTime: number | null = null;

const loadEtherpadInformations = () => {
  if (lastLoadingTime !== null && Date.now() - lastLoadingTime < updateInterval) {
    return infos;
  }

  return axios.get(`${settings.updateServer}/info.json`, {headers: headers})
  .then(async (resp: any) => {
    infos = await resp.data;
    if (infos === undefined || infos === null) {
      await Promise.reject("Could not retrieve current version")
      return
    }

    lastLoadingTime = Date.now();
    return infos;
  })
  .catch(async (err: Error) => {
    throw err;
  });
}


export const getLatestVersion = () => {
  needsUpdate().catch();
  return infos?.latestVersion;
};

const needsUpdate = async (cb?: Function) => {
  try {
    const info = await loadEtherpadInformations()
    if (semver.gt(info!.latestVersion, getEpVersion())) {
      if (cb) return cb(true);
    }
  } catch (err) {
    console.error(`Can not perform Etherpad update check: ${err}`);
    if (cb) return cb(false);
  }
};

export const check = () => {
  needsUpdate((needsUpdate: boolean) => {
    if (needsUpdate) {
      console.warn(`Update available: Download the actual version ${infos.latestVersion}`);
    }
  }).then(()=>{});
};
