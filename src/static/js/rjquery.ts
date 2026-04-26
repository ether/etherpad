// @ts-nocheck
'use strict';
// Provides a require'able version of jQuery without leaking $ and jQuery;
import $ from './vendors/jquery.js';
window.$ = $;
const jq = window.$.noConflict(true);

export {jq as jQuery, jq as $};
