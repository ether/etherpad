import {create} from "zustand";
import {Socket} from "socket.io-client";
import {PadSearchResult} from "../utils/PadSearch.ts";
import {InstalledPlugin} from "../pages/Plugin.ts";

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
}));
