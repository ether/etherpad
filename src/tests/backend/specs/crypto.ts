'use strict';


import {Buffer} from 'buffer';
import nodeCrypto from 'crypto';
import util from 'util';

const nodeHkdf = nodeCrypto.hkdf ? util.promisify(nodeCrypto.hkdf) : null;

const ab2hex = (ab:string) => Buffer.from(ab).toString('hex');
