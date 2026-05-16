'use strict';

import crypto from 'crypto';
import util from 'util';


/**
 * Promisified version of Node.js's crypto.hkdf.
 */
export const hkdf = util.promisify(crypto.hkdf);

/**
 * Promisified version of Node.js's crypto.randomBytes
 */
export const randomBytes = util.promisify(crypto.randomBytes);
