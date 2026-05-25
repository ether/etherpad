// @ts-nocheck
'use strict';
// Provides a require'able version of jQuery without leaking $ and jQuery;
import './vendors/jquery.js';

const jq = window.jQuery ?? window.$;
if (jq == null || typeof jq.noConflict !== 'function') {
  throw new Error('Failed to initialize jQuery from ./vendors/jquery.js');
}
const noConflictJq = jq.noConflict(true);

export {noConflictJq as jQuery, noConflictJq as $};
export default noConflictJq;
