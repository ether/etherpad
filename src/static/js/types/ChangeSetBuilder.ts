import {Attribute} from "./Attribute";
import AttributePool from "../AttributePool";

export type ChangeSetBuilder = {
  remove: (start: number, end?: number)=>void,
  keep: (start: number, end?: number, attribs?: Attribute[], pool?: AttributePool)=>void
}
