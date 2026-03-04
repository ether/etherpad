import {splitTextLines} from "./Changeset";

/**
 * Class to iterate and modify texts which have several lines. It is used for applying Changesets on
 * arrays of lines.
 *
 * Mutation operations have the same constraints as exports operations with respect to newlines, but
 * not the other additional constraints (i.e. ins/del ordering, forbidden no-ops, non-mergeability,
 * final newline). Can be used to mutate lists of strings where the last char of each string is not
 * actually a newline, but for the purposes of N and L values, the caller should pretend it is, and
 * for things to work right in that case, the input to the `insert` method should be a single line
 * with no newlines.
 */
class TextLinesMutator {
  private _lines: string[];
  private _curSplice: [number, number?];
  private _inSplice: boolean;
  private _curLine: number;
  private _curCol: number;
  /**
   * @param {(string[]|StringArrayLike)} lines - Lines to mutate (in place).
   */
  constructor(lines: string[]) {
    this._lines = lines;
    /**
     * this._curSplice holds values that will be passed as arguments to this._lines.splice() to
     * insert, delete, or change lines:
     *   - this._curSplice[0] is an index into the this._lines array.
     *   - this._curSplice[1] is the number of lines that will be removed from the this._lines array
     *     starting at the index.
     *   - The other elements represent mutated (changed by ops) lines or new lines (added by ops)
     *     to insert at the index.
     *
     * @type {[number, number?, ...string[]?]}
     */
    this._curSplice = [0, 0];
    this._inSplice = false;
    // position in lines after curSplice is applied:
    this._curLine = 0;
    this._curCol = 0;
    // invariant: if (inSplice) then (curLine is in curSplice[0] + curSplice.length - {2,3}) &&
    //            curLine >= curSplice[0]
    // invariant: if (inSplice && (curLine >= curSplice[0] + curSplice.length - 2)) then
    //            curCol == 0
  }

  /**
   * Get a line from `lines` at given index.
   *
   * @param {number} idx - an index
   * @returns {string}
   */
  _linesGet(idx: number) {
    if ('get' in this._lines) {
      // @ts-ignore
      return this._lines.get(idx) as string;
    } else {
      return this._lines[idx];
    }
  }

  /**
   * Return a slice from `lines`.
   *
   * @param {number} start - the start index
   * @param {number} end - the end index
   * @returns {string[]}
   */
  _linesSlice(start: number | undefined, end: number | undefined) {
    // can be unimplemented if removeLines's return value not needed
    if (this._lines.slice) {
      return this._lines.slice(start, end);
    } else {
      return [];
    }
  }

  /**
   * Return the length of `lines`.
   *
   * @returns {number}
   */
  _linesLength() {
    if (typeof this._lines.length === 'number') {
      return this._lines.length;
    } else {
      // @ts-ignore
      return this._lines.length();
    }
  }

  /**
   * Starts a new splice.
   */
  _enterSplice() {
    this._curSplice[0] = this._curLine;
    this._curSplice[1] = 0;
    // TODO(doc) when is this the case?
    //           check all enterSplice calls and changes to curCol
    if (this._curCol > 0) this._putCurLineInSplice();
    this._inSplice = true;
  }

  /**
   * Changes the lines array according to the values in curSplice and resets curSplice. Called via
   * close or TODO(doc).
   */
  _leaveSplice() {
    this._lines.splice(...this._curSplice);
    this._curSplice.length = 2;
    this._curSplice[0] = this._curSplice[1] = 0;
    this._inSplice = false;
  }

  /**
   * Indicates if curLine is already in the splice. This is necessary because the last element in
   * curSplice is curLine when this line is currently worked on (e.g. when skipping or inserting).
   *
   * @returns {boolean} true if curLine is in splice
   */
  _isCurLineInSplice() {
    // The value of `this._curSplice[1]` does not matter when determining the return value because
    // `this._curLine` refers to the line number *after* the splice is applied (so after those lines
    // are deleted).
    return this._curLine - this._curSplice[0] < this._curSplice.length - 2;
  }

  /**
   * Incorporates current line into the splice and marks its old position to be deleted.
   *
   * @returns {number} the index of the added line in curSplice
   */
  _putCurLineInSplice() {
    if (!this._isCurLineInSplice()) {
      // @ts-ignore
      this._curSplice.push(this._linesGet(this._curSplice[0] + this._curSplice[1]));
      // @ts-ignore
      this._curSplice[1]++;
    }
    // TODO should be the same as this._curSplice.length - 1
    return 2 + this._curLine - this._curSplice[0];
  }

  /**
   * It will skip some newlines by putting them into the splice.
   *
   * @param {number} L -
   * @param {boolean} includeInSplice - Indicates that attributes are present.
   */
  skipLines(L: number, includeInSplice?: any) {
    if (!L) return;
    if (includeInSplice) {
      if (!this._inSplice) this._enterSplice();
      // TODO(doc) should this count the number of characters that are skipped to check?
      for (let i = 0; i < L; i++) {
        this._curCol = 0;
        this._putCurLineInSplice();
        this._curLine++;
      }
    } else {
      if (this._inSplice) {
        if (L > 1) {
          // TODO(doc) figure out why single lines are incorporated into splice instead of ignored
          this._leaveSplice();
        } else {
          this._putCurLineInSplice();
        }
      }
      this._curLine += L;
      this._curCol = 0;
    }
    // tests case foo in remove(), which isn't otherwise covered in current impl
  }

