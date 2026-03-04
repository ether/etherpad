'use strict';

import {PadAuthor, PadType} from "../types/PadType";
import {MapArrayType} from "../types/MapType";

import AttributeMap from '../../static/js/AttributeMap';
import {applyToAText, checkRep, compose, deserializeOps, pack, splitAttributionLines, splitTextLines, unpack} from '../../static/js/Changeset';
import {Builder} from "../../static/js/Builder";
import {OpAssembler} from "../../static/js/OpAssembler";
import {numToString} from "../../static/js/ChangesetUtils";
import Op from "../../static/js/Op";
import {StringAssembler} from "../../static/js/StringAssembler";
const attributes = require('../../static/js/attributes');
const exportHtml = require('./ExportHtml');


class PadDiff {
  private readonly _pad: PadType;
    private readonly _fromRev: string;
    private readonly _toRev: string;
    private _html: any;
    public _authors: any[];
    private self: PadDiff | undefined
  constructor(pad: PadType, fromRev:string, toRev:string) {
    // check parameters
    if (!pad || !pad.id || !pad.atext || !pad.pool) {
      throw new Error('Invalid pad');
    }

    const range = pad.getValidRevisionRange(fromRev, toRev);
    if (!range) throw new Error(`Invalid revision range. startRev: ${fromRev} endRev: ${toRev}`);

    this._pad = pad;
    this._fromRev = range.startRev;
    this._toRev = range.endRev;
    this._html = null;
    this._authors = [];
  }
  _isClearAuthorship(changeset: any){
    // unpack
    const unpacked = unpack(changeset);

    // check if there is nothing in the charBank
    if (unpacked.charBank !== '') {
      return false;
    }

    // check if oldLength == newLength
    if (unpacked.oldLen !== unpacked.newLen) {
      return false;
    }

    const [clearOperator, anotherOp] = deserializeOps(unpacked.ops);

    // check if there is only one operator
    if (anotherOp != null) return false;

    // check if this operator doesn't change text
    if (clearOperator.opcode !== '=') {
      return false;
    }

    // check that this operator applys to the complete text
    // if the text ends with a new line, its exactly one character less, else it has the same length
    if (clearOperator.chars !== unpacked.oldLen - 1 && clearOperator.chars !== unpacked.oldLen) {
      return false;
    }

    const [appliedAttribute, anotherAttribute] =
        attributes.attribsFromString(clearOperator.attribs, this._pad.pool);

    // Check that the operation has exactly one attribute.
    if (appliedAttribute == null || anotherAttribute != null) return false;

    // check if the applied attribute is an anonymous author attribute
    if (appliedAttribute[0] !== 'author' || appliedAttribute[1] !== '') {
      return false;
    }

    return true;
  }
  async _createClearAuthorship(rev: any){
    const atext = await this._pad.getInternalRevisionAText(rev);

    // build clearAuthorship changeset
    const builder = new Builder(atext.text.length);
    builder.keepText(atext.text, [['author', '']], this._pad.pool);
    const changeset = builder.toString();

    return changeset;
  }

  async _createClearStartAtext(rev: any){
    // get the atext of this revision
    const atext = await this._pad.getInternalRevisionAText(rev);

    // create the clearAuthorship changeset
    const changeset = await this._createClearAuthorship(rev);

    // apply the clearAuthorship changeset
    const newAText = applyToAText(changeset, atext, this._pad.pool);

    return newAText;
  }
  async _getChangesetsInBulk(startRev: any, count: any) {
    // find out which revisions we need
    const revisions = [];
    for (let i = startRev; i < (startRev + count) && i <= this._pad.head; i++) {
      revisions.push(i);
    }

    // get all needed revisions (in parallel)
    const changesets:any[] = [];
    const authors: any[] = [];
    await Promise.all(revisions.map((rev) => this._pad.getRevision(rev).then((revision) => {
      const arrayNum = rev - startRev;
      changesets[arrayNum] = revision.changeset;
      authors[arrayNum] = revision.meta.author;
    })));

    return {changesets, authors};
  }
  _addAuthors(authors: PadAuthor[]){
      this.self = this;

    // add to array if not in the array
    authors.forEach((author) => {
      if (this.self!._authors.indexOf(author) === -1) {
        this.self!._authors.push(author);
      }
    });
  }
  async _createDiffAtext(){
    const bulkSize = 100;

    // get the cleaned startAText
    let atext = await this._createClearStartAtext(this._fromRev);

    let superChangeset = null;

    for (let rev = this._fromRev + 1; rev <= this._toRev; rev += bulkSize) {
      // get the bulk
      const {changesets, authors} = await this._getChangesetsInBulk(rev, bulkSize);

      const addedAuthors = [];

      // run through all changesets
      for (let i = 0; i < changesets.length && (rev + i) <= this._toRev; ++i) {
        let changeset = changesets[i];

        // skip clearAuthorship Changesets
        if (this._isClearAuthorship(changeset)) {
          continue;
        }

        changeset = this._extendChangesetWithAuthor(changeset, authors[i], this._pad.pool);

        // add this author to the authorarray
        addedAuthors.push(authors[i]);

        // compose it with the superChangset
        if (superChangeset == null) {
          superChangeset = changeset;
        } else {
          superChangeset = compose(superChangeset, changeset, this._pad.pool);
        }
      }

      // add the authors to the PadDiff authorArray
      this._addAuthors(addedAuthors);
    }

    // if there are only clearAuthorship changesets, we don't get a superChangeset,
    // so we can skip this step
    if (superChangeset) {
      const deletionChangeset = this._createDeletionChangeset(superChangeset, atext, this._pad.pool);

      // apply the superChangeset, which includes all addings
      atext = applyToAText(superChangeset, atext, this._pad.pool);

      // apply the deletionChangeset, which adds a deletions
      atext = applyToAText(deletionChangeset, atext, this._pad.pool);
    }

    return atext;
  }
  async getHtml(){
    // cache the html
    if (this._html != null) {
      return this._html;
    }

    // get the diff atext
    const atext = await this._createDiffAtext();

    // get the authorColor table
    const authorColors = await this._pad.getAllAuthorColors();

    // convert the atext to html
    this._html = await exportHtml.getHTMLFromAtext(this._pad, atext, authorColors);

    return this._html;
  }

