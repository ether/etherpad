'use strict';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import assert from 'assert';
import common from '../common.js';
import i18n from '../../../node/hooks/i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe(__filename, function () {
  before(async function () {
    await common.init();
  });

  it('availableLangs are sorted by nativeName (case-insensitive)', async function () {
    const langs = i18n.availableLangs;
    assert(langs != null, 'availableLangs should be populated after server init');

    const nativeNames: string[] = Object.values(langs).map((info: any) => info.nativeName || '');
    assert(nativeNames.length > 1, 'expected more than one language');

    for (let i = 1; i < nativeNames.length; i++) {
      const cmp = nativeNames[i - 1].localeCompare(nativeNames[i], undefined, {sensitivity: 'base'});
      assert(
        cmp <= 0,
        `languages not sorted: "${nativeNames[i - 1]}" should come before "${nativeNames[i]}" ` +
        `(index ${i - 1} vs ${i})`,
      );
    }
  });
});
