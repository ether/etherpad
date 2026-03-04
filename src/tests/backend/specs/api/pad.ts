'use strict';

/*
 * ACHTUNG: there is a copied & modified version of this file in
 * <basedir>/src/tests/container/specs/api/pad.js
 *
 * TODO: unify those two files, and merge in a single one.
 */

const assert = require('assert').strict;
const common = require('../../common');
const padManager = require('../../../../node/db/PadManager');

let agent:any;
let apiVersion = 1;
const testPadId = makeid();
const newPadId = makeid();
const copiedPadId = makeid();
const anotherPadId = makeid();
let lastEdited = '';
const text = generateLongText();

const endPoint = (point: string, version?: string) => `/api/${version || apiVersion}/${point}`;

/*
 * Html document with nested lists of different types, to test its import and
 * verify it is exported back correctly
 */
const ulHtml = '<!doctype html><html><body><ul class="bullet"><li>one</li><li>two</li><li>0</li><li>1</li><li>2<ul class="bullet"><li>3</li><li>4</li></ul></li></ul><ol class="number"><li>item<ol class="number"><li>item1</li><li>item2</li></ol></li></ol></body></html>';

/*
 * When exported back, Etherpad produces an html which is not exactly the same
 * textually, but at least it remains standard compliant and has an equal DOM
 * structure.
 */
const expectedHtml = '<!doctype html><html><body><ul class="bullet"><li>one</li><li>two</li><li>0</li><li>1</li><li>2<ul class="bullet"><li>3</li><li>4</ul></li></ul><ol start="1" class="number"><li>item<ol start="2" class="number"><li>item1</li><li>item2</ol></li></ol></body></html>';

/*
 * Html document with space between list items, to test its import and
 * verify it is exported back correctly
 */
const ulSpaceHtml = '<!doctype html><html><body><ul class="bullet"> <li>one</li></ul></body></html>';

/*
 * When exported back, Etherpad produces an html which is not exactly the same
 * textually, but at least it remains standard compliant and has an equal DOM
 * structure.
 */
const expectedSpaceHtml = '<!doctype html><html><body><ul class="bullet"><li>one</ul></body></html>';

