'use strict';

import path from 'node:path';
const eejs = require('../../eejs')
import fs from 'node:fs';
const fsp = fs.promises;
const toolbar = require('../../utils/toolbar');
const hooks = require('../../../static/js/pluginfw/hooks');
import settings, {getEpVersion} from '../../utils/Settings';
import util from 'node:util';
const webaccess = require('./webaccess');
const plugins = require('../../../static/js/pluginfw/plugin_defs');

import {build, buildSync} from 'esbuild'
import {ArgsExpressType} from "../../types/ArgsExpressType";
import prometheus from "../../prometheus";

let ioI: { sockets: { sockets: any[]; }; } | null = null


exports.socketio = (hookName: string, {io}: any) => {
  ioI = io
}


exports.expressPreSession = async (hookName:string, {app}:ArgsExpressType) => {
  // This endpoint is intended to conform to:
  // https://www.ietf.org/archive/id/draft-inadarei-api-health-check-06.html
  app.get('/health', (req:any, res:any) => {
    res.set('Content-Type', 'application/health+json');
    res.json({
      status: 'pass',
      releaseId: getEpVersion(),
    });
  });

  if (settings.enableMetrics) {
    app.get('/stats', (req:any, res:any) => {
      res.json(require('../../stats').toJSON());
    });

    app.get('/stats/prometheus', async (req, res) => {
      const metrics = await prometheus()
      res.setHeader('Content-Type', metrics.contentType)
      res.send(await metrics.metrics())
    })
  }


  app.get('/javascript', (req:any, res:any) => {
    res.send(eejs.require('ep_etherpad-lite/templates/javascript.html', {req}));
  });

  app.get('/robots.txt', (req:any, res:any) => {
    if (!settings.skinName) {
      // if no skin is set, send the default robots.txt
      return res.sendFile(path.join(settings.root, 'src', 'static', 'robots.txt'));
    }
    let filePath =
      path.join(settings.root, 'src', 'static', 'skins', settings.skinName, 'robots.txt');
    res.sendFile(filePath, (err:any) => {
      // there is no custom robots.txt, send the default robots.txt which dissallows all
      if (err) {
        filePath = path.join(settings.root, 'src', 'static', 'robots.txt');
        res.sendFile(filePath);
      }
    });
  });

  app.get('/favicon.ico', (req:any, res:any, next:Function) => {
    (async () => {
      /*
        If this is a url we simply redirect to that one.
       */
      if (settings.favicon && settings.favicon.startsWith('http')) {
        res.redirect(settings.favicon);
        res.send();
        return;
      }


      const fns = [
        ...(settings.favicon ? [path.resolve(settings.root, settings.favicon)] : []),
        settings.skinName && path.join(settings.root, 'src', 'static', 'skins', settings.skinName, 'favicon.ico'),
        path.join(settings.root, 'src', 'static', 'favicon.ico'),
      ].filter(f=>f != null);
      for (const fn of fns) {
        try {
          await fsp.access(fn, fs.constants.R_OK);
        } catch (err) {
          continue;
        }
        res.setHeader('Cache-Control', `public, max-age=${settings.maxAge}`);
        await util.promisify(res.sendFile.bind(res))(fn);
        return;
      }
      next();
    })().catch((err) => next(err || new Error(err)));
  });
};



const convertTypescript = (content: string) => {
  const outputRaw = buildSync({
    stdin: {
      contents: content,
      resolveDir: path.join(settings.root, 'var','js'),
      loader: 'js'
    },
    alias:{
      "ep_etherpad-lite/static/js/browser": 'ep_etherpad-lite/static/js/vendors/browser',
      "ep_etherpad-lite/static/js/nice-select": 'ep_etherpad-lite/static/js/vendors/nice-select'
    },
    bundle: true, // Bundle the files together
    minify: process.env.NODE_ENV === "production", // Minify the output
    sourcemap: !(process.env.NODE_ENV === "production"), // Generate source maps
    sourceRoot: settings.root+"/src/static/js/",
    target: ['es2020'], // Target ECMAScript version
    metafile: true,
    write: false, // Do not write to file system,
  })
  const output = outputRaw.outputFiles[0].text

  return  {
    output,
    hash: outputRaw.outputFiles[0].hash.replaceAll('/','2').replaceAll("+",'5').replaceAll("^","7")
  }
}