  /**
   * Skip some characters. Can contain newlines.
   *
   * @param {number} N - number of characters to skip
   * @param {number} L - number of newlines to skip
   * @param {boolean} includeInSplice - indicates if attributes are present
   */
  skip(N: number, L: number, includeInSplice?: any) {
    if (!N) return;
    if (L) {
      this.skipLines(L, includeInSplice);
    } else {
      if (includeInSplice && !this._inSplice) this._enterSplice();
      if (this._inSplice) {
        // although the line is put into splice curLine is not increased, because
        // only some chars are skipped, not the whole line
        this._putCurLineInSplice();
      }
      this._curCol += N;
    }
  }

  /**
   * Remove whole lines from lines array.
   *
   * @param {number} L - number of lines to remove
   * @returns {string}
   */
  removeLines(L: number) {
    if (!L) return '';
    if (!this._inSplice) this._enterSplice();

    /**
     * Gets a string of joined lines after the end of the splice.
     *
     * @param {number} k - number of lines
     * @returns {string} joined lines
     */
    const nextKLinesText = (k: number) => {
      // @ts-ignore
      const m = this._curSplice[0] + this._curSplice[1];
      return this._linesSlice(m, m + k).join('');
    };

    let removed = '';
    if (this._isCurLineInSplice()) {
      if (this._curCol === 0) {
        // @ts-ignore
        removed = this._curSplice[this._curSplice.length - 1];
        this._curSplice.length--;
        removed += nextKLinesText(L - 1);
        // @ts-ignore
        this._curSplice[1] += L - 1;
      } else {
        removed = nextKLinesText(L - 1);
        // @ts-ignore
        this._curSplice[1] += L - 1;
        const sline = this._curSplice.length - 1;
        // @ts-ignore
        removed = this._curSplice[sline].substring(this._curCol) + removed;
        // @ts-ignore
        this._curSplice[sline] = this._curSplice[sline].substring(0, this._curCol) +
          // @ts-ignore
          this._linesGet(this._curSplice[0] + this._curSplice[1]);
        // @ts-ignore
        this._curSplice[1] += 1;
      }
    } else {
      removed = nextKLinesText(L);
      this._curSplice[1]! += L;
    }
    return removed;
  }

  /**
   * Remove text from lines array.
   *
   * @param {number} N - characters to delete
   * @param {number} L - lines to delete
   * @returns {string}
   */
  remove(N: number, L: any) {
    if (!N) return '';
    if (L) return this.removeLines(L);
    if (!this._inSplice) this._enterSplice();
    // although the line is put into splice, curLine is not increased, because
    // only some chars are removed not the whole line
    const sline = this._putCurLineInSplice();
    // @ts-ignore
    const removed = this._curSplice[sline].substring(this._curCol, this._curCol + N);
    // @ts-ignore
    this._curSplice[sline] = this._curSplice[sline].substring(0, this._curCol) +
      // @ts-ignore
      this._curSplice[sline].substring(this._curCol + N);
    return removed;
  }

  /**
   * Inserts text into lines array.
   *
   * @param {string} text - the text to insert
   * @param {number} L - number of newlines in text
   */
  insert(text: string | any[], L: any) {
    if (!text) return;
    if (!this._inSplice) this._enterSplice();
    if (L) {
      // @ts-ignore
      const newLines = splitTextLines(text);
      if (this._isCurLineInSplice()) {
        const sline = this._curSplice.length - 1;
        /** @type {string} */
        const theLine = this._curSplice[sline];
        const lineCol = this._curCol;
        // Insert the chars up to `curCol` and the first new line.
        // @ts-ignore
        this._curSplice[sline] = theLine.substring(0, lineCol) + newLines[0];
        this._curLine++;
        newLines!.splice(0, 1);
        // insert the remaining new lines
        // @ts-ignore
        this._curSplice.push(...newLines);
        this._curLine += newLines!.length;
        // insert the remaining chars from the "old" line (e.g. the line we were in
        // when we started to insert new lines)
        // @ts-ignore
        this._curSplice.push(theLine.substring(lineCol));
        this._curCol = 0; // TODO(doc) why is this not set to the length of last line?
      } else {
        this._curSplice.push(...newLines);
        this._curLine += newLines!.length;
      }
    } else {
      // There are no additional lines. Although the line is put into splice, curLine is not
      // increased because there may be more chars in the line (newline is not reached).
      const sline = this._putCurLineInSplice();
      if (!this._curSplice[sline]) {
        const err = new Error(
          'curSplice[sline] not populated, actual curSplice contents is ' +
          `${JSON.stringify(this._curSplice)}. Possibly related to ` +
          'https://github.com/ether/etherpad-lite/issues/2802');
        console.error(err.stack || err.toString());
      }
      // @ts-ignore
      this._curSplice[sline] = this._curSplice[sline].substring(0, this._curCol) + text +
        // @ts-ignore
        this._curSplice[sline].substring(this._curCol);
      this._curCol += text.length;
    }
  }

  /**
   * Checks if curLine (the line we are in when curSplice is applied) is the last line in `lines`.
   *
   * @returns {boolean} indicates if there are lines left
   */
  hasMore() {
    let docLines = this._linesLength();
    if (this._inSplice) {
      // @ts-ignore
      docLines += this._curSplice.length - 2 - this._curSplice[1];
    }
    return this._curLine < docLines;
  }

  /**
   * Closes the splice
   */
  close() {
    if (this._inSplice) this._leaveSplice();
  }
}

export default TextLinesMutator
