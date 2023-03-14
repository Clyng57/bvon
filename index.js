
import ByteView from 'byteview'
import Int64 from './lib/Int64.js'
import BVONError from './lib/BVONError.js'
import UOID from './lib/UOID.js'

/** @typedef {{ constructor: any, code: number, args: (item: any) => any, build: (args: any) => any }} BVONConstructor */

const TYPES = {
  UNDEFINED: 0x0,
  NULL: 0x1,
  INT32: 0x2,
  INT64: 0x3,
  DOUBLE: 0x4,
  BIGINT: 0x5,
  STRING: 0x6,
  BOOLEAN: 0x7,
  DATE: 0x8,
  OBJECT: 0x9,
  ARRAY: 0xa,
  BYTEVIEW: 0xb,
  SET: 0xc,
  MAP: 0xd,
  DB_REF: 0xe,
  REGEX: 0xf,
  UOID: 0x10,
  CONSTRUCTOR: 0xff
}

const INT32_MAX = 0x7fffffff
const INT32_MIN = -0x80000000

const builtinConstructors = []

// const TYPES = Object.fromEntries(typeNames.map((name, index) => [name, index]))

function getBigIntByteLength (bi) {
  const bit32 = BigInt(32)
  const min32 = BigInt(0xffffffff)
  let left = bi
  let bytes = 0

  while (left > min32) {
    bytes += 4
    left >>= bit32
  }

  left = Number(left)

  while (left > 0xffff) {
    bytes += 2
    left >>= 16
  }

  while (left > 0) {
    ++bytes
    left >>= 8
  }

  return bytes
}

class ByteEncoder {
  #written
  #read

  constructor () {
    this.#written = 0
    this.#read = 0
  }

  #send () {
    const res = {
      written: this.#written,
      read: this.#read
    }

