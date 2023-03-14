
import ByteView from 'byteview'
import BVONError from './BVONError.js'

/** @typedef {string | number | Int64} Int64Other */

// WebAssembly optimizations to do native i64 multiplication and divide
let wasm = null

try {
  wasm = new WebAssembly.Instance(
    new WebAssembly.Module(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 13, 2, 96, 0, 1, 127, 96, 4, 127, 127, 127, 127, 1, 127, 3, 7, 6, 0, 1, 1, 1, 1, 1, 6, 6, 1, 127, 1, 65, 0, 11, 7, 50, 6, 3, 109, 117, 108, 0, 1, 5, 100, 105, 118, 95, 115, 0, 2, 5, 100, 105, 118, 95, 117, 0, 3, 5, 114, 101, 109, 95, 115, 0, 4, 5, 114, 101, 109, 95, 117, 0, 5, 8, 103, 101, 116, 95, 104, 105, 103, 104, 0, 0, 10, 191, 1, 6, 4, 0, 35, 0, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 126, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 127, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 128, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 129, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 130, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11
      ])
    ),
    {}
  ).exports
} catch (e) {
  wasm = null
  // no wasm support
}

const K_SYMBOL_IS_INT64 = Symbol.for('neumatter.bvon.isInt64')
const UINT_CACHE = new Map()
const INT_CACHE = new Map()
const TWO_PWR_16_DBL = 1 << 16
const TWO_PWR_24_DBL = 1 << 24
const TWO_PWR_32_DBL = TWO_PWR_16_DBL * TWO_PWR_16_DBL
const TWO_PWR_64_DBL = TWO_PWR_32_DBL * TWO_PWR_32_DBL
const TWO_PWR_63_DBL = TWO_PWR_64_DBL / 2
const MAX_INT64_STRING_LENGTH = 20
const INT64_REG_EX = /^(\+?0|(\+|-)?[1-9][0-9]*)$/

export default class Int64 {
  static ZERO = (() => new Int64(0, 0, false))()
  static UNSIGNED_ZERO = (() => new Int64(0, 0, true))()
  static ONE = (() => new Int64(1, 0, false))()
  static UNSIGNED_ONE = (() => new Int64(1, 0, true))()
  static NEGATIVE_ONE = (() => new Int64(-1, -1, false))()
  static MAX_VALUE = (() => new Int64(0xffffffff | 0, 0x7fffffff | 0, false))()
  static MAX_UNSIGNED_VALUE = (() => new Int64(0xffffffff | 0, 0xffffffff | 0, true))()
  static MIN_VALUE = (() => new Int64(0, 0x80000000 | 0, false))()

  static isInt64 (value) {
    return (
      value != null &&
      typeof value === 'object' &&
      K_SYMBOL_IS_INT64 in value &&
      value[K_SYMBOL_IS_INT64] === true
    )
  }

  static isSafeInteger (value) {
    let res = false

    switch (typeof value) {
      case 'number':
        if (Number.isSafeInteger(value)) {
          res = true
        }
        break
      case 'string': {
        if (value.length > 20) break
        const match = value.match(INT64_REG_EX)
        if (!match) break
        const int64 = Int64.from(value)
        if (
          int64.lessThanOrEqual(Int64.MAX_VALUE) &&
          int64.greaterThanOrEqual(Int64.MIN_VALUE)
        ) {
          res = true
        }
        break
      }
    }

    return res
  }

  /**
   *
   * @param {number | string | Uint8Array | Array<number> | Int64} value
   * @param {boolean} unsigned
   * @returns {Int64}
   */
  static from (value, unsigned) {
    switch (typeof value) {
      case 'number':
        return fromNumber(value, unsigned)
      case 'bigint':
        return fromString(value.toString(), unsigned)
      case 'string':
        return fromString(value, unsigned)
      case 'boolean':
        return fromNumber(Number(value), unsigned)
      case 'undefined':
        return Int64.ZERO
      case 'object':
        if (value === null) return Int64.ZERO
        if (Array.isArray(value) || value instanceof Uint8Array) {
          return fromBytes(value, unsigned)
        }
        // Throws for non-objects, converts non-instanceof Long:
        return new Int64(
          value.low,
          value.high,
          typeof unsigned === 'boolean' ? unsigned : value.unsigned
        )
      default:
        throw new TypeError('could not find valid type')
    }
  }

