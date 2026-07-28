'use strict';

// One rep.line(div) can be broken in more than one line in the browser.
// This function is useful to get the caret position of the line as
// is represented by the browser
//
// NOTE: every DOM lookup here has to go through the editor document that is
// passed in, *not* through the ambient `window` / `document`. This module is
// bundled into the pad's top-level window, while the caret lives in the
// ace_inner iframe nested inside ace_outer. Reading the top window's selection
// always yields an empty selection, which used to make getPosition() return
// null and crash the callers below (#8038).
import {Position, RepModel, RepNode} from "./types/RepModel";

export const getPosition = (doc: Document): Position | null => {
  const range = getSelectionRange(doc);
  if (!range || getBodyOf(range.endContainer)?.id !== 'innerdocbody') return null;
  // When there's a <br> or any element that has no height, we can't get the dimension of the
  // element where the caret is. As we can't get the element height, we create a text node to get
  // the dimensions on the position.
  const clonedRange = createSelectionRange(range);
  const shadowCaret = doc.createTextNode('|');
  clonedRange.insertNode(shadowCaret);
  clonedRange.selectNode(shadowCaret);
  const line = getPositionOfElementOrSelection(clonedRange);
  shadowCaret.remove();
  return line;
};

// The caret node is usually a text node, so climb to an element first.
const getBodyOf = (node: Node) => {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element ? element.closest('body') : null;
};

const createSelectionRange = (range: Range) => {
  const clonedRange = range.cloneRange();

  // we set the selection start and end to avoid error when user selects a text bigger than
  // the viewport height and uses the arrow keys to expand the selection. In this particular
  // case is necessary to know where the selections ends because both edges of the selection
  // is out of the viewport but we only use the end of it to calculate if it needs to scroll
  clonedRange.setStart(range.endContainer, range.endOffset);
  clonedRange.setEnd(range.endContainer, range.endOffset);
  return clonedRange;
};

const getPositionOfRepLineAtOffset = (node: any, offset: number, doc: Document) => {
  // it is not a text node, so we cannot make a selection
  if (node.tagName === 'BR' || node.tagName === 'EMPTY') {
    return getPositionOfElementOrSelection(node);
  }

  while (node.length === 0 && node.nextSibling) {
    node = node.nextSibling as any;
  }

  const newRange = doc.createRange();
  newRange.setStart(node, offset);
  newRange.setEnd(node, offset);
  const linePosition = getPositionOfElementOrSelection(newRange);
  newRange.detach(); // performance sake
  return linePosition;
};

const getPositionOfElementOrSelection = (element: Range):Position => {
  const rect = element.getBoundingClientRect();
  return {
    bottom: rect.bottom,
    height: rect.height,
    top: rect.top,
  } satisfies Position;
};

// here we have two possibilities:
// [1] the line before the caret line has the same type, so both of them has the same margin,
// padding height, etc. So, we can use the caret line to make calculation necessary to know
// where is the top of the previous line
// [2] the line before is part of another rep line. It's possible this line has different margins
// height. So we have to get the exactly position of the line
export const getPositionTopOfPreviousBrowserLine =
    (caretLinePosition: Position, rep: RepModel, doc: Document) => {
      let previousLineTop = caretLinePosition.top - caretLinePosition.height; // [1]
      const isCaretLineFirstBrowserLine =
        caretLineIsFirstBrowserLine(caretLinePosition.top, rep, doc);

      // the caret is in the beginning of a rep line, so the previous browser line
      // is the last line browser line of the a rep line
      if (isCaretLineFirstBrowserLine) { // [2]
        const lineBeforeCaretLine = rep.selStart[0] - 1;
        const firstLineVisibleBeforeCaretLine = getPreviousVisibleLine(lineBeforeCaretLine, rep);
        const linePosition =
          getDimensionOfLastBrowserLineOfRepLine(firstLineVisibleBeforeCaretLine, rep, doc);
        previousLineTop = linePosition.top;
      }
      return previousLineTop;
    };

const caretLineIsFirstBrowserLine = (caretLineTop: number, rep: RepModel, doc: Document) => {
  const caretRepLine = rep.selStart[0];
  const lineNode = rep.lines.atIndex(caretRepLine).lineNode;
  const firstRootNode = getFirstRootChildNode(lineNode);

  // to get the position of the node we get the position of the first char
  const positionOfFirstRootNode = getPositionOfRepLineAtOffset(firstRootNode, 1, doc);
  return positionOfFirstRootNode.top === caretLineTop;
};

