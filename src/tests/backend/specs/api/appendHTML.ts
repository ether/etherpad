'use strict';
/* eslint-disable-next-line mocha/no-global-tests */
describe('appendHTML API', function () {
    let agent: any;
    const apiKey = require('../../../../../src/node/handler/APIHandler.js').exportedForTestingOnly.apiKey;
    const apiVersion = 1;
    const testPadId = makeid();

    before(async function () {
        agent = await common.init();
    });

    let endPoint = (point: string, version?: number | string) => `/api/${version || apiVersion}/${point}?apikey=${apiKey}`;

    function makeid() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

        for (let i = 0; i < 5; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    it('appends HTML to the pad', async function () {
        // 1. Create a pad with initial text
        await agent.post(endPoint('createPad'))
            .send({ padID: testPadId, text: 'Initial text\n' })
            .expect(200)
            .expect((res: any) => {
                if (res.body.code !== 0) throw new Error('Failed to create pad');
            });

        // 2. Append HTML
        const htmlToAppend = '<b>Bold text</b>';
        await agent.post(endPoint('appendHTML', '1.3.0')) // Verify version/method match RestAPI
            .send({ padID: testPadId, html: htmlToAppend })
            .expect(200)
            .expect((res: any) => {
                if (res.body.code !== 0) throw new Error('Failed to append HTML');
            });

        // 3. Get HTML to verify
        await agent.get(endPoint('getHTML'))
            .query({ padID: testPadId })
            .expect(200)
            .expect((res: any) => {
                const html = res.body.data.html;
                if (!html.includes('<b>Bold text</b>')) throw new Error('HTML not appended correctly');
                if (!html.includes('Initial text')) throw new Error('Initial text lost');
            });
    });
});

const common = require('../../common');
