# margin GÇö Etherpad skin

A standalone drop-in skin with six themes and an orthogonal Light/Dark toggle:

| Theme | Light | Dark | Natural mode |
| --- | --- | --- | --- |
| `colibris` | G£ô | GÇö | light (no dark palette) |
| `editorial` | G£ô | G£ô | light |
| `brutalist` | G£ô | G£ô | light |
| `paper` | G£ô | G£ô | light |
| `crt` | G£ô | G£ô | dark |
| `industrial` | G£ô | G£ô | dark |

The current `data-theme` and `data-mode` attributes live on `<html>`. Mode is paired with theme in CSS via `[data-theme="X"][data-mode="light|dark"]`.

No external dependency on colibris GÇö all component partials are vendored under `src/`.

## Install

1. Copy this `margin/` folder into `src/static/skins/`.
2. In `settings.json`, set:
   ```json
   "skinName": "margin"
   ```

No template edits are required. The skin applies the user's saved theme + mode on load (defaulting to `colibris` + the theme's natural mode), the Google Fonts stylesheet is `@import`-ed from `pad.css` / `index.css`, and a **Theme** dropdown plus a **Dark mode** checkbox are injected into both the User Settings and Pad-wide Settings columns of the Settings popup.

## Switch themes at runtime

The Settings popup (gear icon in the toolbar) has:
- a **Theme** dropdown with the six themes,
- a **Dark mode** checkbox (orthogonal GÇö flips lightGåödark for any theme that has a dark palette).

Choices persist in `localStorage` under `marginTheme` + `marginMode` and propagate across the pad and the lobby.

Programmatically, from DevTools:

```js
document.documentElement.dataset.theme = 'crt';
document.documentElement.dataset.mode = 'dark';
```

## Folder layout

```
margin/
Gö£GöÇ index.css         lobby / pad-list themes
Gö£GöÇ index.js          lobby JS (early theme bootstrap)
Gö£GöÇ pad.css           pad themes + component imports
Gö£GöÇ pad.js            pad JS hooks (theme bootstrap, Settings dropdown,
Göé                                  iframe theme propagation)
Gö£GöÇ timeslider.css    version timeline
Gö£GöÇ timeslider.js     timeslider JS
Gö£GöÇ src/
Göé  Gö£GöÇ general.css, layout.css, pad-editor.css, pad-variants.css
Göé  Gö£GöÇ components/    toolbar, chat, popups, users, gritter, scrollbars, GÇª
Göé  GööGöÇ plugins/       comments, color picker, tables, GÇª
GööGöÇ README.md
```

The `src/` partials are vendored from upstream colibris so this skin is fully self-contained GÇö themes layer on top via `data-theme="GÇª"` overrides in `pad.css` and `index.css`, and inherit the same CSS-variable contract (`--primary-color`, `--bg-color`, `--main-font-family`, `--editor-horizontal-padding`, GÇª) that colibris exposes.