  #unsigned

  constructor (low, high, unsigned) {
    this[0] = low | 0
    this[1] = high | 0
    this.#unsigned = Boolean(unsigned)
  }

  get low () {
    return this[0]
  }

  get high () {
    return this[1]
  }

  get absBitLength () {
    if (this.isNegative) {
      // Unsigned Longs are never negative
      return this.equals(Int64.MIN_VALUE) ? 64 : this.negate().absBitLength
    }

    const val = this.high !== 0 ? this.high : this.low
    let bit
    for (bit = 31; bit > 0; bit--) if ((val & (1 << bit)) !== 0) break
    return this.high !== 0 ? bit + 33 : bit + 1
  }

  get unsigned () {
    return this.#unsigned
  }

  get isValueSafe () {
    const value = this.valueOf()

    if (
      value > Number.MAX_SAFE_INTEGER ||
      value < Number.MIN_SAFE_INTEGER
    ) {
      return false
    }

    return true
  }

  get [K_SYMBOL_IS_INT64] () {
    return true
  }

  get isEven () {
    return (this.low & 1) === 0
  }

  get isNegative () {
    return !this.unsigned && this.high < 0
  }

  get isOdd () {
    return (this.low & 1) === 1
  }

  get isPositive () {
    return this.unsigned || this.high >= 0
  }

  get isZero () {
    return this.high === 0 && this.low === 0
  }

  /**
   *
   * @param {string | number | Long} addend
   * @returns {Int64}
   */
  add (addend) {
    if (!Int64.isInt64(addend)) {
      addend = Int64.from(addend)
    }

    // Divide each number into 4 chunks of 16 bits, and then sum the chunks.

    const a48 = this.high >>> 16
    const a32 = this.high & 0xffff
    const a16 = this.low >>> 16
    const a00 = this.low & 0xffff

    const b48 = addend.high >>> 16
    const b32 = addend.high & 0xffff
    const b16 = addend.low >>> 16
    const b00 = addend.low & 0xffff

    let c48 = 0
    let c32 = 0
    let c16 = 0
    let c00 = 0
    c00 += a00 + b00
    c16 += c00 >>> 16
    c00 &= 0xffff
    c16 += a16 + b16
    c32 += c16 >>> 16
    c16 &= 0xffff
    c32 += a32 + b32
    c48 += c32 >>> 16
    c32 &= 0xffff
    c48 += a48 + b48
    c48 &= 0xffff

    const low = (c16 << 16) | c00
    const high = (c48 << 16) | c32

    return new Int64(low, high, this.unsigned)
  }

  /**
   *
   * @param {Int64Other} other
   * @returns {Int64}
   */
  and (other) {
    if (!Int64.isInt64(other)) {
      other = Int64.from(other)
    }

    return new Int64(
      this.low & other.low,
      this.high & other.high,
      this.unsigned
    )
  }

  /**
   *
   * @param {Int64Other} other
   * @returns {0 | 1 | -1}
   */
  compare (other) {
    if (!Int64.isInt64(other)) {
      other = Int64.from(other)
    }
    if (this.equals(other)) return 0
    const thisNeg = this.isNegative
    const otherNeg = other.isNegative
    if (thisNeg && !otherNeg) return -1
    if (!thisNeg && otherNeg) return 1
    // At this point the sign bits are the same
    if (!this.unsigned) return this.subtract(other).isNegative ? -1 : 1
    // Both are positive if at least one is unsigned
    return other.high >>> 0 > this.high >>> 0 ||
      (other.high === this.high && other.low >>> 0 > this.low >>> 0)
      ? -1
      : 1
  }

