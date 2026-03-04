import {Express} from "express";
import {MapArrayType} from "./MapType";
import {SettingsType} from "../utils/Settings";

export type ArgsExpressType = {
    app:Express,
    io: any,
    server:any
    settings: SettingsType
}
