'use strict';

// $(handler), $().ready(handler), $.wait($.ready).then(handler), etc. don't work if handler is an
// async function for some bizarre reason, so the async function is wrapped in a non-async function.
$(() => (async () => {
  const stringifyException = (exception) => {
    let err = exception.stack || exception.toString();

    // FF / Opera do not add the message
    if (!~err.indexOf(exception.message)) {
      err = `${exception.message}\n${err}`;
    }

    // <=IE7 stringifies to [Object Error]. Since it can be overloaded, we
    // check for the result of the stringifying.
    if (err === '[object Error]') err = exception.message;

    // Safari doesn't give you a stack. Let's at least provide a source line.
    if (!exception.stack && exception.sourceURL && exception.line !== undefined) {
      err += `\n(${exception.sourceURL}:${exception.line})`;
    }

    return err;
  };

  const customRunner = (runner) => {
    const stats = {suites: 0, tests: 0, passes: 0, pending: 0, failures: 0};
    let level = 0;

    if (!runner) return;

    // AUTO-SCROLLING:

    // Mocha can start multiple suites before the first 'suite' event is emitted. This can break the
    // logic used to determine if the div is already scrolled to the bottom. If this is false,
    // auto-scrolling unconditionally scrolls to the bottom no matter how far up the div is
    // currently scrolled. If true, auto-scrolling only happens if the div is scrolled close to the
    // bottom.
    let manuallyScrolled = false;
    // The 'scroll' event is fired for manual scrolling as well as JavaScript-initiated scrolling.
    // This is incremented while auto-scrolling and decremented when done auto-scrolling. This is
    // used to ensure that auto-scrolling never sets manuallyScrolled to true.
    let autoScrolling = 0;

    // Auto-scroll the #mocha-report div to show the newly added test entry if it was previously
    // scrolled to the bottom.
    const autoscroll = (newElement) => {
      const mr = $('#mocha-report')[0];
      const scroll = !manuallyScrolled || (() => {
        const offsetTopAbs = newElement.getBoundingClientRect().top;
        const mrOffsetTopAbs = mr.getBoundingClientRect().top - mr.scrollTop;
        const offsetTop = offsetTopAbs - mrOffsetTopAbs;
        // Add some margin to cover rounding error and to make it easier to engage the auto-scroll.
        return offsetTop <= mr.clientHeight + mr.scrollTop + 5;
      })();
      if (!scroll) return;
      ++autoScrolling;
      mr.scrollTop = mr.scrollHeight;
      manuallyScrolled = false;
    };

    $('#mocha-report').on('scroll', () => {
      if (!autoScrolling) manuallyScrolled = true;
      else --autoScrolling;
    });

    runner.on('start', () => {
      stats.start = new Date();
    });

    runner.on('suite', (suite) => {
      if (suite.root) return;
      autoscroll($('#mocha-report .suite').last()[0]);
      stats.suites++;
      append(suite.title);
      level++;
    });

    runner.on('suite end', (suite) => {
      if (suite.root) return;
      level--;

      if (level === 0) {
        append('');
      }
    });

    // max time a test is allowed to run
    // TODO this should be lowered once timeslider_revision.js is faster
    let killTimeout;
    runner.on('test end', () => {
      autoscroll($('#mocha-report .test').last()[0]);
      stats.tests++;
    });

    runner.on('pass', (test) => {
      if (killTimeout) clearTimeout(killTimeout);
      killTimeout = setTimeout(() => {
        append('FINISHED - [red]no test started since 5 minutes, tests stopped[clear]');
      }, 60000 * 5);

      const medium = test.slow() / 2;
      test.speed = test.duration > test.slow()
        ? 'slow'
        : test.duration > medium
          ? 'medium'
          : 'fast';

      stats.passes++;
      append(`-> [green]PASSED[clear] : ${test.title}   ${test.duration} ms`);
    });

    runner.on('fail', (test, err) => {
      if (killTimeout) clearTimeout(killTimeout);
      killTimeout = setTimeout(() => {
        append('FINISHED - [red]no test started since 5 minutes, tests stopped[clear]');
      }, 60000 * 5);

      stats.failures++;
      test.err = err;
      append(`-> [red]FAILED[clear] : ${test.title} ${stringifyException(test.err)}`);
    });

    runner.on('pending', (test) => {
      if (killTimeout) clearTimeout(killTimeout);
      killTimeout = setTimeout(() => {
        append('FINISHED - [red]no test started since 5 minutes, tests stopped[clear]');
      }, 60000 * 5);

      stats.pending++;
      append(`-> [yellow]PENDING[clear]: ${test.title}`);
    });

    const $console = $('#console');
    const append = (text) => {
      // Indent each line.
      const lines = text.split('\n').map((line) => ' '.repeat(level * 2) + line);
      $console.append(document.createTextNode(`${lines.join('\n')}\n`));
    };

    const total = runner.total;
    runner.on('end', () => {
      stats.end = new Date();
      stats.duration = stats.end - stats.start;
      const minutes = Math.floor(stats.duration / 1000 / 60);
      // chrome < 57 does not like this .toString().padStart('2', '0');
      const seconds = Math.round((stats.duration / 1000) % 60);
      if (stats.tests === total) {
        append(`FINISHED - ${stats.passes} tests passed, ${stats.failures} tests failed, ` +
               `${stats.pending} pending, duration: ${minutes}:${seconds}`);
      } else if (stats.tests > total) {
        append(`FINISHED - but more tests than planned returned ${stats.passes} tests passed, ` +
               `${stats.failures} tests failed, ${stats.pending} pending, ` +
               `duration: ${minutes}:${seconds}`);
        append(`${total} tests, but ${stats.tests} returned. ` +
               'There is probably a problem with your async code or error handling, ' +
               'see https://github.com/mochajs/mocha/issues/1327');
      } else {
        append(`FINISHED - but not all tests returned ${stats.passes} tests passed, ` +
               `${stats.failures} tests failed, ${stats.pending} tests pending, ` +
               `duration: ${minutes}:${seconds}`);
        append(`${total} tests, but only ${stats.tests} returned. ` +
               'Check for failed before/beforeEach-hooks (no `test end` is called for them ' +
               'and subsequent tests of the same suite are skipped), ' +
               'see https://github.com/mochajs/mocha/pull/1043');
      }
    });
  };

  const getURLParameter = (name) => (new URLSearchParams(location.search)).get(name);

  const absUrl = (url) => new URL(url, window.location.href).href;
  require.setRootURI(absUrl('../../javascripts/src'));
  require.setLibraryURI(absUrl('../../javascripts/lib'));
  require.setGlobalKeyPath('require');

  const Split = require('split-grid/dist/split-grid.min');
  new Split({
    columnGutters: [{
      track: 1,
      element: document.getElementById('separator'),
    }],
  });

  // Speed up tests by loading test definitions in parallel. Approach: Define a new global object
  // that has a define() method, which is a wrapper around window.require.define(). The wrapper
  // mutates the module definition function to temporarily replace Mocha's functions with
  // placeholders. The placeholders make it possible to defer the actual Mocha function calls until
  // after the modules are all loaded in parallel. require.setGlobalKeyPath() is used to coax

  // Per-module log of attempted Mocha function calls. Key is module path, value is an array of
  // [functionName, argsArray] arrays.
  const mochaCalls = new Map();
  const mochaFns = [
    'after',
    'afterEach',
    'before',
    'beforeEach',
    'context',
    'describe',
    'it',
    'run',
    'specify',
    'xcontext', // Undocumented as of Mocha 7.1.2.
    'xdescribe', // Undocumented as of Mocha 7.1.2.
    'xit', // Undocumented as of Mocha 7.1.2.
    'xspecify', // Undocumented as of Mocha 7.1.2.
  ];
  window.testRunnerRequire = {
    define(...args) {
      if (args.length === 2) args = [{[args[0]]: args[1]}];
      if (args.length !== 1) throw new Error('unexpected args passed to testRunnerRequire.define');
      const [origDefs] = args;
      const defs = {};
      for (const [path, origDef] of Object.entries(origDefs)) {
        defs[path] = origDef == null ? origDef : function (require, exports, module) {
          const calls = [];
          mochaCalls.set(module.id.replace(/\.js$/, ''), calls);
          // Backup Mocha functions. Note that because modules can require other modules, these
          // backups might be placeholders, not the actual Mocha functions.
          const backups = {};
          for (const fn of mochaFns) {
            if (typeof window[fn] !== 'function') continue;
            // Note: Test specs can require other modules, so window[fn] might be a placeholder
            // function, not the actual Mocha function.
            backups[fn] = window[fn];
            window[fn] = (...args) => calls.push([fn, args]);
          }
          try {
            return origDef.call(this, require, exports, module);
          } finally {
            Object.assign(window, backups);
          }
        };
      }
      return require.define(defs);
    },
  };
  require.setGlobalKeyPath('testRunnerRequire');
  // Increase fetch parallelism to speed up test spec loading. (Note: The browser might limit to a
  // lower value -- this is just an upper limit.)
  require.setRequestMaximum(20);

  const $log = $('<div>');
  const appendToLog = (msg) => {
    if (typeof msg === 'string') msg = document.createTextNode(msg);
    // Add some margin to cover rounding error and to make it easier to engage the auto-scroll.
    const scrolledToBottom = $log[0].scrollHeight <= $log[0].scrollTop + $log[0].clientHeight + 5;
    const $msg = $('<div>').css('white-space', 'nowrap').append(msg).appendTo($log);
    if (scrolledToBottom) $log[0].scrollTop = $log[0].scrollHeight;
    return $msg;
  };
  const $bar = $('<progress>');
  let barLastUpdate = Date.now();
  const incrementBar = async (amount = 1) => {
    $bar.attr('value', Number.parseInt($bar.attr('value')) + 1);
    // Give the browser an opportunity to draw the progress bar's new length. `await
    // Promise.resolve()` isn't enough, so a timeout is used. Sleeping every increment (even 0ms)
    // unnecessarily slows down spec loading so the sleep is occasional.
    if (Date.now() - barLastUpdate > 100) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      barLastUpdate = Date.now();
    }
  };
  const $progressArea = $('<div>')
      .css({'display': 'flex', 'flex-direction': 'column', 'height': '100%'})
      .append($('<div>').css({flex: '1 0 0'}))
      .append($('<div>')
          .css({'flex': '0 0 auto', 'font-weight': 'bold'})
          .text('Loading frontend test specs...'))
      .append($log.css({flex: '0 1 auto', overflow: 'auto'}))
      .append($bar.css({flex: '0 0 auto', width: '100%'}))
      .appendTo('#mocha');
  const specs = await $.getJSON('frontendTestSpecs.json');
  if (specs.length > 0) {
    $bar.attr({value: 0, max: specs.length * 2});
    await incrementBar(0);
  }
  const makeDesc = (spec) => `${spec
      .replace(/^ep_etherpad-lite\/tests\/frontend\/specs\//, '<core> ')
      .replace(/^([^/ ]*)\/static\/tests\/frontend\/specs\//, '<$1> ')}.js`;
  await Promise.all(specs.map(async (spec) => {
    const $msg = appendToLog(`Fetching ${makeDesc(spec)}...`);
    try {
      await new Promise((resolve, reject) => require(spec, (module) => {
        if (module == null) return reject(new Error(`failed to load module ${spec}`));
        resolve();
      }));
    } catch (err) {
      $msg.append($('<b>').css('color', 'red').text(' FAILED'));
      appendToLog($('<pre>').text(`${err.stack || err}`));
      throw err;
    }
    $msg.append(' done');
    await incrementBar();
  }));
  require.setGlobalKeyPath('require');
  delete window.testRunnerRequire;
  for (const spec of specs) {
    const desc = makeDesc(spec);
    const $msg = appendToLog(`Executing ${desc}...`);
    try {
      describe(desc, function () {
        for (const [fn, args] of mochaCalls.get(spec)) window[fn](...args);
      });
    } catch (err) {
      $msg.append($('<b>').css('color', 'red').text(' FAILED'));
      appendToLog($('<pre>').text(`${err.stack || err}`));
      throw err;
    }
    $msg.append(' done');
    await incrementBar();
  }
  $progressArea.remove();

  const grep = getURLParameter('grep');
  if (grep != null) {
    mocha.grep(grep);
  }
  const runner = mocha.run();
  customRunner(runner);
})());
