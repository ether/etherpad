'use strict';

const measured = require('measured-core');

module.exports = measured.createCollection();

// @ts-ignore
module.exports.shutdown = async (hookName, context) => {
  module.exports.end();
};