  async getAuthors() {
    // check if html was already produced, if not produce it, this generates
    // the author array at the same time
    if (this._html == null) {
      await this.getHtml();
    }

    return this.self!._authors;
  }

  _extendChangesetWithAuthor(changeset: any, author: any, apool: any){
    // unpack
    const unpacked = unpack(changeset);

    const assem = new OpAssembler();

    // create deleted attribs
    const authorAttrib = apool.putAttrib(['author', author || '']);
    const deletedAttrib = apool.putAttrib(['removed', true]);
    const attribs = `*${numToString(authorAttrib)}*${numToString(deletedAttrib)}`;

    for (const operator of deserializeOps(unpacked.ops)) {
      if (operator.opcode === '-') {
        // this is a delete operator, extend it with the author
        operator.attribs = attribs;
      } else if (operator.opcode === '=' && operator.attribs) {
        // this is operator changes only attributes, let's mark which author did that
        operator.attribs += `*${numToString(authorAttrib)}`;
      }

      // append the new operator to our assembler
      assem.append(operator);
    }

    // return the modified changeset
    return pack(unpacked.oldLen, unpacked.newLen, assem.toString(), unpacked.charBank);
  }
  _createDeletionChangeset(cs: any, startAText: any, apool: any){
    const lines = splitTextLines(startAText.text);
    const alines = splitAttributionLines(startAText.attribs, startAText.text);

    // lines and alines are what the exports is meant to apply to.
    // They may be arrays or objects with .get(i) and .length methods.
    // They include final newlines on lines.

    const linesGet = (idx: number) => {
      // @ts-ignore
      if (lines.get) {
        // @ts-ignore
        return lines.get(idx);
      } else {
        // @ts-ignore
        return lines[idx];
      }
    };

    const aLinesGet = (idx: number) => {
      // @ts-ignore
      if (alines.get) {
        // @ts-ignore
        return alines.get(idx);
      } else {
        return alines[idx];
      }
    };

    let curLine = 0;
    let curChar = 0;
    let curLineOps: { next: () => any; } | null = null;
    let curLineOpsNext: { done: any; value: any; } | null = null;
    let curLineOpsLine: number;
    let curLineNextOp = new Op('+');

    const unpacked = unpack(cs);
    const builder = new Builder(unpacked.newLen);

    const consumeAttribRuns = (numChars: number, func: Function /* (len, attribs, endsLine)*/) => {
      if (!curLineOps || curLineOpsLine !== curLine) {
        curLineOps = deserializeOps(aLinesGet(curLine));
        curLineOpsNext = curLineOps!.next();
        curLineOpsLine = curLine;
        let indexIntoLine = 0;
        while (!curLineOpsNext!.done) {
          curLineNextOp = curLineOpsNext!.value;
          curLineOpsNext = curLineOps!.next();
          if (indexIntoLine + curLineNextOp.chars >= curChar) {
            curLineNextOp.chars -= (curChar - indexIntoLine);
            break;
          }
          indexIntoLine += curLineNextOp.chars;
        }
      }

      while (numChars > 0) {
        if (!curLineNextOp.chars && curLineOpsNext!.done) {
          curLine++;
          curChar = 0;
          curLineOpsLine = curLine;
          curLineNextOp.chars = 0;
          curLineOps = deserializeOps(aLinesGet(curLine));
          curLineOpsNext = curLineOps!.next();
        }

        if (!curLineNextOp.chars) {
          if (curLineOpsNext!.done) {
            curLineNextOp = new Op();
          } else {
            curLineNextOp = curLineOpsNext!.value;
            curLineOpsNext = curLineOps!.next();
          }
        }

        const charsToUse = Math.min(numChars, curLineNextOp.chars);

        func(charsToUse, curLineNextOp.attribs,
            charsToUse === curLineNextOp.chars && curLineNextOp.lines > 0);
        numChars -= charsToUse;
        curLineNextOp.chars -= charsToUse;
        curChar += charsToUse;
      }

      if (!curLineNextOp.chars && curLineOpsNext!.done) {
        curLine++;
        curChar = 0;
      }
    };

    const skip = (N:number, L:number) => {
      if (L) {
        curLine += L;
        curChar = 0;
      } else if (curLineOps && curLineOpsLine === curLine) {
        consumeAttribRuns(N, () => {});
      } else {
        curChar += N;
      }
    };

    const nextText = (numChars: number) => {
      let len = 0;
      const assem = new StringAssembler();
      const firstString = linesGet(curLine).substring(curChar);
      len += firstString.length;
      assem.append(firstString);

      let lineNum = curLine + 1;

      while (len < numChars) {
        const nextString = linesGet(lineNum);
        len += nextString.length;
        assem.append(nextString);
        lineNum++;
      }

      return assem.toString().substring(0, numChars);
    };

    const cachedStrFunc = (func:Function) => {
      const cache:MapArrayType<any> = {};

      return (s:string) => {
        if (!cache[s]) {
          cache[s] = func(s);
        }
        return cache[s];
      };
    };

    for (const csOp of deserializeOps(unpacked.ops)) {
      if (csOp.opcode === '=') {
        const textBank = nextText(csOp.chars);

        // decide if this equal operator is an attribution change or not.
        // We can see this by checkinf if attribs is set.
        // If the text this operator applies to is only a star,
        // than this is a false positive and should be ignored
        if (csOp.attribs && textBank !== '*') {
          const attribs = AttributeMap.fromString(csOp.attribs, apool);
          const undoBackToAttribs = cachedStrFunc((oldAttribsStr: string) => {
            const oldAttribs = AttributeMap.fromString(oldAttribsStr, apool);
            const backAttribs = new AttributeMap(apool)
                .set('author', '')
                .set('removed', 'true');
            for (const [key, value] of attribs) {
              const oldValue = oldAttribs.get(key);
              if (oldValue !== value) backAttribs.set(key, oldValue);
            }
            // TODO: backAttribs does not restore removed attributes (it is missing attributes that
            // are in oldAttribs but not in attribs). I don't know if that is intentional.
            return backAttribs.toString();
          });

          let textLeftToProcess = textBank;

          while (textLeftToProcess.length > 0) {
            // process till the next line break or process only one line break
            let lengthToProcess = textLeftToProcess.indexOf('\n');
            let lineBreak = false;
            switch (lengthToProcess) {
              case -1:
                lengthToProcess = textLeftToProcess.length;
                break;
              case 0:
                lineBreak = true;
                lengthToProcess = 1;
                break;
            }

            // get the text we want to procceed in this step
            const processText = textLeftToProcess.substr(0, lengthToProcess);

            textLeftToProcess = textLeftToProcess.substr(lengthToProcess);

            if (lineBreak) {
              builder.keep(1, 1); // just skip linebreaks, don't do a insert + keep for a linebreak

              // consume the attributes of this linebreak
              consumeAttribRuns(1, () => {});
            } else {
              // add the old text via an insert, but add a deletion attribute +
              // the author attribute of the author who deleted it
              let textBankIndex = 0;
              consumeAttribRuns(lengthToProcess, (len: number, attribs:string, endsLine: string) => {
                // get the old attributes back
                const oldAttribs = undoBackToAttribs(attribs);

                builder.insert(processText.substr(textBankIndex, len), oldAttribs);
                textBankIndex += len;
              });

              builder.keep(lengthToProcess, 0);
            }
          }
        } else {
          skip(csOp.chars, csOp.lines);
          builder.keep(csOp.chars, csOp.lines);
        }
      } else if (csOp.opcode === '+') {
        builder.keep(csOp.chars, csOp.lines);
      } else if (csOp.opcode === '-') {
        const textBank = nextText(csOp.chars);
        let textBankIndex = 0;

        consumeAttribRuns(csOp.chars, (len: number, attribs: string[], endsLine: string) => {
          builder.insert(textBank.substr(textBankIndex, len), attribs + csOp.attribs);
          textBankIndex += len;
        });
      }
    }

    return checkRep(builder.toString());
  }

}


// this method is 80% like Changeset.inverse. I just changed so instead of reverting,
// it adds deletions and attribute changes to the atext.
// @ts-ignore
PadDiff.prototype._createDeletionChangeset = function (cs, startAText, apool) {

};

// export the constructor
module.exports = PadDiff;
