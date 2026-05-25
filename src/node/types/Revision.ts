import {AChangeSet} from "./PadType.js";

export type Revision = {
  changeset: AChangeSet,
  meta: {
    author: string,
    timestamp: number,
  }
}
