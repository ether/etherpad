import {Attribute} from "./Attribute.js";
import AttributePool from "../AttributePool.js";

export type ChangeSetBuilder = {
  remove: (start: number, end?: number)=>void,
  keep: (start: number, end?: number, attribs?: Attribute[], pool?: AttributePool)=>void
}
