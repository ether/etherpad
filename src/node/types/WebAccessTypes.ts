import {SettingsUser} from "./SettingsUser.js";

export type WebAccessTypes = {
  username?: string|null;
  password?: string;
  req:any;
  res:any;
  next:any;
  users: SettingsUser;
}