  /**
   *
   * @param {Int64Other} divisor
   * @returns {Int64}
   */
  divide (divisor) {
    if (!Int64.isInt64(divisor)) {
      divisor = Int64.from(divisor)
    }

    if (divisor.isZero) throw new BVONError('division by zero')

    // use wasm support if present
    if (wasm) {
      // guard against signed division overflow: the largest
      // negative number / -1 would be 1 larger than the largest
      // positive number, due to two's complement.
      if (
        !this.unsigned &&
        this.high === -0x80000000 &&
        divisor.low === -1 &&
        divisor.high === -1
      ) {
        // be consistent with non-wasm code path
        return this
      }
      const low = (this.unsigned ? wasm.div_u : wasm.div_s)(
        this.low,
        this.high,
        divisor.low,
        divisor.high
      )

      return new Int64(low, wasm.get_high(), this.unsigned)
    }

    if (this.isZero) {
      return this.unsigned ? Int64.UNSIGNED_ZERO : Int64.ZERO
    }

    let approx, rem, res
    if (!this.unsigned) {
      // This section is only relevant for signed longs and is derived from the
      // closure library as a whole.
      if (this.equals(Int64.MIN_VALUE)) {
        if (
          divisor.equals(Int64.ONE) ||
          divisor.equals(Int64.NEGATIVE_ONE)
        ) {
          return Int64.MIN_VALUE
        } else if (divisor.equals(Int64.MIN_VALUE)) {
          return Int64.ONE
        } else {
          // At this point, we have |other| >= 2, so |this/other| < |MIN_VALUE|.
          const halfThis = this.shiftRight(1)
          approx = halfThis.divide(divisor).shiftLeft(1)

          if (approx.equals(Int64.ZERO)) {
            return divisor.isNegative ? Int64.ONE : Int64.NEGATIVE_ONE
          } else {
            rem = this.subtract(divisor.multiply(approx))
            res = approx.add(rem.divide(divisor))
            return res
          }
        }
      } else if (divisor.equals(Int64.MIN_VALUE)) {
        return this.unsigned ? Int64.UNSIGNED_ZERO : Int64.ZERO
      }

      if (this.isNegative) {
        if (divisor.isNegative) return this.negate().divide(divisor.negate())
        return this.negate().divide(divisor).negate()
      } else if (divisor.isNegative) return this.divide(divisor.negate()).negate()
      res = Int64.ZERO
    } else {
      // The algorithm below has not been made for unsigned longs. It's therefore
      // required to take special care of the MSB prior to running it.
      if (!divisor.unsigned) divisor = divisor.toUnsigned()
      if (divisor.greaterThan(this)) return Int64.UNSIGNED_ZERO

      if (divisor.greaterThan(this.shiftRightUnsigned(1))) {
        // 15 >>> 1 = 7 ; with divisor = 8 ; true
        return Int64.UNSIGNED_ONE
      }
      res = Int64.UNSIGNED_ZERO
    }

    // Repeat the following until the remainder is less than other:  find a
    // floating-point that approximates remainder / other *from below*, add this
    // into the result, and subtract it from the remainder.  It is critical that
    // the approximate value is less than or equal to the real value so that the
    // remainder never becomes negative.
    rem = this
    while (rem.greaterThanOrEquals(divisor)) {
      // Approximate the result of division. This may be a little greater or
      // smaller than the actual value.
      approx = Math.max(1, Math.floor(rem / divisor))

      // We will tweak the approximate result by changing it in the 48-th digit or
      // the smallest non-fractional digit, whichever is larger.
      const log2 = Math.ceil(Math.log(approx) / Math.LN2)
      const delta = log2 <= 48 ? 1 : Math.pow(2, log2 - 48)
      // Decrease the approximation until it is smaller than the remainder.  Note
      // that if it is too large, the product overflows and is negative.
      let approxRes = fromNumber(approx)
      let approxRem = approxRes.multiply(divisor)
      while (approxRem.isNegative || approxRem.greaterThan(rem)) {
        approx -= delta
        approxRes = fromNumber(approx, this.unsigned)
        approxRem = approxRes.multiply(divisor)
      }

      // We know the answer can't be zero... and actually, zero would cause
      // infinite recursion since we would make no progress.
      if (approxRes.isZero) approxRes = Int64.ONE

      res = res.add(approxRes)
      rem = rem.subtract(approxRem)
    }
    return res
  }

  /**
   *
   * @param {Int64Other} other
   * @returns {boolean}
   */
  equals (other) {
    if (!Int64.isInt64(other)) {
      other = Int64.from(other)
    }

    if (
      this.unsigned !== other.unsigned &&
      this.high >>> 31 === 1 &&
      other.high >>> 31 === 1
    ) {
      return false
    }

    return this.high === other.high && this.low === other.low
  }

