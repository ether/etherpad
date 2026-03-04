export type ShoutType = {
    type: string,
    data:{
        type: string,
        payload: {
            message: {
                message: string,
                sticky: boolean
            },
            timestamp: number
        }
    }
}
