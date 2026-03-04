'use strict';
import fs from 'node:fs';

const check = (path:string) => {
  const existsSync = fs.statSync || fs.existsSync;

  let result;
  try {
    result = existsSync(path);
  } catch (e) {
    result = false;
  }
  return result;
};

export default check;
