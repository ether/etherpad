'use strict';

// Capability flags exposed to Etherpad plugins for runtime feature detection.
// Plugins should `try { require('ep_etherpad-lite/node/utils/PluginCapabilities') }
// catch { /* old core */ }` and degrade gracefully when a flag is missing.

// True when applyPadSettings (client + server) preserves keys matching
// /^ep_[a-z0-9_]+$/ on pad.padOptions, letting plugins ride the existing
// padoptions COLLABROOM broadcast and pad metadata persistence rail
// instead of inventing their own message type and storage.
export const padOptionsPluginPassthrough = true;