    this.#written = 0
    this.#read = 0
    return res
  }

  encodeInto (string, view) {
    let index = -1
    const { length: stringLength } = string
    const { length } = view

    while (++index < stringLength) {
      const codePoint = string.codePointAt(index)
      ++this.#read

      if (codePoint > 0xE000) {
        ++index
        ++this.#read
      }

      if (this.#written >= length) {
        return this.#send()
      }

      // encode utf8
      if (codePoint < 0x80) {
        view[this.#written++] = codePoint
      } else if (codePoint < 0x800) {
        if (this.#written + 1 >= length) {
          return this.#send()
        }
        view[this.#written++] = codePoint >> 0x6 | 0xC0
        view[this.#written++] = codePoint & 0x3F | 0x80
      } else if (codePoint < 0x10000) {
        if (this.#written + 2 >= length) {
          return this.#send()
        }
        view[this.#written++] = codePoint >> 0xC | 0xE0
        view[this.#written++] = codePoint >> 0x6 & 0x3F | 0x80
        view[this.#written++] = codePoint & 0x3F | 0x80
      } else if (codePoint < 0x110000) {
        if (this.#written + 3 >= length) {
          return this.#send()
        }
        view[this.#written++] = codePoint >> 0x12 | 0xF0
        view[this.#written++] = codePoint >> 0xC & 0x3F | 0x80
        view[this.#written++] = codePoint >> 0x6 & 0x3F | 0x80
        view[this.#written++] = codePoint & 0x3F | 0x80
      } else {
        throw new Error('Invalid code point')
      }
    }

    return this.#send()
  }

  encode (string) {
    let index = -1
    let offset = -1
    const { length } = string
    const bytes = []

    while (++index < length) {
      const codePoint = string.codePointAt(index)

      if (codePoint > 0xE000) ++index

      if (codePoint < 0x80) {
        bytes[++offset] = codePoint
      } else if (codePoint < 0x800) {
        bytes[++offset] = codePoint >> 0x6 | 0xC0
        bytes[++offset] = codePoint & 0x3F | 0x80
      } else if (codePoint < 0x10000) {
        bytes[++offset] = codePoint >> 0xC | 0xE0
        bytes[++offset] = codePoint >> 0x6 & 0x3F | 0x80
        bytes[++offset] = codePoint & 0x3F | 0x80
      } else if (codePoint < 0x110000) {
        bytes[++offset] = codePoint >> 0x12 | 0xF0
        bytes[++offset] = codePoint >> 0xC & 0x3F | 0x80
        bytes[++offset] = codePoint >> 0x6 & 0x3F | 0x80
        bytes[++offset] = codePoint & 0x3F | 0x80
      } else {
        throw new Error('Invalid code point')
      }
    }

    return new ByteView(bytes)
  }
}

const byteEncoder = new ByteEncoder()

class Schema {
  constructor (obj) {
    this.refs = new Map()
    this.refIndex = 0
    this.map = []

    this.serializers = []
    this.#getKeys(obj)
  }

  #searchArray (obj) {
    for (const item of obj) {
      if (item && typeof item === 'object') {
        if (Array.isArray(item)) {
          this.#searchArray(item)
        } else {
          this.#getKeys(item)
        }
      }
    }
  }

  #getKeys (obj) {
    const keys = Object.keys(obj)
    const { length } = keys
    let index = -1

    while (++index < length) {
      const key = keys[index]

      if (this.refs.has(key) === false) {
        this.refs.set(key, ++this.refIndex)
        this.map[this.refIndex] = key
      }

      if (obj[key] && typeof obj[key] === 'object') {
        if (Array.isArray(obj[key])) {
          this.#searchArray(obj[key])
        } else {
          this.#getKeys(obj[key])
        }
      }
    }
  }
}

class BVONSerializer {
  #size

  constructor ({ size = 33554432, constructors = builtinConstructors } = {}) {
    this.#size = size
    this.map = new Map()
    this.buffer = new ByteView(size)
    this.offset = 0
    this.constructors = new Map(constructors.map(c => [c.constructor, c]))
    this.refIndex = 0
  }

  reset () {
    this.offset = 0
    this.refIndex = 0
    this.map = new Map()
    this.buffer.set(0, 0)
  }

  setUint8 (number) {
    this.buffer[this.offset] = number
    this.offset += 1
  }

  setUint16 (number) {
    this.buffer[this.offset] = number & 0xff
    this.buffer[this.offset + 1] = number >> 8
    this.offset += 2
  }

  setUint32 (number) {
    this.buffer.setUint32(this.offset, number, true)
    this.offset += 4
  }

  setInt8 (number) {
    this.buffer.setInt8(this.offset, number)
    this.offset += 1
  }

  setInt16 (number) {
    this.buffer.setInt16(this.offset, number, true)
    this.offset += 2
  }

  setInt32 (number) {
    this.buffer.setInt32(this.offset, number, true)
    this.offset += 4
  }

  /**
   *
   * @param {Int64} value
   */
  setInt64 (value) {
    const { low, high } = value
    // low bits
    this.buffer[this.offset] = low & 0xff
    this.buffer[++this.offset] = (low >> 8) & 0xff
    this.buffer[++this.offset] = (low >> 16) & 0xff
    this.buffer[++this.offset] = (low >> 24) & 0xff
    // high bits
    this.buffer[++this.offset] = high & 0xff
    this.buffer[++this.offset] = (high >> 8) & 0xff
    this.buffer[++this.offset] = (high >> 16) & 0xff
    this.buffer[++this.offset] = (high >> 24) & 0xff
    ++this.offset
  }

  setFloat64 (number) {
    this.buffer.setFloat64(this.offset, number, true)
    this.offset += 8
  }

  setBigInt (byteLength, number) {
    let offset = this.offset + byteLength
    const bit32 = BigInt(32)
    const min32 = BigInt(0xffffffff)
    let left = number

    while (left > min32) {
      offset -= 4
      this.buffer.setInt32(offset, Number(left & min32))
      left >>= bit32
    }

    left = Number(left)

    while (left > 0xffff) {
      offset -= 2
      this.buffer.setInt16(offset, left & 0xffff)
      left >>= 16
    }

    while (left > 0) {
      offset -= 1
      this.buffer.setInt8(offset, left & 0xff)
      left >>= 8
    }

    this.offset += byteLength
  }

  writeHeader (byteLength) {
    if (byteLength < 0x100) {
      this.setUint8(8)
      this.setUint8(byteLength)
    } else if (byteLength < 0x10000) {
      this.setUint8(16)
      this.setUint16(byteLength)
    } else if (byteLength < 0x100000000) {
      this.setUint8(32)
      this.setUint32(byteLength)
    } else {
      const e = new RangeError('length in writeHeader is invalid')
      throw e
    }
  }

  writeString (string) {
    this.setUint8(TYPES.STRING)
    const bytes = byteEncoder.encode(string)
    this.writeHeader(bytes.length)
    this.buffer.set(bytes, this.offset)
    this.offset += bytes.length
  }

  useSchema (schema) {
    this.map = schema.refs
    this.refIndex = schema.refIndex
  }

  writeKey (string) {
    const ref = this.map.get(string)

    if (!ref) {
      console.log(string)
      this.map.set(string, this.refIndex++)
      this.setUint8(TYPES.STRING)
      const bytes = byteEncoder.encode(string)
      this.writeHeader(bytes.length)
      this.buffer.set(bytes, this.offset)
      this.offset += bytes.length
    } else {
      this.writeRef(ref)
    }
  }

  writeUOID (string) {
    this.setUint8(TYPES.UOID)
    const bytes = byteEncoder.encode(string)
    this.writeHeader(bytes.length)
    this.buffer.set(bytes, this.offset)
    this.offset += bytes.length
  }

  writeRef (ref) {
    this.setUint8(TYPES.DB_REF)
    this.writeHeader(ref)
  }

  writeNumber (number) {
    const isNegativeZero = Object.is(number, -0)

    if (
      !isNegativeZero &&
      Number.isSafeInteger(number)
    ) {
      if (
        number <= INT32_MAX &&
        number >= INT32_MIN
      ) {
        return this.writeInteger(number)
      } else {
        return this.writeInteger64(Int64.from(number))
      }
    }

    return this.writeDouble(number)
  }

  writeInteger (number) {
    this.setUint8(TYPES.INT32)
    this.setInt32(number)
  }

  writeInteger64 (number) {
    this.setUint8(TYPES.INT64)
    this.setInt64(number)
  }

  writeDouble (number) {
    this.setUint8(TYPES.DOUBLE)
    this.setFloat64(number)
  }

  writeDate (date) {
    this.setUint8(TYPES.DATE)
    this.setInt64(Int64.from(date.valueOf()))
  }

  writeBigInt (number) {
    if (typeof number !== 'bigint') {
      number = BigInt(number)
    }

    const byteLength = getBigIntByteLength(number)
    this.setUint8(TYPES.BIGINT)

    this.writeHeader(byteLength)
    this.setBigInt(byteLength, number)
  }

  writeBoolean (bool) {
    this.setUint8(TYPES.BOOLEAN)
    this.setUint8(bool ? 1 : 0)
  }

  writeArray (item) {
    this.setUint8(TYPES.ARRAY)
    this.writeHeader(item.length)

    for (const member of item) {
      this.write(member)
    }
  }

  writeSet (item) {
    this.setUint8(TYPES.SET)
    this.writeHeader(item.size)

    for (const member of item) {
      this.write(member)
    }
  }

  writeMap (item) {
    this.setUint8(TYPES.MAP)
    this.writeHeader(item.size)

    for (const [key, value] of item) {
      this.write(key)
      this.write(value)
    }
  }

  writeView (item) {
    const { length } = item
    this.setUint8(TYPES.BYTEVIEW)
    this.writeHeader(length)
    this.buffer.set(item, this.offset)
    this.offset += length
  }

  writeCustomType (item, constructor) {
    let match = false

    const entry = this.constructors.get(constructor)

    if (typeof entry === 'object') {
      this.setUint8(TYPES.CONSTRUCTOR)
      this.writeHeader(entry.code)
      this.write(entry.args(item))
      match = true
    }

    return match
  }

  writeObject (item) {
    const { constructor } = Object.getPrototypeOf(item)

    switch (constructor) {
      case Number:
        this.writeNumber(item.valueOf())
        break
      case Date:
        this.writeDate(item)
        break
      case Int64:
        this.writeInteger64(item)
        break
      case Array:
        this.writeArray(item)
        break
      case Map:
        this.writeMap(item)
        break
      case UOID:
        this.writeUOID(item.toString())
        break
      case String:
        this.writeString(item.toString())
        break
      case Set:
        this.writeSet(item)
        break
      case ByteView:
        this.writeView(item)
        break

      case RegExp: {
        this.setUint8(TYPES.REGEX)
        this.write(item.source)
        this.write(item.flags)
        break
      }

      case Object: {
        this.setUint8(TYPES.OBJECT)
        const keys = Object.keys(item)
        const { length } = keys
        let index = -1
        this.writeHeader(length)

        while (++index < length) {
          const key = keys[index]
          this.writeKey(key)
          this.write(item[key])
        }

        break
      }

      default: {
        if (item instanceof Array) {
          this.writeArray(item)
          break
        } else if (item instanceof Map) {
          this.writeMap(item)
          break
        } else if (item instanceof Set) {
          this.writeSet(item)
          break
        } else if (item instanceof Number) {
          this.writeNumber(item.valueOf())
          break
        } else if (item instanceof String) {
          this.writeString(item.toString())
          break
        } else if (item instanceof Uint8Array) {
          this.writeView(item)
          break
        } else if (item instanceof Date) {
          this.writeDate(item)
          break
        }

        const match = this.writeCustomType(item, constructor)

        if (!match) {
          this.setUint8(TYPES.OBJECT)
          const keys = Object.keys(item)
          const { length } = keys
          let index = -1
          this.writeHeader(length)

          while (++index < length) {
            const key = keys[index]
            this.writeString(key)
            this.write(item[key])
          }
        }

        break
      }
    }
  }

  write (item) {
    if (item === null || item === undefined) {
      this.setUint8(TYPES.NULL)
      return this
    }

    if (typeof item.toBVON === 'function') {
      item = item.toBVON()
    }

    const type = typeof item

    switch (type) {
      case 'bigint':
        this.writeBigInt(item)
        break
      case 'string':
        this.writeString(item)
        break
      case 'number':
        this.writeNumber(item)
        break
      case 'boolean':
        this.writeBoolean(item)
        break
      case 'object':
        this.writeObject(item)
        break
    }

    return this
  }
}

class BVONDeserializer {
  constructor ({
    constructors = builtinConstructors
  } = {}) {
    this.constructors = []
    for (const item of constructors) {
      this.constructors[item.code] = item
    }
    this.map = []
    this.offset = 0
    this.refIndex = 0
    /** @type {null | ByteView} */
    this.buffer = null
  }

  useSchema (schema) {
    this.map = schema.map
    this.refIndex = schema.refIndex
  }

  reset () {
    this.offset = 0
    this.refIndex = 0
    this.map = []
    this.buffer = null
  }

  readHeader () {
    let res
    const lengthHeader = this.readUint8()

    switch (lengthHeader) {
      case 0x08:
        res = this.readUint8()
        break
      case 0x10:
        res = this.readUint16()
        break
      case 0x20:
        res = this.readUint32()
        break
      default:
        throw new Error('invalid size')
    }

    return res
  }

  readKey (blockType) {
    switch (blockType) {
      case TYPES.DB_REF: {
        const ref = this.readHeader()
        return this.map[ref]
      }

      case TYPES.STRING: {
        const length = this.readHeader()
        const str = this.readString(length)
        this.map[this.refIndex++] = str
        return str
      }

      default:
        throw new Error(`Key of type ${blockType} is invalid.`)
    }
  }

  readBlock () {
    const blockType = this.readUint8()
    switch (blockType) {
      case TYPES.STRING: {
        const length = this.readHeader()
        const str = this.readString(length)
        // this.map[this.refIndex++] = str
        return str
      }

      case TYPES.UOID: {
        const length = this.readHeader()
        const str = this.readString(length)
        // this.map[this.refIndex++] = str
        return new UOID(str)
      }

      case TYPES.BYTEVIEW: {
        const length = this.readHeader()
        const buf = new ByteView(length)
        this.buffer.copy(buf, 0, this.offset, this.offset + length)
        this.offset += length
        return buf
      }

      case TYPES.INT32: {
        return this.readInt32()
      }

      case TYPES.INT64: {
        return this.readInt64()
      }

      case TYPES.DOUBLE: {
        return this.readDouble()
      }

      case TYPES.DATE: {
        const int64 = this.readInt64()
        return new Date(int64.valueOf())
      }

      case TYPES.BIGINT: {
        const length = this.readHeader()
        const str = this.readBigInt(length)
        return str
      }

      case TYPES.CONSTRUCTOR: {
        const code = this.readHeader()
        const args = this.readBlock()
        const constructor = this.constructors[code]
        if (constructor) {
          return constructor.build(...args)
        } else {
          throw new Error(`Constructor ${code} is unknown`)
        }
      }

      case TYPES.BOOLEAN:
        return Boolean(this.readUint8())

      case TYPES.NULL:
        return null

      case TYPES.UNDEFINED:
        return undefined

      case TYPES.OBJECT: {
        const keyLength = this.readHeader()
        const obj = {}
        let index = -1
        let curr = this.buffer[this.offset++]
        while (++index < keyLength) {
          obj[this.readKey(curr)] = this.readBlock()
          if (index + 1 < keyLength) {
            curr = this.buffer[this.offset++]
          }
        }
        return obj
      }

      case TYPES.MAP: {
        const size = this.readHeader()
        let index = -1
        const map = new Map()
        while (++index < size) {
          map.set(this.readBlock(), this.readBlock())
        }
        return map
      }

      case TYPES.SET: {
        const size = this.readHeader()
        let index = -1
        const set = new Set()
        while (++index < size) {
          set.add(this.readBlock())
        }
        return set
      }

      case TYPES.ARRAY: {
        const length = this.readHeader()
        const arr = new Array(length)
        let index = -1
        while (++index < length) {
          arr[index] = this.readBlock()
        }
        return arr
      }

      case TYPES.REGEX: {
        const source = this.readBlock()
        const flags = this.readBlock()
        return new RegExp(source, flags)
      }

      default:
        throw new BVONError(`Unsupported type: ${blockType}`)
    }
  }

  readUint8 () {
    return this.buffer[this.offset++]
  }

  readUint16 () {
    return this.buffer[this.offset++] + (this.buffer[this.offset++] << 8)
  }

  readUint32 () {
    const uInt32 = this.buffer.getUint32(this.offset, true)
    this.offset += 4
    return uInt32
  }

  readInt8 () {
    return this.buffer.getInt8(this.offset++)
  }

  readInt16 () {
    const int16 = this.buffer.getInt16(this.offset, true)
    this.offset += 2
    return int16
  }

  readInt32 () {
    const int32 = (
      (this.buffer[this.offset]) |
      (this.buffer[++this.offset] << 8) |
      (this.buffer[++this.offset] << 16) |
      (this.buffer[++this.offset] << 24)
    )

    ++this.offset
    return int32
  }

  readInt64 () {
    const low = (
      this.buffer[this.offset] |
      (this.buffer[++this.offset] << 8) |
      (this.buffer[++this.offset] << 16) |
      (this.buffer[++this.offset] << 24)
    )

    const high = (
      this.buffer[++this.offset] |
      (this.buffer[++this.offset] << 8) |
      (this.buffer[++this.offset] << 16) |
      (this.buffer[++this.offset] << 24)
    )

    ++this.offset
    return new Int64(low, high)
  }

  readDouble () {
    /** @type {number} */
    const int64 = this.buffer.getFloat64(this.offset, true)
    this.offset += 8
    return int64
  }

  readBigInt (length) {
    const bits = BigInt(8)
    let index = -1
    let res = BigInt(0)

    while (++index < length) {
      res = (res << bits) + BigInt(this.buffer[this.offset + index])
    }

    this.offset += length
    return res
  }

  readString (length) {
    const str = this.buffer.slice(this.offset, this.offset + length).toString()
    this.offset += length
    return str
  }

  /**
   *
   * @param {ByteView} buffer
   * @returns {any}
   */
  deserialize (buffer) {
    this.buffer = buffer
    const res = this.readBlock()
    this.reset()
    return res
  }
}

function createBVON ({
  maxSize = 17825792,
  constructors = builtinConstructors
} = {
  maxSize: 17825792,
  constructors: builtinConstructors
}) {
  return class BVON {
    static #serializer = new BVONSerializer({ size: maxSize, constructors })
    static #deserializer = new BVONDeserializer({ constructors })

    static serialize (data) {
      this.#serializer.write(data)

      const buffer = this.#serializer.buffer.slice(
        0,
        this.#serializer.offset
      )

      this.#serializer.reset()
      return buffer
    }

    static deserialize (buffer) {
      return this.#deserializer.deserialize(buffer)
    }
  }
}

export default class BVON {
  static #serializer = new BVONSerializer()
  static #deserializer = new BVONDeserializer()

  static Schema = Schema
  static createBVON = createBVON

  static serialize (data, schema) {
    if (schema) {
      this.#serializer.useSchema(schema)
    }
    this.#serializer.write(data)

    const buffer = this.#serializer.buffer.slice(
      0,
      this.#serializer.offset
    )

    this.#serializer.reset()
    return buffer
  }

  static serializeCollection (data, schema) {
    const response = []

    for (const chunk of data) {
      if (schema) this.#serializer.useSchema(schema)
      this.#serializer.write(chunk)

      response.push(this.#serializer.buffer.slice(
        0,
        this.#serializer.offset
      ))

      this.#serializer.reset()
    }

    return response
  }

  static deserialize (buffer, schema) {
    if (schema) this.#deserializer.useSchema(schema)
    this.#deserializer.buffer = buffer
    const res = this.#deserializer.readBlock()
    this.#deserializer.reset()
    return res
  }

  static deserializeCollection (data, schema) {
    const response = []

    for (const chunk of data) {
      if (schema) this.#deserializer.useSchema(schema)
      this.#deserializer.buffer = chunk
      response.push(this.#deserializer.readBlock())
      this.#deserializer.reset()
    }

    return response
  }
}

export {
  UOID
}
