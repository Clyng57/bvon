
/* eslint-disable no-useless-constructor */

const K_SYMBOL_IS_BVON = Symbol.for('neumatter.bvon.isBVONError')

/**
 * @public
 * @category Error
 *
 * `BSONError` objects are thrown when BSON ecounters an error.
 *
 * This is the parent class for all the other errors thrown by this library.
 */
export default class BVONError extends Error {
  /**
   * @public
   *
   * All errors thrown from the BVON library inherit from `BVONError`.
   * This method can assist with determining if an error originates from the BVON library
   * even if it does not pass an `instanceof` check against this class' constructor.
   *
   * @param {unknown} value - any javascript value that needs type checking
   */
  static isBVONError (value) {
    return (
      value != null &&
      typeof value === 'object' &&
      K_SYMBOL_IS_BVON in value &&
      value[K_SYMBOL_IS_BVON] === true &&
      // Do not access the following properties, just check existence
      'name' in value &&
      'message' in value &&
      'stack' in value
    )
  }

  /**
   *
   * @param {string} message
   */
  constructor (message) {
    super(message)
    // Error.captureStackTrace(this, this.constructor)
  }

  get [K_SYMBOL_IS_BVON] () {
    return true
  }

  get name () {
    return 'BVONError'
  }
}
