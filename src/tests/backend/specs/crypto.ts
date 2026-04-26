'use strict';


import {Buffer} from 'buffer';
import nodeCrypto from 'crypto';
import util from 'util';

const nodeHkdf = nodeCrypto.hkdf ? util.promisify(nodeCrypto.hkdf) : null;

const ab2hex = (ab:string) => Buffer.from(ab).toString('hex');

// TODO: This file is a placeholder. The original mocha-era spec only exported
// helpers and never declared a top-level describe. Add real crypto tests here.
describe('crypto utilities (placeholder)', () => {
  it.skip('TODO: add tests for nodeHkdf / ab2hex helpers', () => {});
});
