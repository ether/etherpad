'use strict';

import measured from 'measured-core';

const stats: any = measured.createCollection();

stats.shutdown = async (hookName: string, context: any) => {
  stats.end();
};

export default stats;
