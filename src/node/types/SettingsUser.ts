export type SettingsUser = {
    [username: string]:{
        password: string,
        is_admin?: boolean,
    }
}
