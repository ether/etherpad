import {MapArrayType} from "../../../node/types/MapType";
import {AText} from "./AText";
import AttributePool from "../AttributePool";
import attributePool from "../AttributePool";
import ChatMessage from "../ChatMessage";
import {PadRevision} from "./PadRevision";

export type Part = {
  name: string,
  client_hooks: MapArrayType<string>,
  hooks: MapArrayType<string>
  pre?: string[]
  post?: string[]
  plugin?: string
}


export type MappedPlugin = Part& {
  plugin: string
  full_name: string
}

export type SocketIOMessage = {
  type: string
  accessStatus: string
}

export type HistoricalAuthorData = MapArrayType<{
  name: string;
  colorId: number;
  userId?: string
}>

export type ServerVar = {
  rev: number
  padId: string
  historicalAuthorData?: HistoricalAuthorData,
  initialAttributedText: {
    attribs: string
    text: string
  },
  apool: AttributePoolWire
  time: number
}

export type AttributePoolWire = {numToAttrib: {[p: number]: [string, string]}, nextNum: number}


export type UserInfo = {
  userId: string
  colorId: string,
  name: string|null
}

export type ClientVarPayload = {
  readOnlyId: string
  automaticReconnectionTimeout: number
  sessionRefreshInterval: number,
  atext?: AText,
  apool?: AttributePool,
  userName?: string,
  userColor: number,
  hideChat?: boolean,
  padOptions: PadOption,
  privacyBanner?: {
    enabled: boolean,
    title: string,
    body: string,
    learnMoreUrl: string | null,
    dismissal: 'dismissible' | 'sticky',
  },
  padId: string,
  colorPalette: string[],
  accountPrivs: {
    maxRevisions: number,
  },
  collab_client_vars: ServerVar,
  chatHead: number,
  readonly: boolean,
  serverTimestamp: number,
  initialOptions: PadOption,
  userId: string,
  canEditPadSettings?: boolean,
  enablePadWideSettings?: boolean,
  mode: string,
  randomVersionString: string,
  skinName: string
  skinVariants: string,
  exportAvailable: string
  docxExport: boolean
  savedRevisions: PadRevision[],
  initialRevisionList: number[],
  padShortcutEnabled: MapArrayType<boolean>,
  initialTitle: string,
  opts: {}
  numConnectedUsers: number
  canDeletePad?: boolean,
  padDeletionToken?: string | null,
  sofficeAvailable: string
  plugins: {
    plugins:  MapArrayType<any>
    parts:  MappedPlugin[]
  }
  indentationOnNewLine: boolean
  scrollWhenFocusLineIsOutOfViewport : {
    percentage: {
      editionAboveViewport: number,
      editionBelowViewport: number
    }
    duration: number
    scrollWhenCaretIsInTheLastLineOfViewport: boolean
    percentageToScrollWhenUserPressesArrowUp: number
  }
  initialChangesets: []
}

export type ClientVarData = {
  type: "CLIENT_VARS"
  data: ClientVarPayload
}

export type ClientNewChanges = {
  type : 'NEW_CHANGES'
  apool: AttributePool,
  author: string,
  changeset: string,
  newRev: number,
  payload?: ClientNewChanges
}

export type ClientAcceptCommitMessage = {
  type: 'ACCEPT_COMMIT'
  newRev: number
}

export type ClientConnectMessage = {
  type: 'CLIENT_RECONNECT',
  noChanges: boolean,
  headRev: number,
  newRev: number,
  changeset: string,
  author: string
  apool: AttributePool
}


export type UserNewInfoMessage = {
  type: 'USER_NEWINFO',
  data: {
    userInfo: UserInfo
  }
}

export type UserLeaveMessage = {
  type: 'USER_LEAVE'
  userInfo: UserInfo
}



export type ClientMessageMessage = {
  type: 'CLIENT_MESSAGE',
  payload: ClientSendMessages
}

export type ChatMessageMessage = {
  type: 'CHAT_MESSAGE'
  data: {
    message: ChatMessage
  }
}

