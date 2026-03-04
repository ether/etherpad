'use strict';

const crypto = require('crypto');
const util = require('util');


/**
 * Promisified version of Node.js's crypto.hkdf.
 */
exports.hkdf = util.promisify(crypto.hkdf);

/**
 * Promisified version of Node.js's crypto.randomBytes
 */
exports.randomBytes = util.promisify(crypto.randomBytes);
