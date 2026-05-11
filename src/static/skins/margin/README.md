# margin — Etherpad skin

A standalone drop-in skin with eleven themes — one neutral default and five named themes each available in light and dark mode:

| Default | Light | Dark |
| --- | --- | --- |
| `colibris` | `editorial` | `editorial-dark` |
|  | `brutalist` | `brutalist-dark` |
|  | `paper` | `paper-dark` |
|  | `crt-light` | `crt` |
|  | `industrial-light` | `industrial` |

No external dependency on colibris — all component partials are vendored under `src/`.

## Install

1. Copy this `margin/` folder into `src/static/skins/`.
2. In `settings.json`, set:
   ```json
   "skinName": "margin"
   ```

No template edits are required. The skin applies the user's saved theme on load (defaulting to `colibris`), the Google Fonts stylesheet is `@import`-ed from `pad.css` / `index.css`, and a **Theme** dropdown is injected into the User Settings and Pad-wide Settings popups.

## Switch themes at runtime

The Settings popup (the gear icon in the toolbar) has a **Theme** dropdown in both User Settings and Pad-wide Settings columns. Selecting a theme persists the choice in `localStorage` under the `marginTheme` key and reflects across the pad and the lobby.

Programmatically, from DevTools:

```js
document.documentElement.dataset.theme = 'crt'
```

## Folder layout

```
margin/
├─ index.css         lobby / pad-list themes
├─ index.js          lobby JS (early theme bootstrap)
├─ pad.css           pad themes + component imports
├─ pad.js            pad JS hooks (theme bootstrap, Settings dropdown,
│                                  iframe theme propagation)
├─ timeslider.css    version timeline
├─ timeslider.js     timeslider JS
├─ src/
│  ├─ general.css, layout.css, pad-editor.css, pad-variants.css
│  ├─ components/    toolbar, chat, popups, users, gritter, scrollbars, …
│  └─ plugins/       comments, color picker, tables, …
└─ README.md
```

The `src/` partials are vendored from upstream colibris so this skin is fully self-contained — themes layer on top via `data-theme="…"` overrides in `pad.css` and `index.css`, and inherit the same CSS-variable contract (`--primary-color`, `--bg-color`, `--main-font-family`, `--editor-horizontal-padding`, …) that colibris exposes.
