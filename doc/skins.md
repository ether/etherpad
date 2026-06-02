# Skins
You can customize Etherpad appearance using skins.
A skin is a directory located under `static/skins/<skin_name>`, with the following contents:

* `index.js`: javascript that will be run in `/`
* `index.css`: stylesheet affecting `/`
* `pad.js`: javascript that will be run in `/p/:padid`
* `pad.css`: stylesheet affecting `/p/:padid`
* `timeslider.js`: javascript that will be run in the embedded timeslider iframe
* `timeslider.css`: stylesheet affecting the embedded timeslider iframe

Since Etherpad **2.7**, the timeslider is rendered in-place inside the pad
page (issue #7659). Direct visits to `/p/:padid/timeslider` 302-redirect to
`/p/:padid` so the in-pad PadModeController can take over via a `#rev/N`
URL hash. The full timeslider HTML is still served at
`/p/:padid/timeslider?embed=1` — that is the URL the in-pad iframe loads,
and the URL to use if you embed the timeslider in your own page.
* `favicon.ico`: overrides the default favicon
* `robots.txt`: overrides the default `robots.txt`

You can choose a skin changing the parameter `skinName` in `settings.json`.

Two skins are included:

* `colibris`: the current default skin, used by Etherpad out of the box. This is what you see in a standard installation.
* `no-skin`: an unstyled base skin that leaves the default Etherpad appearance unchanged. Use it as a starting point and guidance to develop your own skin.
