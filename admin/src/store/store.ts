import {create} from "zustand";
import {Socket} from "socket.io-client";
import {PadSearchResult} from "../utils/PadSearch.ts";
import {AuthorSearchResult} from "../utils/AuthorSearch.ts";
import {InstalledPlugin} from "../pages/Plugin.ts";

export type Execution =
  | {status: 'idle'}
  | {status: 'preflight'; targetTag: string; startedAt: string}
  | {status: 'preflight-failed'; targetTag: string; reason: string; at: string}
  | {status: 'draining'; targetTag: string; drainEndsAt: string; startedAt: string}
  | {status: 'executing'; targetTag: string; fromSha: string; startedAt: string}
  | {status: 'pending-verification'; targetTag: string; fromSha: string; deadlineAt: string}
  | {status: 'verified'; targetTag: string; verifiedAt: string}
  | {status: 'rolling-back'; reason: string; targetTag: string; fromSha: string; at: string}
  | {status: 'rolled-back'; reason: string; targetTag: string; restoredSha: string; at: string}
  | {status: 'rollback-failed'; reason: string; targetTag: string; fromSha: string; at: string};

export type LastResult = null | {
  targetTag: string;
  fromSha: string;
  outcome: 'verified' | 'rolled-back' | 'rollback-failed' | 'preflight-failed' | 'cancelled';
  reason: string | null;
  at: string;
};

export interface UpdateStatusPayload {
  currentVersion: string;
  latest: null | {
    version: string;
    tag: string;
    body: string;
    publishedAt: string;
    prerelease: boolean;
    htmlUrl: string;
  };
  lastCheckAt: string | null;
  installMethod: string;
  tier: string;
  policy: null | {canNotify: boolean; canManual: boolean; canAuto: boolean; canAutonomous: boolean; reason: string};
  vulnerableBelow: Array<{announcedBy: string; threshold: string}>;
  // Tier 2 additions:
  execution: Execution;
  lastResult: LastResult;
  lockHeld: boolean;
}

type ToastState = {
  description?:string,
  title: string,
  open: boolean,
  success: boolean
}


type StoreState = {
  settings: string|undefined,
  setSettings: (settings: string) => void,
  settingsSocket: Socket|undefined,
  setSettingsSocket: (socket: Socket) => void,
  showLoading: boolean,
  setShowLoading: (show: boolean) => void,
  setPluginsSocket: (socket: Socket) => void
  pluginsSocket: Socket|undefined,
  toastState: ToastState,
  setToastState: (val: ToastState)=>void,
  pads: PadSearchResult|undefined,
  setPads: (pads: PadSearchResult)=>void,
  installedPlugins: InstalledPlugin[],
  setInstalledPlugins: (plugins: InstalledPlugin[])=>void,
  updateStatus: UpdateStatusPayload | null,
  setUpdateStatus: (s: UpdateStatusPayload) => void,
  updateLog: string,
  setUpdateLog: (log: string) => void,
  authors: AuthorSearchResult|undefined,
  setAuthors: (authors: AuthorSearchResult)=>void,
  gdprAuthorErasureEnabled: boolean,
  setGdprAuthorErasureEnabled: (enabled: boolean)=>void,
}


export const useStore = create<StoreState>()((set) => ({
  settings: undefined,
  setSettings: (settings: string) => set({settings}),
  settingsSocket: undefined,
  setSettingsSocket: (socket: Socket) => set({settingsSocket: socket}),
  showLoading: false,
  setShowLoading: (show: boolean) => set({showLoading: show}),
  pluginsSocket: undefined,
  setPluginsSocket: (socket: Socket) => set({pluginsSocket: socket}),
  setToastState: (val )=>set({toastState: val}),
  toastState: {
    open: false,
    title: '',
    description:'',
    success: false
  },
  pads: undefined,
  setPads: (pads)=>set({pads}),
  installedPlugins: [],
  setInstalledPlugins: (plugins)=>set({installedPlugins: plugins}),
  updateStatus: null,
  setUpdateStatus: (s) => set({updateStatus: s}),
  updateLog: '',
  setUpdateLog: (log) => set({updateLog: log}),
  authors: undefined,
  setAuthors: (authors)=>set({authors}),
  gdprAuthorErasureEnabled: false,
  setGdprAuthorErasureEnabled: (gdprAuthorErasureEnabled)=>set({gdprAuthorErasureEnabled}),
}));
