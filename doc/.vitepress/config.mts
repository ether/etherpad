import { defineConfig } from 'vitepress'
import {version} from '../../package.json'
// https://vitepress.dev/reference/site-config
const commitRef = process.env.COMMIT_REF?.slice(0, 8) || 'dev'


export default defineConfig({
  title: "Etherpad Documentation",
  description: "Next Generation Collaborative Document Editing",
  base: '/',
  themeConfig: {
    search: {
      provider: 'local'
    },
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting started', link: '/docker.md' }
    ],
    logo:'/favicon.ico',

    sidebar: {
        '/': [
          {
            link: '/',
            text: 'About',
            items: [
                { text: 'Docker', link: '/docker.md' },
                { text: 'Localization', link: '/localization.md' },
                { text: 'Cookies', link: '/cookies.md' },
                { text: 'Plugins', link: '/plugins.md' },
                { text: 'Stats', link: '/stats.md' },
                {text: 'Skins', link: '/skins.md' },
                {text: 'Demo', link: '/demo.md' },
              {text: 'CLI', link: '/cli.md'},
                ]
          },
          {
            text: 'API',
            link: '/api/',
            items: [
              { text: 'Changeset', link: '/api/changeset_library.md' },
              {text: 'Editbar', link: '/api/editbar.md' },
              {text: 'EditorInfo', link: '/api/editorInfo.md' },
              {text: 'Embed Parameters', link: '/api/embed_parameters.md' },
              {text: 'Hooks Client Side', link: '/api/hooks_client-side.md' },
              {text: 'Hooks Server Side', link: '/api/hooks_server-side.md' },
              {text: 'Plugins', link: '/api/pluginfw.md' },
              {text: 'Toolbar', link: '/api/toolbar.md' },
              {text: 'HTTP API', link: '/api/http_api.md' },
            ]
          },
          {
          text: 'Old Docs',
            items: [
                { text: 'Easysync description', link: '/etherpad-lite/easysync/easysync-full-description.pdf' },
                { text: 'Easysync notes', link: '/etherpad-lite/easysync/easysync-notes.pdf' }
            ]
          }
        ],
      '/stats': [
        {
          text: 'Stats',
          items:[
            { text: 'Stats', link: '/stats/' }
          ]
        }
      ]
    },
    footer: {
      message: `Published under Apache License`,
      copyright: `(${commitRef}) v${version} by Etherpad Foundation`
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ether/etherpad-lite' }
    ]
  }
})