// find the first root node, usually it is a text node
const getFirstRootChildNode = (node: RepNode) => {
  if (!node.firstChild) {
    return node;
  } else {
    return getFirstRootChildNode(node.firstChild);
  }
};

const getDimensionOfLastBrowserLineOfRepLine = (line: number, rep: RepModel, doc: Document) => {
  const lineNode = rep.lines.atIndex(line).lineNode;
  const lastRootChildNode = getLastRootChildNode(lineNode);

  // we get the position of the line in the last char of it
  const lastRootChildNodePosition =
    getPositionOfRepLineAtOffset(lastRootChildNode.node, lastRootChildNode.length, doc);
  return lastRootChildNodePosition;
};

const getLastRootChildNode = (node: RepNode) => {
  if (!node.lastChild) {
    return {
      node,
      length: node.length,
    };
  } else {
    return getLastRootChildNode(node.lastChild);
  }
};

// here we have two possibilities:
// [1] The next line is part of the same rep line of the caret line, so we have the same dimensions.
// So, we can use the caret line to calculate the bottom of the line.
// [2] the next line is part of another rep line.
// It's possible this line has different dimensions, so we have to get the exactly dimension of it
export const getBottomOfNextBrowserLine =
    (caretLinePosition: Position, rep: RepModel, doc: Document) => {
      let nextLineBottom = caretLinePosition.bottom + caretLinePosition.height; // [1]
      const isCaretLineLastBrowserLine =
        caretLineIsLastBrowserLineOfRepLine(caretLinePosition.top, rep, doc);

      // the caret is at the end of a rep line, so we can get the next browser line dimension
      // using the position of the first char of the next rep line
      if (isCaretLineLastBrowserLine) { // [2]
        const nextLineAfterCaretLine = rep.selStart[0] + 1;
        const firstNextLineVisibleAfterCaretLine = getNextVisibleLine(nextLineAfterCaretLine, rep);
        const linePosition =
          getDimensionOfFirstBrowserLineOfRepLine(firstNextLineVisibleAfterCaretLine, rep, doc);
        nextLineBottom = linePosition.bottom;
      }
      return nextLineBottom;
    };

const caretLineIsLastBrowserLineOfRepLine = (caretLineTop: number, rep: RepModel, doc: Document) => {
  const caretRepLine = rep.selStart[0];
  const lineNode = rep.lines.atIndex(caretRepLine).lineNode;
  const lastRootChildNode = getLastRootChildNode(lineNode);

  // we take a rep line and get the position of the last char of it
  const lastRootChildNodePosition =
    getPositionOfRepLineAtOffset(lastRootChildNode.node, lastRootChildNode.length, doc);
  return lastRootChildNodePosition.top === caretLineTop;
};

export const getPreviousVisibleLine = (line: number, rep: RepModel): number => {
  const firstLineOfPad = 0;
  if (line <= firstLineOfPad) {
    return firstLineOfPad;
  } else if (isLineVisible(line, rep)) {
    return line;
  } else {
    return getPreviousVisibleLine(line - 1, rep);
  }
};



export const getNextVisibleLine = (line: number, rep: RepModel): number => {
  const lastLineOfThePad = rep.lines.length() - 1;
  if (line >= lastLineOfThePad) {
    return lastLineOfThePad;
  } else if (isLineVisible(line, rep)) {
    return line;
  } else {
    return getNextVisibleLine(line + 1, rep);
  }
};

const isLineVisible = (line: number, rep: RepModel) => rep.lines.atIndex(line).lineNode.offsetHeight > 0;

const getDimensionOfFirstBrowserLineOfRepLine = (line: number, rep: RepModel, doc: Document) => {
  const lineNode = rep.lines.atIndex(line).lineNode;
  const firstRootChildNode = getFirstRootChildNode(lineNode);

  // we can get the position of the line, getting the position of the first char of the rep line
  const firstRootChildNodePosition = getPositionOfRepLineAtOffset(firstRootChildNode, 1, doc);
  return firstRootChildNodePosition;
};

const getSelectionRange = (doc: Document) => {
  const win = doc.defaultView;
  if (!win || !win.getSelection) {
    return null;
  }
  const selection = win.getSelection();
  if (selection && selection.type !== 'None' && selection.rangeCount > 0) {
    return selection.getRangeAt(0);
  } else {
    return null;
  }
};
