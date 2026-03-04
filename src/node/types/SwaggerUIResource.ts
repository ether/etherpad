export type SwaggerUIResource = {
    [key: string]: {
        [secondKey: string]: {
            operationId: string,
            summary?: string,
            description?:string
            responseSchema?: object
        }
    }
}


export type OpenAPISuccessResponse = {
    [key: number] :{
        $ref: string,
        content?: {
            [key: string]: {
                schema: {
                    properties: {
                        data: {
                            type: string,
                            properties: object
                        }
                    }
                }
            }
        }
    }
}


export type OpenAPIOperations = {
    [key:string]: any
}