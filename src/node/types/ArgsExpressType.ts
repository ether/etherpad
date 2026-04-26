import {Express} from "express";
import {MapArrayType} from "./MapType.js";
import {SettingsType} from "../utils/Settings.js";

export type ArgsExpressType = {
  app:Express,
  io: any,
  server:any
  settings: SettingsType
}
