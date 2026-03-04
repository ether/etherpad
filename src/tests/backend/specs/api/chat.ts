'use strict';

import {generateJWTToken} from "../../common";

const common = require('../../common');

import {strict as assert} from "assert";

let agent:any;
let apiVersion = 1;
let authorID = '';
const padID = makeid();
const timestamp = Date.now();

const endPoint = (point:string) => `/api/${apiVersion}/${point}`;

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  describe('API Versioning', function () {
    it('errors if can not connect', async function () {
      await agent.get('/api/')
          .expect((res:any) => {
            apiVersion = res.body.currentVersion;
            if (!res.body.currentVersion) throw new Error('No version set in API');
            return;
          })
          .expect(200);
    });
  });

  // BEGIN GROUP AND AUTHOR TESTS
  // ///////////////////////////////////
  // ///////////////////////////////////

  /* Tests performed
  -> createPad(padID)
   -> createAuthor([name]) -- should return an authorID
    -> appendChatMessage(padID, text, authorID, time)
     -> getChatHead(padID)
      -> getChatHistory(padID)
  */

  describe('Chat functionality', function () {
    it('creates a new Pad', async function () {
      await agent.get(`${endPoint('createPad')}?padID=${padID}`)
          .set("authorization", await generateJWTToken())
          .expect(200)
          .expect((res:any) => {
            if (res.body.code !== 0) throw new Error('Unable to create new Pad');
          })
          .expect('Content-Type', /json/);
    });

    it('Creates an author with a name set', async function () {
      await agent.get(endPoint('createAuthor'))
          .set("authorization", await generateJWTToken())
          .expect((res:any) => {
            if (res.body.code !== 0 || !res.body.data.authorID) {
              throw new Error('Unable to create author');
            }
            authorID = res.body.data.authorID; // we will be this author for the rest of the tests
          })
          .expect('Content-Type', /json/)
          .expect(200);
    });

    it('Gets the head of chat before the first chat msg', async function () {
      await agent.get(`${endPoint('getChatHead')}?padID=${padID}`)
          .set("authorization", await generateJWTToken())
          .expect((res:any) => {
            if (res.body.data.chatHead !== -1) throw new Error('Chat Head Length is wrong');
            if (res.body.code !== 0) throw new Error('Unable to get chat head');
          })
          .expect('Content-Type', /json/)
          .expect(200);
    });

    it('Adds a chat message to the pad', async function () {
      await agent.get(`${endPoint('appendChatMessage')}?padID=${padID}&text=blalblalbha` +
                `&authorID=${authorID}&time=${timestamp}`)
          .set("authorization", await generateJWTToken())
          .expect((res:any) => {
            if (res.body.code !== 0) throw new Error('Unable to create chat message');
          })
          .expect('Content-Type', /json/)
          .expect(200);
    });

    it('Gets the head of chat', async function () {
      await agent.get(`${endPoint('getChatHead')}?padID=${padID}`)
          .set("authorization", await generateJWTToken())
          .expect((res:any) => {
            if (res.body.data.chatHead !== 0) throw new Error('Chat Head Length is wrong');

            if (res.body.code !== 0) throw new Error('Unable to get chat head');
          })
          .expect('Content-Type', /json/)
          .expect(200);
    });

    it('Gets Chat History of a Pad', async function () {
      await agent.get(`${endPoint('getChatHistory')}?padID=${padID}`)
          .set("authorization", await generateJWTToken())
          .expect('Content-Type', /json/)
          .expect(200)
          .expect((res:any) => {
            assert.equal(res.body.code, 0, 'Unable to get chat history');
            assert.equal(res.body.data.messages.length, 1, 'Chat History Length is wrong');
            assert.equal(res.body.data.messages[0].text, 'blalblalbha', 'Chat text does not match');
            assert.equal(res.body.data.messages[0].userId, authorID, 'Message author does not match');
            assert.equal(res.body.data.messages[0].time, timestamp.toString(), 'Message time does not match');
          });
    });
  });
});

function makeid() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < 5; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
