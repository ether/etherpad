// @ts-nocheck
'use strict';
// Provides a require'able version of jQuery without leaking $ and jQuery;
window.$ = require('./vendors/jquery');
const jq = window.$.noConflict(true);
exports.jQuery = exports.$ = jq;
