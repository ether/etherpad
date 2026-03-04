import {ArgsExpressType} from "../../types/ArgsExpressType";
import settings from '../../utils/Settings';

const pwa = {
  name: settings.title || "Etherpad",
  short_name: settings.title,
  description: "A collaborative online editor",
  icons: [
    {
      "src": "/static/skins/colibris/images/fond.jpg",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/favicon.ico",
      "sizes": "64x64 32x32 24x24 16x16",
      type: "image/png"
    }
  ],
  start_url: "/",
  display: "fullscreen",
  theme_color: "#0f775b",
  background_color: "#0f775b"
}

exports.expressCreateServer = (hookName:string, args:ArgsExpressType, cb:Function) => {
  args.app.get('/manifest.json', (req:any, res:any) => {
    res.json(pwa);
  });

  return cb();
}
