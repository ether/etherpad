'use strict';
/**
 * CustomError
 *
 * This helper modules allows us to create different type of errors we can throw
 *
 * @class CustomError
 * @extends {Error}
 */
class CustomError extends Error {
  /**
   * Creates an instance of CustomError.
   * @param {string} message
   * @param {string} [name='Error'] a custom name for the error object
   * @memberof CustomError
   */
  constructor(message:string, name: string = 'Error') {
    super(message);
    this.name = name;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = CustomError;
