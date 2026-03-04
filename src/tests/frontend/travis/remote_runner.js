'use strict';

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
process.on('unhandledRejection', (err) => { throw err; });

const async = require('async');
const swd = require('selenium-webdriver');
const swdChrome = require('selenium-webdriver/chrome');
const swdEdge = require('selenium-webdriver/edge');
const swdFirefox = require('selenium-webdriver/firefox');

const isAdminRunner = process.argv[2] === 'admin';

const colorSubst = {
  red: '\x1B[31m',
  yellow: '\x1B[33m',
  green: '\x1B[32m',
  clear: '\x1B[39m',
};
const colorRegex = new RegExp(`\\[(${Object.keys(colorSubst).join('|')})\\]`, 'g');

const log = (msg, pfx = '') => {
  console.log(`${pfx}${msg.replace(colorRegex, (m, p1) => colorSubst[p1])}`);
};

const finishedRegex = /FINISHED.*[0-9]+ tests passed, ([0-9]+) tests failed/;

const sauceTestWorker = async.queue(async ({name, pfx, browser, version, platform}) => {
  const chromeOptions = new swdChrome.Options()
      .addArguments('use-fake-device-for-media-stream', 'use-fake-ui-for-media-stream');
  const edgeOptions = new swdEdge.Options()
      .addArguments('use-fake-device-for-media-stream', 'use-fake-ui-for-media-stream');
  const firefoxOptions = new swdFirefox.Options()
      .setPreference('media.navigator.permission.disabled', true)
      .setPreference('media.navigator.streams.fake', true);
  const builder = new swd.Builder()
      .usingServer('https://ondemand.saucelabs.com/wd/hub')
      .forBrowser(browser, version, platform)
      .setChromeOptions(chromeOptions)
      .setEdgeOptions(edgeOptions)
      .setFirefoxOptions(firefoxOptions);
  builder.getCapabilities().set('sauce:options', {
    username: process.env.SAUCE_USERNAME,
    accessKey: process.env.SAUCE_ACCESS_KEY,
    name: [process.env.GIT_HASH].concat(process.env.SAUCE_NAME || [], name).join(' - '),
    public: true,
    build: process.env.GIT_HASH,
    // console.json can be downloaded via saucelabs,
    // don't know how to print them into output of the tests
    extendedDebugging: true,
    tunnelIdentifier: process.env.TRAVIS_JOB_NUMBER,
  });
  const driver = await builder.build();
  const url = `https://saucelabs.com/jobs/${(await driver.getSession()).getId()}`;
  try {
    await driver.get('http://localhost:9001/tests/frontend/');
    log(`Remote sauce test started! ${url}`, pfx);
    // @TODO this should be configured in testSettings, see
    // https://wiki.saucelabs.com/display/DOCS/Test+Configuration+Options#TestConfigurationOptions-Timeouts
    const deadline = Date.now() + 14.5 * 60 * 1000; // Slightly less than overall test timeout.
    // how many characters of the log have been sent to travis
    let logIndex = 0;
    const remoteFn = (skipChars) => {
      const console = document.getElementById('console'); // eslint-disable-line no-undef
      if (console == null) return '';
      let text = '';
      for (const n of console.childNodes) {
        if (n.nodeType === n.TEXT_NODE) text += n.data;
      }
      return text.substring(skipChars);
    };
    while (true) {
      const consoleText = await driver.executeScript(remoteFn, logIndex);
      (consoleText ? consoleText.split('\n') : []).forEach((line) => log(line, pfx));
      logIndex += consoleText.length;
      const [finished, nFailedStr] = consoleText.match(finishedRegex) || [];
      if (finished) {
        if (nFailedStr !== '0') process.exitCode = 1;
        break;
      }
      if (Date.now() >= deadline) {
        log('[red]FAILED[clear] allowed test duration exceeded');
        process.exitCode = 1;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } finally {
    log(`Remote sauce test finished! ${url}`, pfx);
    await driver.quit();
  }
}, 6); // run 6 tests in parrallel

Promise.all([
  {browser: 'chrome', version: 'latest', platform: 'Windows 10'},
  ...(isAdminRunner ? [] : [
    {browser: 'safari', version: 'latest', platform: 'macOS 11.00'},
    {browser: 'firefox', version: 'latest', platform: 'Windows 10'},
    {browser: 'MicrosoftEdge', version: 'latest', platform: 'Windows 10'},
  ]),
].map(async ({browser, version, platform}) => {
  const name = `${browser} ${version}, ${platform}`;
  const pfx = `[${name}] `;
  try {
    await sauceTestWorker.push({name, pfx, browser, version, platform});
  } catch (err) {
    log(`[red]FAILED[clear] ${err.stack || err}`, pfx);
    process.exitCode = 1;
  }
}));
