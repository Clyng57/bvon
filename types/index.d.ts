
import type ByteView from 'byteview'

declare module 'bvon'

declare class Schema {
  refs: Map
  refIndex: number
  map: Array<string>
  constructor (obj: object)
}

export interface CustomConstructor<T> {
  constructor: any
  code: number
  args: (item: T) => any
  build: (args: any) => T
}

type CustomConstructors = Array<CustomConstructor<any>>

interface CustomBVON {
  static serialize (data: any, schema: Schema): ByteView
  static serializeCollection (data: any, schema: Schema): Array<ByteView>
  static deserialize (buffer: ByteView, schema: Schema): any
  static deserializeCollection (data: Array<ByteView>, schema: Schema): Array<any>
}

export default class BVON {
  static Schema = Schema
  static createBVON (options: { maxSize: number, constructors: CustomConstructors }): CustomBVON
  static serialize (data: any, schema: Schema): ByteView
  static serializeCollection (data: any, schema: Schema): Array<ByteView>
  static deserialize (buffer: ByteView, schema: Schema): any
  static deserializeCollection (data: Array<ByteView>, schema: Schema): Array<any>
}

declare class UOID {
  static #index: number
  static #version: number
  static #getInc (): number
  static generate (time?: number): ByteView
  constructor (inputId?: ByteView | Uint8Array | string)
  get version (): number
  getTimestamp (): Date
  toString (): string
  inspect (): string
  [Symbol.for('nodejs.util.inspect.custom')] (): string
  [Symbol.toPrimitive] (): string
  toJSON (): string
}

export {
  UOID
}