  greaterThan (other) {
    return this.compare(other) > 0
  }

  greaterThanOrEqual (other) {
    return this.compare(other) >= 0
  }

  lessThan (other) {
    return this.compare(other) < 0
  }

  lessThanOrEqual (other) {
    return this.compare(other) <= 0
  }

  mod (divisor) {
    if (!Int64.isInt64(divisor)) {
      divisor = Int64.from(divisor)
    }

    // use wasm support if present
    if (wasm) {
      const low = (this.unsigned ? wasm.rem_u : wasm.rem_s)(
        this.low,
        this.high,
        divisor.low,
        divisor.high
      )

      return new Int64(low, wasm.get_high(), this.unsigned)
    }

    return this.subtract(this.divide(divisor).multiply(divisor))
  }

  /**
   * Returns the product of this and the specified Long.
   * @param {Int64Other} multiplier - Multiplier
   * @returns {Int64}
   */
  multiply (multiplier) {
    if (this.isZero) return Int64.ZERO

    if (!Int64.isInt64(multiplier)) {
      multiplier = Int64.from(multiplier)
    }

    // use wasm support if present
    if (wasm) {
      const low = wasm.mul(this.low, this.high, multiplier.low, multiplier.high)
      return new Int64(low, wasm.get_high(), this.unsigned)
    }

    if (multiplier.isZero) return Int64.ZERO

    if (this.equals(Int64.MIN_VALUE)) {
      return multiplier.isOdd ? Int64.MIN_VALUE : Int64.ZERO
    }

    if (multiplier.equals(Int64.MIN_VALUE)) {
      return this.isOdd ? Int64.MIN_VALUE : Int64.ZERO
    }

    if (this.isNegative) {
      return multiplier.isNegative
        ? this.negate().multiply(multiplier.negate())
        : this.negate().multiply(multiplier).negate()
    } else if (multiplier.isNegative) {
      return this.multiply(multiplier.negate()).negate()
    }

    // If both longs are small, use float multiplication
    if (this.lessThan(TWO_PWR_24) && multiplier.lessThan(TWO_PWR_24)) {
      return fromNumber(this * multiplier, this.unsigned)
    }

    // Divide each long into 4 chunks of 16 bits, and then add up 4x4 products.
    // We can skip products that would overflow.

    const a48 = this.high >>> 16
    const a32 = this.high & 0xffff
    const a16 = this.low >>> 16
    const a00 = this.low & 0xffff

    const b48 = multiplier.high >>> 16
    const b32 = multiplier.high & 0xffff
    const b16 = multiplier.low >>> 16
    const b00 = multiplier.low & 0xffff

    let c48 = 0
    let c32 = 0
    let c16 = 0
    let c00 = 0
    c00 += a00 * b00
    c16 += c00 >>> 16
    c00 &= 0xffff
    c16 += a16 * b00
    c32 += c16 >>> 16
    c16 &= 0xffff
    c16 += a00 * b16
    c32 += c16 >>> 16
    c16 &= 0xffff
    c32 += a32 * b00
    c48 += c32 >>> 16
    c32 &= 0xffff
    c32 += a16 * b16
    c48 += c32 >>> 16
    c32 &= 0xffff
    c32 += a00 * b32
    c48 += c32 >>> 16
    c32 &= 0xffff
    c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48
    c48 &= 0xffff
    return new Int64((c16 << 16) | c00, (c48 << 16) | c32, this.unsigned)
  }

  negate () {
    if (!this.unsigned && this.equals(Int64.MIN_VALUE)) {
      return Int64.MIN_VALUE
    }

    return this.not().add(Int64.ONE)
  }

  not () {
    return new Int64(~this.low, ~this.high, this.unsigned)
  }

  notEquals (other) {
    return !this.equals(other)
  }

  or (other) {
    if (!Int64.isInt64(other)) {
      other = Int64.from(other)
    }

    return new Int64(
      this.low | other.low,
      this.high | other.high,
      this.unsigned
    )
  }

  remainder (divisor) {
    return this.mod(divisor)
  }

