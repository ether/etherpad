'use strict';

// Capability flags exposed to Etherpad plugins for runtime feature detection.
// Plugins should `try { require('ep_etherpad-lite/node/utils/PluginCapabilities') }
// catch { /* old core */ }` and degrade gracefully when a flag is missing.
//
// IMPORTANT: a flag here means the core implements the capability — it does
// not mean the capability is currently enabled on this Etherpad instance.
// Capabilities can be gated by per-instance settings; plugins must inspect
// the relevant runtime flag (typically reflected through clientVars) to
// decide whether to actually use the feature on a given pad load.

// True when applyPadSettings (client + server) preserves keys matching
// /^ep_[a-z0-9_]+$/ on pad.padOptions. The runtime gate is
// settings.enablePluginPadOptions (default false), mirrored to clients via
// clientVars.enablePluginPadOptions. See doc/plugins.md for the full
// contract (key namespace, validation, size caps).
export const padOptionsPluginPassthrough = true;