describe(__filename, function () {
  before(async function () {
    agent = await common.init();
    const res = await agent.get('/api/')
        .expect(200)
        .expect('Content-Type', /json/);
    apiVersion = res.body.currentVersion;
    assert(apiVersion);
  });

  describe('Sanity checks', function () {
    it('errors with invalid oauth token', async function () {
      // This is broken because Etherpad doesn't handle HTTP codes properly see #2343
      await agent.get(`/api/${apiVersion}/createPad?padID=test`)
          .set("Authorization", (await common.generateJWTToken()).substring(0, 10))
          .expect(401);
    });
  });

  /* Pad Tests Order of execution
  -> deletePad -- This gives us a guaranteed clear environment
   -> createPad
    -> getRevisions -- Should be 0
     -> getSavedRevisionsCount(padID) -- Should be 0
      -> listSavedRevisions(padID) -- Should be an empty array
       -> getHTML -- Should be the default pad text in HTML format
        -> deletePad -- Should just delete a pad
         -> getHTML -- Should return an error
          -> createPad(withText)
           -> getText -- Should have the text specified above as the pad text
            -> setText
             -> getText -- Should be the text set before
              -> getRevisions -- Should be 0 still?
               -> saveRevision
                -> getSavedRevisionsCount(padID) -- Should be 0 still?
                 -> listSavedRevisions(padID) -- Should be an empty array still ?
                  -> padUsersCount -- Should be 0
                   -> getReadOnlyId -- Should be a value
                    -> listAuthorsOfPad(padID) -- should be empty array?
                     -> getLastEdited(padID) -- Should be when pad was made
                      -> setText(padId)
                       -> getLastEdited(padID) -- Should be when setText was performed
                        -> padUsers(padID) -- Should be when setText was performed

                         -> setText(padId, "hello world")
                          -> getLastEdited(padID) -- Should be when pad was made
                           -> getText(padId) -- Should be "hello world"
                            -> movePad(padID, newPadId) -- Should provide consistent pad data
                             -> getText(newPadId) -- Should be "hello world"
                              -> movePad(newPadID, originalPadId) -- Should provide consistent pad data
                               -> getText(originalPadId) -- Should be "hello world"
                                -> getLastEdited(padID) -- Should not be 0
                                -> appendText(padID, "hello")
                                -> getText(padID) -- Should be "hello worldhello"
                                -> getText(padID, rev=2) - should return "hello world"
                                 -> setHTML(padID) -- Should fail on invalid HTML
                                  -> setHTML(padID) *3 -- Should fail on invalid HTML
                                   -> getHTML(padID) -- Should return HTML close to posted HTML
                                    -> createPad -- Tries to create pads with bad url characters

  */

  describe('Tests', function () {
    it('deletes a Pad that does not exist', async function () {
      await agent.get(`${endPoint('deletePad')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200) // @TODO: we shouldn't expect 200 here since the pad may not exist
          .expect('Content-Type', /json/);
    });

    it('creates a new Pad', async function () {
      const res = await agent.get(`${endPoint('createPad')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('gets revision count of Pad', async function () {
      const res = await agent.get(`${endPoint('getRevisionsCount')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.revisions, 0);
    });

    it('gets saved revisions count of Pad', async function () {
      const res = await agent.get(`${endPoint('getSavedRevisionsCount')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.savedRevisions, 0);
    });

    it('gets saved revision list of Pad', async function () {
      const res = await agent.get(`${endPoint('listSavedRevisions')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      assert.deepEqual(res.body.data.savedRevisions, []);
    });

    it('get the HTML of Pad', async function () {
      const res = await agent.get(`${endPoint('getHTML')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert(res.body.data.html.length > 1);
    });

    it('list all pads', async function () {
      const res = await agent.get(endPoint('listAllPads'))
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert(res.body.data.padIDs.includes(testPadId));
    });

    it('deletes the Pad', async function () {
      const res = await agent.get(`${endPoint('deletePad')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('list all pads again', async function () {
      const res = await agent.get(endPoint('listAllPads'))
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert(!res.body.data.padIDs.includes(testPadId));
    });

    it('get the HTML of a Pad -- Should return a failure', async function () {
      const res = await agent.get(`${endPoint('getHTML')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 1);
    });

    it('creates a new Pad with text', async function () {
      const res = await agent.get(`${endPoint('createPad')}?padID=${testPadId}&text=testText`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('gets the Pad text and expect it to be testText with trailing \\n', async function () {
      const res = await agent.get(`${endPoint('getText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.text, 'testText\n');
    });

    it('set text', async function () {
      const res = await agent.post(endPoint('setText'))
          .set("Authorization", (await common.generateJWTToken()))
          .send({
            padID: testPadId,
            text: 'testTextTwo',
          })
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('gets the Pad text', async function () {
      const res = await agent.get(`${endPoint('getText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.text, 'testTextTwo\n');
    });

    it('gets Revision Count of a Pad', async function () {
      const res = await agent.get(`${endPoint('getRevisionsCount')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.revisions, 1);
    });

    it('saves Revision', async function () {
      const res = await agent.get(`${endPoint('saveRevision')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('gets saved revisions count of Pad again', async function () {
      const res = await agent.get(`${endPoint('getSavedRevisionsCount')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.savedRevisions, 1);
    });

    it('gets saved revision list of Pad again', async function () {
      const res = await agent.get(`${endPoint('listSavedRevisions')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      assert.deepEqual(res.body.data.savedRevisions, [1]);
    });

    it('gets User Count of a Pad', async function () {
      const res = await agent.get(`${endPoint('padUsersCount')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.padUsersCount, 0);
    });

    it('Gets the Read Only ID of a Pad', async function () {
      const res = await agent.get(`${endPoint('getReadOnlyID')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert(res.body.data.readOnlyID);
    });

    it('Get Authors of the Pad', async function () {
      const res = await agent.get(`${endPoint('listAuthorsOfPad')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.authorIDs.length, 0);
    });

    it('Get When Pad was left Edited', async function () {
      const res = await agent.get(`${endPoint('getLastEdited')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert(res.body.data.lastEdited);
      lastEdited = res.body.data.lastEdited;
    });

    it('set text again', async function () {
      const res = await agent.post(endPoint('setText'))
          .set("Authorization", (await common.generateJWTToken()))
          .send({
            padID: testPadId,
            text: 'testTextThree',
          })
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('Get When Pad was left Edited again', async function () {
      const res = await agent.get(`${endPoint('getLastEdited')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert(res.body.data.lastEdited > lastEdited);
    });

    it('gets User Count of a Pad again', async function () {
      const res = await agent.get(`${endPoint('padUsers')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.padUsers.length, 0);
    });

    it('deletes a Pad', async function () {
      const res = await agent.get(`${endPoint('deletePad')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('creates the Pad again', async function () {
      const res = await agent.get(`${endPoint('createPad')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('Sets text on a pad Id', async function () {
      const res = await agent.post(`${endPoint('setText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .field({text})
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('Gets text on a pad Id', async function () {
      const res = await agent.get(`${endPoint('getText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.text, `${text}\n`);
    });

    it('Sets text on a pad Id including an explicit newline', async function () {
      const res = await agent.post(`${endPoint('setText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .field({text: `${text}\n`})
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it("Gets text on a pad Id and doesn't have an excess newline", async function () {
      const res = await agent.get(`${endPoint('getText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.text, `${text}\n`);
    });

    it('Gets when pad was last edited', async function () {
      const res = await agent.get(`${endPoint('getLastEdited')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.notEqual(res.body.lastEdited, 0);
    });

    it('Move a Pad to a different Pad ID', async function () {
      const res = await agent.get(
          `${endPoint('movePad')}?sourceID=${testPadId}&destinationID=${newPadId}&force=true`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('Gets text from new pad', async function () {
      const res = await agent.get(`${endPoint('getText')}?padID=${newPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.text, `${text}\n`);
    });

    it('Move pad back to original ID', async function () {
      const res = await agent.get(
          `${endPoint('movePad')}?sourceID=${newPadId}&destinationID=${testPadId}&force=false`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('Get text using original ID', async function () {
      const res = await agent.get(`${endPoint('getText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.text, `${text}\n`);
    });

    it('Get last edit of original ID', async function () {
      const res = await agent.get(`${endPoint('getLastEdited')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.notEqual(res.body.lastEdited, 0);
    });

    it('Append text to a pad Id', async function () {
      let res = await agent.get(
          `${endPoint('appendText', '1.2.13')}?padID=${testPadId}&text=hello`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      res = await agent.get(`${endPoint('getText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.text, `${text}hello\n`);
    });

    it('getText of old revision', async function () {
      let res = await agent.get(`${endPoint('getRevisionsCount')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      const rev = res.body.data.revisions;
      assert(rev != null);
      assert(Number.isInteger(rev));
      assert(rev > 0);
      res = await agent.get(`${endPoint('getText')}?padID=${testPadId}&rev=${rev - 1}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.text, `${text}\n`);
    });

    it('Sets the HTML of a Pad attempting to pass ugly HTML', async function () {
      const html = '<div><b>Hello HTML</title></head></div>';
      const res = await agent.post(endPoint('setHTML'))
          .set("Authorization", (await common.generateJWTToken()))
          .send({
            padID: testPadId,
            html,
          })
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('Pad with complex nested lists of different types', async function () {
      let res = await agent.post(endPoint('setHTML'))
          .set("Authorization", (await common.generateJWTToken()))
          .send({
            padID: testPadId,
            html: ulHtml,
          })
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      res = await agent.get(`${endPoint('getHTML')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      const receivedHtml = res.body.data.html.replace('<br></body>', '</body>').toLowerCase();
      assert.equal(receivedHtml, expectedHtml);
    });

    it('Pad with white space between list items', async function () {
      let res = await agent.get(`${endPoint('setHTML')}?padID=${testPadId}&html=${ulSpaceHtml}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
      res = await agent.get(`${endPoint('getHTML')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      const receivedHtml = res.body.data.html.replace('<br></body>', '</body>').toLowerCase();
      assert.equal(receivedHtml, expectedSpaceHtml);
    });

    it('errors if pad can be created', async function () {
      await Promise.all(['/', '%23', '%3F', '%26'].map(async (badUrlChar) => {
        const res = await agent.get(`${endPoint('createPad')}?padID=${badUrlChar}`)
            .set("Authorization", (await common.generateJWTToken()))
            .expect('Content-Type', /json/);
        assert.equal(res.body.code, 1);
      }));
    });

    it('copies the content of a existent pad', async function () {
      const res = await agent.get(
          `${endPoint('copyPad')}?sourceID=${testPadId}&destinationID=${copiedPadId}&force=true`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    it('does not add an useless revision', async function () {
      let res = await agent.post(`${endPoint('setText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .field({text: 'identical text\n'})
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);

      res = await agent.get(`${endPoint('getText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.text, 'identical text\n');

      res = await agent.get(`${endPoint('getRevisionsCount')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      const revCount = res.body.data.revisions;

      res = await agent.post(`${endPoint('setText')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .field({text: 'identical text\n'})
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);

      res = await agent.get(`${endPoint('getRevisionsCount')}?padID=${testPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.data.revisions, revCount);
    });

    it('creates a new Pad with empty text', async function () {
      await agent.get(`${endPoint('createPad')}?padID=${anotherPadId}&text=`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect('Content-Type', /json/)
          .expect(200)
          .expect((res:any) => {
            assert.equal(res.body.code, 0, 'Unable to create new Pad');
          });
      await agent.get(`${endPoint('getText')}?padID=${anotherPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect('Content-Type', /json/)
          .expect(200)
          .expect((res:any) => {
            assert.equal(res.body.code, 0, 'Unable to get pad text');
            assert.equal(res.body.data.text, '\n', 'Pad text is not empty');
          });
    });

    it('deletes with empty text', async function () {
      await agent.get(`${endPoint('deletePad')}?padID=${anotherPadId}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect('Content-Type', /json/)
          .expect(200)
          .expect((res: any) => {
            assert.equal(res.body.code, 0, 'Unable to delete empty Pad');
          });
    });
  });

  describe('copyPadWithoutHistory', function () {
    const sourcePadId = makeid();
    let newPad:string;

    before(async function () {
      await createNewPadWithHtml(sourcePadId, ulHtml);
    });

    beforeEach(async function () {
      newPad = makeid();
    });

    it('returns a successful response', async function () {
      const res = await agent.get(`${endPoint('copyPadWithoutHistory')}?sourceID=${sourcePadId}` +
                                  `&destinationID=${newPad}&force=false`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/);
      assert.equal(res.body.code, 0);
    });

    // this test validates if the source pad's text and attributes are kept
    it('creates a new pad with the same content as the source pad', async function () {
      let res = await agent.get(`${endPoint('copyPadWithoutHistory')}?sourceID=${sourcePadId}` +
                                `&destinationID=${newPad}&force=false`)
          .set("Authorization", (await common.generateJWTToken()));
      assert.equal(res.body.code, 0);
      res = await agent.get(`${endPoint('getHTML')}?padID=${newPad}`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200);
      const receivedHtml = res.body.data.html.replace('<br><br></body>', '</body>').toLowerCase();
      assert.equal(receivedHtml, expectedHtml);
    });

    it('copying to a non-existent group throws an error', async function () {
      const padWithNonExistentGroup = `notExistentGroup$${newPad}`;
      const res = await agent.get(`${endPoint('copyPadWithoutHistory')}` +
                                  `?sourceID=${sourcePadId}` +
                                  `&destinationID=${padWithNonExistentGroup}&force=true`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200);
      assert.equal(res.body.code, 1);
    });

    describe('copying to an existing pad', function () {
      beforeEach(async function () {
        await createNewPadWithHtml(newPad, ulHtml);
      });

      it('force=false fails', async function () {
        const res = await agent.get(`${endPoint('copyPadWithoutHistory')}` +
                                    `?sourceID=${sourcePadId}` +
                                    `&destinationID=${newPad}&force=false`)
            .set("Authorization", (await common.generateJWTToken()))
            .expect(200);
        assert.equal(res.body.code, 1);
      });

      it('force=true succeeds', async function () {
        const res = await agent.get(`${endPoint('copyPadWithoutHistory')}` +
                                    `?sourceID=${sourcePadId}` +
                                    `&destinationID=${newPad}&force=true`)
            .set("Authorization", (await common.generateJWTToken()))
            .expect(200);
        assert.equal(res.body.code, 0);
      });
    });

    // Regression test for https://github.com/ether/etherpad-lite/issues/5296
    it('source and destination attribute pools are independent', async function () {
      // Strategy for this test:
      //   1. Create a new pad without bold or italic text
      //   2. Use copyPadWithoutHistory to copy the pad.
      //   3. Add some bold text (but no italic text!) to the source pad. This should add a bold
      //      attribute to the source pad's pool but not to the destination pad's pool.
      //   4. Add some italic text (but no bold text!) to the destination pad. This should add an
      //      italic attribute to the destination pad's pool with the same number as the newly added
      //      bold attribute in the source pad's pool.
      //   5. Add some more text (bold or plain) to the source pad. This will save the source pad to
      //      the database after the destination pad has had an opportunity to corrupt the source
      //      pad.
      //   6. Export the source and destination pads. Make sure that <em> doesn't appear in the
      //      source pad's HTML, and that <strong> doesn't appear int he destination pad's HTML.
      //   7. Force the server to re-init the pads from the database.
      //   8. Repeat step 6.
      // If <em> appears in the source pad, or <strong> appears in the destination pad, then shared
      // state between the two attribute pools caused corruption.

      const getHtml = async (padId:string) => {
        const res = await agent.get(`${endPoint('getHTML')}?padID=${padId}`)
            .set("Authorization", (await common.generateJWTToken()))
            .expect(200)
            .expect('Content-Type', /json/);
        assert.equal(res.body.code, 0);
        return res.body.data.html;
      };

      const setBody = async (padId: string, bodyHtml: string) => {
        await agent.post(endPoint('setHTML'))
            .set("Authorization", (await common.generateJWTToken()))
            .send({padID: padId, html: `<!DOCTYPE HTML><html><body>${bodyHtml}</body></html>`})
            .expect(200)
            .expect('Content-Type', /json/)
            .expect((res: any) => assert.equal(res.body.code, 0));
      };

      const origHtml = await getHtml(sourcePadId);
      assert.doesNotMatch(origHtml, /<strong>/);
      assert.doesNotMatch(origHtml, /<em>/);
      await agent.get(`${endPoint('copyPadWithoutHistory')}?sourceID=${sourcePadId}` +
                      `&destinationID=${newPad}&force=false`)
          .set("Authorization", (await common.generateJWTToken()))
          .expect(200)
          .expect('Content-Type', /json/)
          .expect((res:any) => assert.equal(res.body.code, 0));

      const newBodySrc = '<strong>bold</strong>';
      const newBodyDst = '<em>italic</em>';
      await setBody(sourcePadId, newBodySrc);
      await setBody(newPad, newBodyDst);
      await setBody(sourcePadId, `${newBodySrc} foo`);

      let [srcHtml, dstHtml] = await Promise.all([getHtml(sourcePadId), getHtml(newPad)]);
      assert.match(srcHtml, new RegExp(newBodySrc));
      assert.match(dstHtml, new RegExp(newBodyDst));

      // Force the server to re-read the pads from the database. This rebuilds the attribute pool
      // objects from scratch, ensuring that an internally inconsistent attribute pool object did
      // not cause the above tests to accidentally pass.
      const reInitPad = async (padId:string) => {
        const pad = await padManager.getPad(padId);
        await pad.init();
      };
      await Promise.all([
        reInitPad(sourcePadId),
        reInitPad(newPad),
      ]);

      [srcHtml, dstHtml] = await Promise.all([getHtml(sourcePadId), getHtml(newPad)]);
      assert.match(srcHtml, new RegExp(newBodySrc));
      assert.match(dstHtml, new RegExp(newBodyDst));
    });
  });
});

/*
                          -> movePadForce Test

*/

const createNewPadWithHtml = async (padId: string, html: string) => {
  await agent.get(`${endPoint('createPad')}?padID=${padId}`)
      .set("Authorization", (await common.generateJWTToken()));
  await agent.post(endPoint('setHTML'))
      .set("Authorization", (await common.generateJWTToken()))
      .send({
        padID: padId,
        html,
      });
};

function makeid() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < 5; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function generateLongText() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < 80000; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