export type ChatMessageMessages = {
  type: 'CHAT_MESSAGES'
  messages: string
}

export type ClientUserChangesMessage = {
  type: 'USER_CHANGES',
  baseRev: number,
  changeset: string,
  apool: attributePool
}



export type ClientSendMessages =  ClientUserChangesMessage |ClientReadyMessage| ClientSendUserInfoUpdate|ChatMessageMessage| ClientMessageMessage | GetChatMessageMessage |ClientSuggestUserName | NewRevisionListMessage | RevisionLabel | PadOptionsMessage| ClientSaveRevisionMessage

export type ClientReadyMessage = {
  type: 'CLIENT_READY',
  component: string,
  padId: string,
  sessionID: string,
  token: string,
  userInfo: UserInfo,
  padSettingsDefaults?: PadOption,
  reconnect?: boolean
  client_rev?: number
}

export type ClientSaveRevisionMessage = {
  type: 'SAVE_REVISION'
}


export type PadDeleteMessage = {
  type: 'PAD_DELETE'
  data: {
    padId: string
    deletionToken?: string
  }
}

export type GetChatMessageMessage = {
  type: 'GET_CHAT_MESSAGES',
  start: number,
  end: number
}

export type ClientSendUserInfoUpdate = {
  type: 'USERINFO_UPDATE',
  userInfo: UserInfo
}

export type ClientSuggestUserName = {
  type: 'suggestUserName',
  data: {
    payload: {
      unnamedId: string,
      newName: string
    }
  }
}

export type NewRevisionListMessage = {
  type: 'newRevisionList',
  revisionList: number[]
}

export type RevisionLabel = {
  type:  'revisionLabel'
  revisionList: number[]
}

export type PadOptionsMessage = {
  type: 'padoptions'
  options: PadOption
  changedBy: string
}

export type PadOption = {
  "noColors"?:         boolean,
  "showControls"?:     boolean,
  "showChat"?:         boolean,
  "showLineNumbers"?:  boolean,
  "useMonospaceFont"?: boolean,
  "userName"?:         null|string,
  "userColor"?:        null|string,
  "rtl"?:              boolean,
  "alwaysShowChat"?:   boolean,
  "chatAndUsers"?:     boolean,
  "lang"?:             null|string,
  view? : MapArrayType<boolean|string>,
  // Plugin-namespaced pad-wide options (gated by settings.enablePluginPadOptions).
  // The runtime regex is /^ep_[a-z0-9_]+$/ — TypeScript template literals
  // can't constrain that exactly, so this signature accepts any ep_-prefixed
  // string and applyPadSettings/normalizePadSettings reject the rest.
  [k: `ep_${string}`]: unknown,
}


type SharedMessageType = {
  payload:{
    timestamp: number
  }
}

export type x = {
  disconnect: boolean
}

export type ClientDisconnectedMessage = {
  type: "disconnected"
  disconnected: boolean
}

export type UserChanges = {
  data: ClientUserChangesMessage
}

export type UserSuggestUserName = {
  data: {
    payload: ClientSuggestUserName
  }
}

export type ChangesetRequestMessage = {
  type: 'CHANGESET_REQ'
  data: {
    granularity: number
    start: number
    requestID: string
  }
}



export type CollabroomMessage = {
  type: 'COLLABROOM'
  data: ClientSendUserInfoUpdate | ClientUserChangesMessage | ChatMessageMessage | GetChatMessageMessage | ClientSaveRevisionMessage | ClientMessageMessage | PadDeleteMessage
}

export type ClientVarMessage =  | ClientVarData | ClientDisconnectedMessage | ClientReadyMessage| ChangesetRequestMessage | CollabroomMessage | CustomMessage


export type CustomMessage = {
  type:  'CUSTOM'
  data: any
}

export type ClientCustomMessage = {
  type: 'CUSTOM',
  action: string,
  payload: any

}

export type SocketClientReadyMessage = {
  type: string
  component: string
  padId: string
  sessionID: string
  token: string
  userInfo: {
    colorId: string|null
    name: string|null
  },
  reconnect?: boolean
  client_rev?: number
}
