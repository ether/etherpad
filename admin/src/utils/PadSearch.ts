export type PadSearchQuery = {
    pattern: string;
    offset: number;
    limit: number;
    ascending: boolean;
    sortBy: string;
}


export type PadSearchResult = {
    total: number;
    results?: PadType[]
}

export type PadType = {
    padName: string;
    lastEdited: number;
    userCount: number;
    revisionNumber: number;
}