const handleLiveReload = async (args: ArgsExpressType, padString: string, timeSliderString: string, indexString: any) => {
  const chokidar = await import('chokidar')
  const watcher = chokidar.watch(path.join(settings.root, 'src', 'static', 'js'), {});
  let routeHandlers: { [key: string]: Function } = {};

  const setRouteHandler = (path: string, newHandler: Function) => {
    routeHandlers[path] = newHandler;
  };
  args.app.use((req: any, res: any, next: Function) => {
    if (req.path.startsWith('/p/') && req.path.split('/').length == 3) {
      req.params = {
        pad: req.path.split('/')[2]
      }
      routeHandlers['/p/:pad'](req, res);
    } else if (req.path.startsWith('/p/') && req.path.split('/').length == 4) {
      req.params = {
        pad: req.path.split('/')[2]
      }
      routeHandlers['/p/:pad/timeslider'](req, res);
    } else if (req.path == "/"){
      routeHandlers['/'](req, res);
    } else if (routeHandlers[req.path]) {
      routeHandlers[req.path](req, res);
    } else {
      next();
    }
  });

  function handleUpdate() {

    convertTypescriptWatched(indexString, (output, hash) => {
      setRouteHandler('/watch/index', (req: any, res: any) => {
        res.header('Content-Type', 'application/javascript');
        res.send(output)
      })
      setRouteHandler('/', (req: any, res: any) => {
        res.send(eejs.require('ep_etherpad-lite/templates/index.html', {req, entrypoint: '/watch/index?hash=' + hash, settings}));
      })
    })

    convertTypescriptWatched(padString, (output, hash) => {
      console.log("New pad hash is", hash)
      setRouteHandler('/watch/pad', (req: any, res: any) => {
        res.header('Content-Type', 'application/javascript');
        res.send(output)
      })




      setRouteHandler("/p/:pad", (req: any, res: any, next: Function) => {
        // The below might break for pads being rewritten
        const isReadOnly = !webaccess.userCanModify(req.params.pad, req);

        hooks.callAll('padInitToolbar', {
          toolbar,
          isReadOnly
        });

        const content = eejs.require('ep_etherpad-lite/templates/pad.html', {
          req,
          toolbar,
          isReadOnly,
          entrypoint: '/watch/pad?hash=' + hash,
          settings: settings.getPublicSettings()
        })
        res.send(content);
      })
      ioI!.sockets.sockets.forEach(socket => socket.emit('liveupdate'))
    })
    convertTypescriptWatched(timeSliderString, (output, hash) => {
      // serve timeslider.html under /p/$padname/timeslider
      console.log("New timeslider hash is", hash)

      setRouteHandler('/watch/timeslider', (req: any, res: any) => {
        res.header('Content-Type', 'application/javascript');
        res.send(output)
      })

      setRouteHandler("/p/:pad/timeslider", (req: any, res: any, next: Function) => {
        console.log("Reloading pad")
        // The below might break for pads being rewritten
        const isReadOnly = !webaccess.userCanModify(req.params.pad, req);

        hooks.callAll('padInitToolbar', {
          toolbar,
          isReadOnly
        });

        const content = eejs.require('ep_etherpad-lite/templates/timeslider.html', {
          req,
          toolbar,
          isReadOnly,
          entrypoint: '/watch/timeslider?hash=' + hash,
          settings: settings.getPublicSettings()
        })
        res.send(content);
      })
    })
  }

  watcher.on('change', path => {
    console.log(`File ${path} has been changed`);
    handleUpdate();
  });
  handleUpdate()
}

const convertTypescriptWatched = (content: string, cb: (output:string, hash: string)=>void) => {
  build({
    stdin: {
      contents: content,
      resolveDir: path.join(settings.root, 'var','js'),
      loader: 'js'
    },
    alias:{
      "ep_etherpad-lite/static/js/browser": 'ep_etherpad-lite/static/js/vendors/browser',
      "ep_etherpad-lite/static/js/nice-select": 'ep_etherpad-lite/static/js/vendors/nice-select'
    },
    bundle: true, // Bundle the files together
    minify: process.env.NODE_ENV === "production", // Minify the output
    sourcemap: !(process.env.NODE_ENV === "production"), // Generate source maps
    sourceRoot: settings.root+"/src/static/js/",
    target: ['es2020'], // Target ECMAScript version
    metafile: true,
    write: false, // Do not write to file system,
  }).then((outputRaw) => {
    cb(
      outputRaw.outputFiles[0].text,
      outputRaw.outputFiles[0].hash.replaceAll('/','2').replaceAll("+",'5').replaceAll("^","7")
    )
  })
}

