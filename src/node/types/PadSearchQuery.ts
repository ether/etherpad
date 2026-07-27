export type PadFilter = "all" | "active" | "recent" | "empty" | "stale";

export const PAD_FILTERS: PadFilter[] = ["all", "active", "recent", "empty", "stale"];

export type PadSearchQuery = {
  pattern: string;
  offset: number;
  limit: number;
  ascending: boolean;
  sortBy: "padName" | "lastEdited" | "userCount" | "revisionNumber";
  // Filter chip. Defaults to "all". Applied server-side so pagination
  // reflects the filtered universe — without this, the chip filters only
  // the current page slice and "0 empty pads" can appear on page 1 while
  // page 2 has nothing but empties.
  filter?: PadFilter;
}


export type PadQueryResult = {
  padName: string,
  lastEdited: string,
  userCount: number,
  revisionNumber: number
}
