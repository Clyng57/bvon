
import randomBytes from '@neumatter/random-bytes'
import ByteView from 'byteview'

let PROCESS_UNIQUE = null
const BASE32_UOID = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const BASE32_UTID_REGEX = /^[2-9A-HJ-NP-Z]{28}$/

function encodeBase32Hex (byteView, padding = false) {
  if (!ByteView.isView(byteView)) {
    throw new Error('[Base32[encode]] did not recieve valid type')
  }

  const { length } = byteView
  let index = -1
  let bits = 0
  let value = 0
  let response = ''

  while (++index < length) {
    const byte = byteView[index]
    value = (value << 0x8) | byte
    bits += 8

    while (bits >= 5) {
      response += BASE32_UOID[(value >>> (bits - 5)) & 0x1F]
      bits -= 5
    }
  }

  if (bits > 0) {
    response += BASE32_UOID[(value << (5 - bits)) & 0x1F]
  }

  if (padding) {
    while (response.length % 8 !== 0) {
      response += '='
    }
  }

  return response
}

function base32ByteLength (string) {
  const { length } = string
  let validLength = string.indexOf('=')
  if (validLength === -1) validLength = length

  const placeHoldersLength = validLength === length
    ? 0
    : length - validLength

  return (((length - placeHoldersLength) * 5) / 8) | 0
}

function decodeBase32Hex (string) {
  const { length } = string
  let bits = 0
  let value = 0
  let index = 0
  const bytes = new ByteView(base32ByteLength(string))
  let i = -1

  while (++i < length) {
    if (string[i] === '=') continue
    value = (value << 5) | BASE32_UOID.indexOf(string[i])
    bits += 5

    if (bits >= 8) {
      bytes[index++] = (value >>> (bits - 8)) & 0xFF
      bits -= 8
    }
  }

  return bytes.buffer
}

function randomUint24 () {
  const bytes = randomBytes(3)

  return (
    (bytes[0] << 16) |
    (bytes[1] << 8) |
    bytes[2]
  )
}

export default class UOID {
  static #index = randomUint24()
  static #version = 1
  static cacheHexString

  static #getInc () {
    return (this.#index = (this.#index + 1) % 0xffffff)
  }

  static generate (time) {
    if (typeof time !== 'number') {
      time = Date.now() / 1000 | 0
    }

    const inc = this.#getInc()

    const bytes = new ByteView(17)
    bytes.setUint32(0, time)
    // set PROCESS_UNIQUE if yet not initialized
    if (PROCESS_UNIQUE === null) {
      PROCESS_UNIQUE = randomBytes(6)
    }

    bytes[4] = PROCESS_UNIQUE[0]
    bytes[5] = PROCESS_UNIQUE[1]
    bytes[6] = PROCESS_UNIQUE[2]
    bytes[7] = PROCESS_UNIQUE[3]
    bytes[8] = PROCESS_UNIQUE[4]
    bytes[9] = PROCESS_UNIQUE[5]

    const rand = randomBytes(3)
    bytes[10] = rand[0]
    bytes[11] = rand[1]
    bytes[12] = rand[2]

    // 3-byte counter
    bytes[15] = inc & 0xff
    bytes[14] = (inc >> 8) & 0xff
    bytes[13] = (inc >> 16) & 0xff

    bytes[16] = this.#version

    return bytes
  }

  #id
  #idCache = null

  constructor (inputId) {
    let workingId
    if (ByteView.isView(inputId) && inputId.byteLength === 16) {
      workingId = encodeBase32Hex(inputId)
    } else {
      workingId = inputId
    }

    if (typeof workingId === 'undefined' || workingId === null) {
      // Generate a new id
      this.#id = UOID.generate()
    } else if (typeof workingId === 'string') {
      if (workingId.length === 28 && BASE32_UTID_REGEX.test(workingId)) {
        this.#id = new ByteView(decodeBase32Hex(workingId.slice(0, 26)))
        this.#idCache = workingId
      } else {
        throw new Error(
          'Argument passed in must be a string of 12 bytes or a string of 24 hex characters or an integer'
        )
      }
    } else {
      throw new Error('Argument passed in does not match the accepted types')
    }
  }

  get version () {
    return this.#id[16]
  }

  getTimestamp () {
    return new Date(this.#id.getUint32(0) * 1000)
  }

  toString () {
    if (!this.#idCache) {
      this.#idCache = encodeBase32Hex(this.#id)
    }

    return this.#idCache
  }

  inspect () {
    return `UOID('${this.toString()}')`
  }

  [Symbol.for('nodejs.util.inspect.custom')] () {
    return `UOID(\x1b[32m'${this.toString()}'\x1b[0m)`
  }

  [Symbol.toPrimitive] () {
    return this.toString()
  }

  toJSON () {
    return this.toString()
  }
}
