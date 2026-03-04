'use strict';


import {strict as assert} from "assert";
import {cleanComments, minify} from "admin/src/utils/utils";
import {describe, it, expect, beforeAll} from "vitest";
import fs from 'fs';
const fsp = fs.promises;
let template:string;

describe(__filename, function () {
  beforeAll(async function () {
    template = await fsp.readFile('../settings.json.template', 'utf8')
  });
  describe('adminUtils', function () {
    it('cleanComments function empty', async function () {
      expect(cleanComments("")).to.equal("");
    });
    it('cleanComments function HelloWorld no comment', async function () {
      expect(cleanComments("HelloWorld")).to.equal("HelloWorld");
    });
    it('cleanComments function HelloWorld with comment', async function () {
      expect(cleanComments("Hello/*abc*/World/*def*/")).to.equal("HelloWorld");
    });
    it('cleanComments function HelloWorld with comment and multiline', async function () {
      expect(cleanComments("Hello \n/*abc\nxyz*/World/*def*/")).to.equal("Hello\nWorld");
    });
    it('cleanComments function HelloWorld with multiple line breaks', async function () {
      expect(cleanComments("  \nHello \n  \n  \nWorld/*def*/")).to.equal("Hello\nWorld");
    });
    it('cleanComments function same after minified', async function () {
      expect(minify(cleanComments(template)!)).to.equal(minify(template));
    });
    it('minified results are smaller', async function () {
      expect(minify(template).length < template.length).to.equal(true);
    });
  });
});
