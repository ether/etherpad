/*
 * Fuzz testing the import endpoint
 * Usage: node fuzzImportTest.js
 */
const settings = require('../container/loadSettings').loadSettings();
const common = require('./common');
const host = `http://${settings.ip}:${settings.port}`;
const froth = require('mocha-froth');
const apiVersion = 1;
const testPadId = `TEST_fuzz${makeid()}`;

const endPoint = function (point: string, version?:number) {
    version = version || apiVersion;
    return `/api/${version}/${point}}`;
};

console.log('Testing against padID', testPadId);
console.log(`To watch the test live visit ${host}/p/${testPadId}`);
console.log('Tests will start in 5 seconds, click the URL now!');

setTimeout(() => {
    for (let i = 1; i < 1000000; i++) { // 1M runs
        setTimeout(async () => {
            await runTest(i);
        }, i * 100); // 100 ms
    }
}, 5000); // wait 5 seconds

async function runTest(number: number) {
    try {
        const createRes = await fetch(`${host + endPoint('createPad')}?padID=${testPadId}`, {
            headers: {
                Authorization: await common.generateJWTToken(),
            },
        });
        if (!createRes.ok) throw new Error(`createPad HTTP ${createRes.status}`);

        let fN = '/test.txt';
        let cT = 'text/plain';
        // To be more aggressive every other test we mess with Etherpad
        // We provide a weird file name and also set a weird contentType
        if (number % 2 == 0) {
            fN = froth().toString();
            cT = froth().toString();
        }

        const form = new FormData();
        form.append('file', new Blob([froth().toString()], {type: cT}), fN);
        const importRes = await fetch(`${host}/p/${testPadId}/import`, {
            method: 'POST',
            body: form,
        });
        if (!importRes.ok) throw new Error(`import HTTP ${importRes.status}`);
        console.log('Success');
    } catch (err: any) {
        throw new Error('FAILURE', err);
    }
}

function makeid() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < 5; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
