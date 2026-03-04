export type SocketClientRequest = {
    session: {
        user: {
            username: string;
            readOnly: boolean;
            padAuthorizations: {
                [key: string]: string;
            }
        }
    }
}


export type PadUserInfo = {
    data: {
        userInfo: {
            name: string|null;
            colorId: string;
        }
    }
}


export type ChangesetRequest = {
    data: {
        granularity: number;
        start: number;
        requestID: string;
    }
}
