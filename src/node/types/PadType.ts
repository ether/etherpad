import {MapArrayType} from "./MapType.js";
import AttributePool from "../../static/js/AttributePool.js";

export type PadType = {
  id: string,
  db?: any,
  padName?: string,
  chatHead: number,
  apool: ()=>AttributePool,
  atext: AText,
  pool: AttributePool,
  getInternalRevisionAText: (text:number|string)=>Promise<AText>,
  getValidRevisionRange: (fromRev: string|number, toRev: string|number)=>PadRange,
  getRevisionAuthor: (rev: number|string)=>Promise<string>,
  getRevision: (rev?: string|number)=>Promise<any>,
  head: number,
  getAllAuthorColors: ()=>Promise<MapArrayType<string>>,
  getAllAuthors: ()=>string[],
  remove: ()=>Promise<void>,
  text: ()=>string,
  setText: (text: string, authorId?: string)=>Promise<void>,
  appendText: (text: string, authorId?: string)=>Promise<void>,
  getHeadRevisionNumber: ()=>number,
  getRevisionDate: (rev: number|string)=>Promise<number>,
  getRevisionChangeset: (rev: number|string)=>Promise<AChangeSet>,
  appendRevision: (changeset: AChangeSet, author?: string)=>Promise<any>,
  getSavedRevisionsNumber: ()=>number,
  getSavedRevisionsList: ()=>string[],
  getSavedRevisions: ()=>any[],
  addSavedRevision: (revNum: string|number, savedById: string, label: string)=>Promise<void>,
  getPublicStatus: ()=>boolean,
  setPublicStatus: (publicStatus: boolean)=>Promise<void>,
  getPadSettings: ()=>any,
  setPadSettings: (rawPadSettings: any)=>void,
  saveToDatabase: ()=>Promise<void>,
  getLastEdit: ()=>Promise<number>,
  appendChatMessage: (msgOrText: any, authorId?: string|null, time?: number|null)=>Promise<void>,
  getChatMessage: (entryNum: number)=>Promise<any>,
  getChatMessages: (start: string|number, end: string|number)=>Promise<any[]>,
  copy: (destinationID: string, force: boolean|string)=>Promise<any>,
  copyPadWithoutHistory: (destinationID: string, force: string|boolean, authorId?: string)=>Promise<any>,
  init: (text?: string, authorId?: string)=>Promise<void>,
  check: ()=>Promise<void>,
  toJSON: ()=>any,
  spliceText?: (start:number, ndel:number, ins: string, authorId?: string)=>Promise<void>,
}


type PadRange = {
  startRev: string,
  endRev: string,
}


export type APool = {
  putAttrib: ([],flag?: boolean)=>number,
  numToAttrib: MapArrayType<any>,
  toJsonable: ()=>any,
  clone: ()=>APool,
  check: ()=>Promise<void>,
  eachAttrib: (callback: (key: string, value: any)=>void)=>void,
  getAttrib: (key: number)=>any,
}


export type AText = {
  text: string,
  attribs: any
}


export type PadAuthor = {

}

export type AChangeSet = {

}
