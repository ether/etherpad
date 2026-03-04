'use strict';

const CustomError = require('../utils/customError');

// checks if a rev is a legal number
// pre-condition is that `rev` is not undefined
const checkValidRev = (rev: number|string) => {
  if (typeof rev !== 'number') {
    rev = parseInt(rev, 10);
  }

  // check if rev is a number
  if (isNaN(rev)) {
    throw new CustomError('rev is not a number', 'apierror');
  }

  // ensure this is not a negative number
  if (rev < 0) {
    throw new CustomError('rev is not a negative number', 'apierror');
  }

  // ensure this is not a float value
  if (!isInt(rev)) {
    throw new CustomError('rev is a float value', 'apierror');
  }

  return rev;
};

// checks if a number is an int
const isInt = (value:number) => (parseFloat(String(value)) === parseInt(String(value), 10)) && !isNaN(value);

exports.isInt = isInt;
exports.checkValidRev = checkValidRev;