  shiftLeft (numBits) {
    if (Int64.isInt64(numBits)) {
      numBits = numBits.toInt32()
    }

    if ((numBits &= 63) === 0) {
      return this
    } else if (numBits < 32) {
      return new Int64(
        this.low << numBits,
        (this.high << numBits) | (this.low >>> (32 - numBits)),
        this.unsigned
      )
    } else {
      return new Int64(0, this.low << (numBits - 32), this.unsigned)
    }
  }

  shiftRight (numBits) {
    if (Int64.isInt64(numBits)) {
      numBits = numBits.toInt32()
    }

    if ((numBits &= 63) === 0) {
      return this
    } else if (numBits < 32) {
      return new Int64(
        (this.low >>> numBits) | (this.high << (32 - numBits)),
        this.high >> numBits,
        this.unsigned
      )
    } else {
      return new Int64(
        this.high >> (numBits - 32),
        this.high >= 0 ? 0 : -1,
        this.unsigned
      )
    }
  }

  shiftRightUnsigned (numBits) {
    if (Int64.isInt64(numBits)) {
      numBits = numBits.toInt32()
    }

    if ((numBits &= 63) === 0) {
      return this
    } else if (numBits < 32) {
      return new Int64(
        (this.low >>> numBits) | (this.high << (32 - numBits)),
        this.high >>> numBits,
        this.unsigned
      )
    } else if (numBits === 32) {
      return new Int64(this.high, 0, this.unsigned)
    } else {
      return new Int64(this.high >> (numBits - 32), 0, this.unsigned)
    }
  }

  subtract (subtrahend) {
    if (!Int64.isInt64(subtrahend)) {
      subtrahend = Int64.from(subtrahend)
    }

    return this.add(subtrahend.negate())
  }

  toBigInt () {
    return BigInt(this.toString())
  }

  toBytes (isLittleEndian = false) {
    const hi = this.high
    const lo = this.low

    if (isLittleEndian) {
      return new ByteView([
        lo & 0xff,
        (lo >>> 8) & 0xff,
        (lo >>> 16) & 0xff,
        lo >>> 24,
        hi & 0xff,
        (hi >>> 8) & 0xff,
        (hi >>> 16) & 0xff,
        hi >>> 24
      ])
    } else {
      return new ByteView([
        hi >>> 24,
        (hi >>> 16) & 0xff,
        (hi >>> 8) & 0xff,
        hi & 0xff,
        lo >>> 24,
        (lo >>> 16) & 0xff,
        (lo >>> 8) & 0xff,
        lo & 0xff
      ])
    }
  }

  toInt32 () {
    return this.unsigned ? this.low >>> 0 : this.low
  }

  toSigned () {
    if (!this.unsigned) return this
    return new Int64(this.low, this.high, false)
  }

  toString (radix = 10) {
    radix = radix || 10
    if (radix < 2 || radix > 36) throw new BVONError('radix')
    if (this.isZero) return '0'
    if (this.isNegative) {
      // Unsigned Longs are never negative
      if (this.equals(Int64.MIN_VALUE)) {
        // We need to change the Long value before it can be negated, so we remove
        // the bottom-most digit in this base and then recurse to do the rest.
        const radixLong = fromNumber(radix)
        const div = this.divide(radixLong)
        const rem1 = div.multiply(radixLong).subtract(this)
        return div.toString(radix) + rem1.toInt32().toString(radix)
      } else return '-' + this.negate().toString(radix)
    }

    // Do several (6) digits each time through the loop, so as to
    // minimize the calls to the very expensive emulated div.
    const radixToPower = fromNumber(Math.pow(radix, 6), this.unsigned)
    let rem = this
    let result = ''
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const remDiv = rem.divide(radixToPower)
      const intval = rem.subtract(remDiv.multiply(radixToPower)).toInt32() >>> 0
      let digits = intval.toString(radix)
      rem = remDiv
      if (rem.isZero) {
        return digits + result
      } else {
        while (digits.length < 6) digits = '0' + digits
        result = '' + digits + result
      }
    }
  }

  toUnsigned () {
    if (this.unsigned) return this
    return new Int64(this.low, this.high, true)
  }

  valueOf () {
    return this.unsigned
      ? (this.high >>> 0) * TWO_PWR_32_DBL + (this.low >>> 0)
      : this.high * TWO_PWR_32_DBL + (this.low >>> 0)
  }

  xor (other) {
    if (!Int64.isInt64(other)) {
      other = Int64.from(other)
    }

    return new Int64(
      this.low ^ other.low,
      this.high ^ other.high,
      this.unsigned
    )
  }

  [Symbol.toPrimitive] (hint) {
    switch (hint) {
      case 'string':
        return this.toString()
      case 'number':
      default:
        return this.valueOf()
    }
  }

  [Symbol.for('nodejs.util.inspect.custom')] () {
    return `<Int64(\x1b[32m'${this.toString()}'\x1b[0m) \x1b[33m${this.low}\x1b[0m \x1b[33m${this.high}\x1b[0m \x1b[33m${this.unsigned}\x1b[0m />`
  }

  inspect () {
    return `<Int64('${this.toString()}') ${this.low} ${this.high} ${this.unsigned} />`
  }
}

