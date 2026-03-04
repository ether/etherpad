import {AChangeSet} from "./PadType";

export type Revision = {
  changeset: AChangeSet,
  meta: {
    author: string,
    timestamp: number,
  }
}
