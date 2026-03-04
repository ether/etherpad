import {SettingsUser} from "./SettingsUser";

export type WebAccessTypes = {
    username?: string|null;
    password?: string;
    req:any;
    res:any;
    next:any;
    users: SettingsUser;
}