const TWO_PWR_24 = (() => fromInt(TWO_PWR_24_DBL))()

function fromInt (value, unsigned) {
  let obj, cachedObj, cache
  if (unsigned) {
    value >>>= 0
    if ((cache = value >= 0 && value < 256)) {
      cachedObj = UINT_CACHE.get(value)
      if (cachedObj) return cachedObj
    }
    obj = new Int64(value, (value | 0) < 0 ? -1 : 0, true)
    if (cache) UINT_CACHE.set(value, obj)
    return obj
  } else {
    value |= 0
    if ((cache = value >= -128 && value < 128)) {
      cachedObj = INT_CACHE.get(value)
      if (cachedObj) return cachedObj
    }

    obj = new Int64(value, value < 0 ? -1 : 0, false)
    if (cache) INT_CACHE.set(value, obj)
    return obj
  }
}

function fromNumber (value, unsigned) {
  if (isNaN(value)) {
    return unsigned ? Int64.UNSIGNED_ZERO : Int64.ZERO
  }

  if (unsigned) {
    if (value < 0) return Int64.UNSIGNED_ZERO
    if (value >= TWO_PWR_64_DBL) return Int64.MAX_UNSIGNED_VALUE
  } else {
    if (value <= -TWO_PWR_63_DBL) return Int64.MIN_VALUE
    if (value + 1 >= TWO_PWR_63_DBL) return Int64.MAX_VALUE
  }

  if (value < 0) return fromNumber(-value, unsigned).negate()
  return new Int64((value % TWO_PWR_32_DBL) | 0, (value / TWO_PWR_32_DBL) | 0, unsigned)
}

function fromBytes (bytes, unsigned, isLittleEndian = false) {
  if (isLittleEndian) {
    return new Int64(
      bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24),
      bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24),
      unsigned
    )
  } else {
    return new Int64(
      (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7],
      (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3],
      unsigned
    )
  }
}

function fromString (str, unsigned, radix) {
  if (str.length === 0) throw new BVONError('empty string')
  if (
    str === 'NaN' ||
    str === 'Infinity' ||
    str === '+Infinity' ||
    str === '-Infinity'
  ) {
    return Int64.ZERO
  }
  if (typeof unsigned === 'number') {
    // For goog.math.long compatibility
    radix = unsigned
    unsigned = false
  } else {
    unsigned = !!unsigned
  }
  radix = radix || 10
  if (radix < 2 || radix > 36) throw new BVONError('radix')

  let p
  if ((p = str.indexOf('-')) > 0) throw new BVONError('interior hyphen')
  else if (p === 0) {
    return fromString(str.substring(1), unsigned, radix).negate()
  }

  // Do several (8) digits each time through the loop, so as to
  // minimize the calls to the very expensive emulated div.
  const radixToPower = fromNumber(Math.pow(radix, 8))

  let result = Int64.ZERO
  let index = 0

  while (index < str.length) {
    const size = Math.min(8, str.length - index)
    const value = parseInt(str.substring(index, index + size), radix)

    if (size < 8) {
      const power = fromNumber(Math.pow(radix, size))
      result = result.multiply(power).add(fromNumber(value))
    } else {
      result = result.multiply(radixToPower)
      result = result.add(fromNumber(value))
    }

    index += 8
  }

  return new Int64(result[0], result[1], unsigned)
}
