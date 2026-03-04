export type RepModel = {
  lines: {
    atIndex: (num: number)=>RepNode,
    offsetOfIndex: (range: number)=>number,
    search: (filter: (e: RepNode)=>boolean)=>number,
    length: ()=>number
  }
  selStart: number[],
  selEnd: number[],
  selFocusAtStart: boolean
}

export type Position = {
  bottom: number,
  height: number,
  top: number
}

export type RepNode = {
  firstChild: RepNode,
  lineNode: RepNode
  length: number,
  lastChild: RepNode,
  offsetHeight: number,
  offsetTop: number
}

export type WindowElementWithScrolling = HTMLIFrameElement & {
  pageYOffset: number|string,
  pageXOffset: number
}
