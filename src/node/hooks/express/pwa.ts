import {ArgsExpressType} from "../../types/ArgsExpressType.js";
import settings from '../../utils/Settings.js';
import {sanitizeProxyPath} from '../../utils/sanitizeProxyPath.js';

const buildManifest = (proxyPath: string) => ({
  name: settings.title || "Etherpad",
  short_name: settings.title,
  description: "A collaborative online editor",
  icons: [
    {
      "src": `${proxyPath}/static/skins/colibris/images/fond.jpg`,
      "sizes": "512x512",
      "type": "image/png",
    },
    {
      "src": `${proxyPath}/favicon.ico`,
      "sizes": "64x64 32x32 24x24 16x16",
      type: "image/png",
    },
  ],
  start_url: `${proxyPath}/`,
  display: "fullscreen",
  theme_color: "#0f775b",
  background_color: "#0f775b",
});

export const expressCreateServer = (hookName:string, args:ArgsExpressType, cb:Function) => {
  args.app.get('/manifest.json', (req:any, res:any) => {
    const proxyPath = sanitizeProxyPath(req);
    if (proxyPath) {
      res.setHeader('Vary', 'x-proxy-path, x-forwarded-prefix, x-ingress-path');
      res.setHeader('Cache-Control', 'private, no-store');
    }
    res.json(buildManifest(proxyPath));
  });

  return cb();
};
