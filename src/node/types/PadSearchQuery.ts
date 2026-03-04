export type PadSearchQuery = {
    pattern: string;
    offset: number;
    limit: number;
    ascending: boolean;
    sortBy: "padName" | "lastEdited" | "userCount" | "revisionNumber";
}


export type PadQueryResult = {
    padName: string,
    lastEdited: string,
    userCount: number,
    revisionNumber: number
}