exports.expressCreateServer = async (_hookName: string, args: ArgsExpressType, cb: Function) => {
  const padString =   eejs.require('ep_etherpad-lite/templates/padBootstrap.js', {
    pluginModules: (() => {
      const pluginModules = new Set();
      for (const part of plugins.parts) {
        for (const [, hookFnName] of Object.entries(part.client_hooks || {})) {
          // @ts-ignore
          pluginModules.add(hookFnName.split(':')[0]);
        }
      }
      return [...pluginModules];
    })(),
    settings,
  })

  const indexString = eejs.require('ep_etherpad-lite/templates/indexBootstrap.js', {
  })

  const timeSliderString = eejs.require('ep_etherpad-lite/templates/timeSliderBootstrap.js', {
    pluginModules: (() => {
      const pluginModules = new Set();
      for (const part of plugins.parts) {
        for (const [, hookFnName] of Object.entries(part.client_hooks || {})) {
          // @ts-ignore
          pluginModules.add(hookFnName.split(':')[0]);
        }
      }
      return [...pluginModules];
    })(),
    settings,
  })



  const outdir = path.join(settings.root, 'var','js')
  // Create the outdir if it doesn't exist
  if (!fs.existsSync(outdir)) {
    fs.mkdirSync(outdir);
  }

  let fileNamePad: string
  let fileNameTimeSlider: string
  let fileNameIndex: string
  if(process.env.NODE_ENV === "production"){
    const padSliderWrite = convertTypescript(padString)
    const timeSliderWrite = convertTypescript(timeSliderString)
    const indexWrite = convertTypescript(indexString)

    fileNamePad = `padbootstrap-${padSliderWrite.hash}.min.js`
    fileNameTimeSlider = `timeSliderBootstrap-${timeSliderWrite.hash}.min.js`
    fileNameIndex = `indexBootstrap-${indexWrite.hash}.min.js`

    args.app.get("/"+fileNamePad, (_req, res) => {
      res.header('Content-Type', 'application/javascript');
      res.send(padSliderWrite.output)
    })

    args.app.get("/"+fileNameIndex, (_req, res) => {
      res.header('Content-Type', 'application/javascript');
      res.send(indexWrite.output)
    })

    args.app.get("/"+fileNameTimeSlider, (_req, res) => {
      res.header('Content-Type', 'application/javascript');
      res.send(timeSliderWrite.output)
    })

    // serve index.html under /
    args.app.get('/', (req: any, res: any) => {
      res.send(eejs.require('ep_etherpad-lite/templates/index.html', {req, settings, entrypoint: "./"+fileNameIndex}));
    });


    // serve pad.html under /p
    args.app.get('/p/:pad', (req: any, res: any, next: Function) => {
      // The below might break for pads being rewritten
      const isReadOnly = !webaccess.userCanModify(req.params.pad, req);

      hooks.callAll('padInitToolbar', {
        toolbar,
        isReadOnly
      });

      const content = eejs.require('ep_etherpad-lite/templates/pad.html', {
        req,
        toolbar,
        isReadOnly,
        entrypoint: "../"+fileNamePad,
        settings: settings.getPublicSettings()
      })
      res.send(content);
    });

    // serve timeslider.html under /p/$padname/timeslider
    args.app.get('/p/:pad/timeslider', (req: any, res: any, next: Function) => {
      hooks.callAll('padInitToolbar', {
        toolbar,
      });

      res.send(eejs.require('ep_etherpad-lite/templates/timeslider.html', {
        req,
        toolbar,
        entrypoint: "../../"+fileNameTimeSlider,
        settings: settings.getPublicSettings()
      }));
    });
  } else {
    await handleLiveReload(args, padString, timeSliderString, indexString)
  }

  // The client occasionally polls this endpoint to get an updated expiration for the express_sid
  // cookie. This handler must be installed after the express-session middleware.
  args.app.put('/_extendExpressSessionLifetime', (req: any, res: any) => {
    // express-session automatically calls req.session.touch() so we don't need to do it here.
    res.json({status: 'ok'});
  });
};
