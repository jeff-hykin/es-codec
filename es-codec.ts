/***** TYPE TAGS *****/

const NULL      = 0b00000001
const UNDEFINED = 0b00000010
const TRUE      = 0b00000011
const FALSE     = 0b00000100
const REFERENCE = 0b00000101
const NUMBER    = 0b00000110
const DATE      = 0b00000111
const REGEXP    = 0b00001000
const STRING    = 0b00001001
const BIGINTN   = 0b00001010
const BIGINTP   = 0b00001011
const ARRAY     = 0b00001100
const OBJECT    = 0b00001101
const SET       = 0b00001110
const MAP       = 0b00001111
const _RECORD   = 0b00010000 // https://github.com/tc39/proposal-record-tuple
const _TUPLE    = 0b00010001

const ERROR           = 0b0100000
const EVAL_ERROR      = 0b0100001
const RANGE_ERROR     = 0b0100010
const REFERENCE_ERROR = 0b0100011
const SYNTAX_ERROR    = 0b0100100
const TYPE_ERROR      = 0b0100101
const URI_ERROR       = 0b0100110

const ARRAYBUFFER       = 0b01000000
const DATAVIEW          = 0b01000001
const INT8ARRAY         = 0b01000010
const UINT8ARRAY        = 0b01000011
const UINT8CLAMPEDARRAY = 0b01000100
const INT16ARRAY        = 0b01000101
const UINT16ARRAY       = 0b01000110
const INT32ARRAY        = 0b01000111
const UINT32ARRAY       = 0b01001000
const FLOAT32ARRAY      = 0b01001001
const FLOAT64ARRAY      = 0b01001010
const BIGINT64ARRAY     = 0b01001011
const BIGUINT64ARRAY    = 0b01001100

type Cursor = { offset : number }

type Memory = unknown[]

type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array
    | BigInt64Array
    | BigUint64Array

export class NotSerializable extends Error {
    constructor(readonly value : unknown) {
        super()
    }
}

class Unreachable extends Error {}

export function encode(x : unknown) {
    return encodeImpl(x)
}

export function decode(buffer : ArrayBuffer) {
    return decodeImpl(buffer, { offset: 0 }, [])
}

function encodeImpl(x : unknown, referrables : Memory = []) : ArrayBuffer {
    
    /* unique types */
    if (x === null)      return Uint8Array.of(NULL).buffer
    if (x === undefined) return Uint8Array.of(UNDEFINED).buffer
    if (x === true)      return Uint8Array.of(TRUE).buffer
    if (x === false)     return Uint8Array.of(FALSE).buffer
    
    /* simple types */
    if (x.constructor === Number) return encodeNumber(x)
    if (x.constructor === Date)   return encodeDate(x)
    if (x.constructor === RegExp) return encodeRegex(x)
    
    /* lengthy types */
    if (x.constructor === BigInt) return encodeBigInt(x)
    if (x.constructor === String) return encodeString(x)
    
    /* container types */
    if (x.constructor === Array)  return maybeEncodeReference(x, referrables, encodeArray)
    if (x.constructor === Object) return maybeEncodeReference(x as Record<string, unknown>, referrables, encodeObject)
    if (x.constructor === Set)    return maybeEncodeReference(x, referrables, encodeSet)
    if (x.constructor === Map)    return maybeEncodeReference(x, referrables, encodeMap)
    
    /* error types */
    if (x instanceof Error) return maybeEncodeReference(x, referrables, encodeError)
    
    /* low-level types */
    if (x.constructor === ArrayBuffer) return maybeEncodeReference(x, referrables, encodeArrayBuffer)
    if (ArrayBuffer.isView(x))         return maybeEncodeReference(x as TypedArray, referrables, encodeTypedArray)
    
    throw new NotSerializable(x)
}

function decodeImpl(buffer : ArrayBuffer, cursor : Cursor, referrables : Memory) : unknown {
    const view    = new DataView(buffer, cursor.offset)
    
    const typeTag = view.getUint8(0)
    cursor.offset += 1
    
    if (typeTag === NULL)        return null
    if (typeTag === UNDEFINED)   return undefined
    if (typeTag === TRUE)        return true
    if (typeTag === FALSE)       return false
    if (typeTag === REFERENCE)   return decodeReference(buffer, cursor, referrables)
    if (typeTag === NUMBER)      return decodeNumber(buffer, cursor)
    if (typeTag === DATE)        return decodeDate(buffer, cursor)
    if (typeTag === REGEXP)      return decodeRegex(buffer, cursor)
    if (typeTag === BIGINTP)     return decodeBigInt(buffer, cursor)
    if (typeTag === BIGINTN)     return -decodeBigInt(buffer, cursor)
    if (typeTag === STRING)      return decodeString(buffer, cursor)
    if (typeTag === ARRAY)       return decodeArray(buffer, cursor, referrables)
    if (typeTag === OBJECT)      return decodeObject(buffer, cursor, referrables)
    if (typeTag === SET)         return decodeSet(buffer, cursor, referrables)
    if (typeTag === MAP)         return decodeMap(buffer, cursor, referrables)
    if (typeTag & ERROR)         return decodeError(buffer, typeTag, cursor, referrables)
    if (typeTag === ARRAYBUFFER) return decodeArrayBuffer(buffer, cursor, referrables)
    if (typeTag & ARRAYBUFFER)   return decodeTypedArray(buffer, typeTag, cursor, referrables)

    throw new Unreachable
}

function concatArrayBuffers(...buffers : ArrayBuffer[]){
    
    let cumulativeSize = 0
    for (const buffer of buffers)
        cumulativeSize += buffer.byteLength
    
	const result = new Uint8Array(cumulativeSize)
	
    let offset = 0
    for (const buffer of buffers) {
		result.set(new Uint8Array(buffer), offset)
		offset += buffer.byteLength
	}
    
	return result.buffer as ArrayBuffer
}

function maybeEncodeReference<T>(
    value : T,
    referrables : Memory,
    encoder : (x : T, referrables : Memory) => ArrayBuffer
) {
    const alreadyEncoded = referrables.indexOf(value)
    
    if (alreadyEncoded === -1) {
        referrables.push(value)
        return encoder(value, referrables)
    }
    
    else return encodeReference(alreadyEncoded)
}

function encodeReference(reference : number) {
    return concatArrayBuffers(Uint8Array.of(REFERENCE), encodeVarint(reference).buffer)
}

function decodeReference(buffer : ArrayBuffer, cursor : Cursor, referrables : Memory) {
    const reference = decodeVarint(buffer, cursor)
    return referrables[reference]
}

function encodeNumber(number : number) {
    const buffer = new ArrayBuffer(9)
    const view = new DataView(buffer)
    view.setUint8(0, NUMBER)
    view.setFloat64(1, number)
    return buffer
}

function decodeNumber(buffer : ArrayBuffer, cursor : Cursor) {
    const view = new DataView(buffer, cursor.offset)
    cursor.offset += 8
    return view.getFloat64(0)
}

function encodeDate(date : Date) {
    const buffer = new ArrayBuffer(9)
    const view = new DataView(buffer)
    view.setUint8(0, DATE)
    view.setFloat64(1, date.getTime())
    return buffer
}

function decodeDate(buffer : ArrayBuffer, cursor : Cursor) {
    const view = new DataView(buffer, cursor.offset)
    cursor.offset += 8
    return new Date(view.getFloat64(0))
}

function encodeRegex(regex : RegExp) {
    return concatArrayBuffers(Uint8Array.of(REGEXP).buffer, encodeString(regex.source), encodeString(regex.flags))
}

function decodeRegex(buffer : ArrayBuffer, cursor : Cursor) {
    cursor.offset += 1 // the string tag
    const source = decodeString(buffer, cursor);
    cursor.offset += 1 // the string tag
    const flags = decodeString(buffer, cursor);
    return new RegExp(source, flags);
}

// benchmarks/bigint-encode.ts
function encodeBigInt(bigint : bigint) {
    
    const negative = bigint < 0n
    
    let b = negative ? -bigint : bigint
    let uint64Count = 0
    while (b > 0n) {
        uint64Count++
        b >>= 64n
    }
    
    if (uint64Count > 255) throw new NotSerializable(bigint)
    
    const buffer = new ArrayBuffer(2 + 8 * uint64Count)
    const view = new DataView(buffer)
    
    view.setUint8(0, negative ? BIGINTN : BIGINTP)
    view.setUint8(1, uint64Count)
    
    if (negative) bigint *= -1n
    
    let offset = 2
    while (bigint > 0n) {
        const uint64 = bigint & 0xffffffffffffffffn
        view.setBigUint64(offset, uint64)
        offset += 8
        bigint >>= 64n
    }
    
    return buffer
}

function decodeBigInt(buffer : ArrayBuffer, cursor : Cursor) {
    const view = new DataView(buffer)
    const length = view.getUint8(cursor.offset)
    cursor.offset += 1
    
    let bigint = 0n
    let shift = 0n
    for (let i = 0; i < length; i++) {
        bigint |= view.getBigUint64(cursor.offset) << shift
        cursor.offset += 8
        shift += 64n
    }
    
    return bigint
}

function encodeString(string : string) {
    const encodedBuffer = new TextEncoder().encode(string).buffer
    return concatArrayBuffers(
        Uint8Array.of(STRING).buffer,
        encodeVarint(encodedBuffer.byteLength).buffer,
        encodedBuffer
    )
}

function decodeString(buffer : ArrayBuffer, cursor : Cursor) {
    const textBufferLength = decodeVarint(buffer, cursor)
    const decodedString = new TextDecoder().decode(new Uint8Array(buffer, cursor.offset, textBufferLength))
    cursor.offset += textBufferLength
    return decodedString
}

function encodeArray(array : unknown[], referrables : Memory) {
    if (array.length !== Object.keys(array).length) throw new NotSerializable(array)
    return concatArrayBuffers(
        Uint8Array.of(ARRAY).buffer,
        encodeVarint(array.length).buffer,
        ...array.map(x => encodeImpl(x, referrables)!)
    )
}

function decodeArray(buffer : ArrayBuffer, cursor : Cursor, referrables : Memory) {
    
    const result : unknown[] = []
    referrables.push(result)
    
    const arrayLength = decodeVarint(buffer, cursor)
    
    for (let i = 0; i < arrayLength; i++)
        result.push(decodeImpl(buffer, cursor, referrables))
    
    return result
}

function encodeObject(object : Record<string, unknown>, referrables : Memory) : ArrayBuffer {
    const keys = Object.keys(object)
    return concatArrayBuffers(
        Uint8Array.of(OBJECT).buffer,
        encodeVarint(keys.length).buffer,
        ...keys.map(key =>
            concatArrayBuffers(
                encodeString(key),
                encodeImpl(object[key], referrables)!
            )
        )
    )
}

function decodeObject(buffer : ArrayBuffer, cursor : Cursor, referrables : Memory) {
    const objectLength = decodeVarint(buffer, cursor)
    const result : Record<string, unknown> = {}
    referrables.push(result)

    for (let i = 0; i < objectLength; i++) {
        // ignore the tag for the key, go directly to decoding it as a string
        cursor.offset += 1
        const key = decodeString(buffer, cursor)
        result[key] = decodeImpl(buffer, cursor, referrables)
    }

    return result
}

function encodeSet(set : Set<unknown>, referrables : Memory) {
    return concatArrayBuffers(
        Uint8Array.of(SET).buffer,
        encodeVarint(set.size).buffer,
        ...[...set].map(value => encodeImpl(value, referrables)!)
    )
}

function decodeSet(buffer : ArrayBuffer, cursor : Cursor, referrables : Memory) {
    const setLength = decodeVarint(buffer, cursor)
    const result = new Set
    referrables.push(result)

    for (let i = 0; i < setLength; i++) {
        const element = decodeImpl(buffer, cursor, referrables)
        result.add(element)
    }
    
    return result
}

function encodeMap(map : Map<unknown, unknown>, referrables : Memory) {
    return concatArrayBuffers(
        Uint8Array.of(MAP).buffer,
        encodeVarint(map.size).buffer,
        ...[...map].map(([key, value]) =>
            concatArrayBuffers(
                encodeImpl(key, referrables)!,
                encodeImpl(value, referrables)!
            )
        )
    )
}

function decodeMap(buffer : ArrayBuffer, cursor : Cursor, referrables : Memory) {
    const mapLength = decodeVarint(buffer, cursor)
    const result = new Map
    referrables.push(result)

    for (let i = 0; i < mapLength; i++) {
        const key = decodeImpl(buffer, cursor, referrables)
        const value = decodeImpl(buffer, cursor, referrables)
        result.set(key, value)
    }

    return result
}

function tagOfError(error : Error) {
    const constructor = error.constructor

    if (constructor === Error)          return ERROR
    if (constructor === EvalError)      return EVAL_ERROR
    if (constructor === RangeError)     return RANGE_ERROR
    if (constructor === ReferenceError) return REFERENCE_ERROR
    if (constructor === SyntaxError)    return SYNTAX_ERROR
    if (constructor === TypeError)      return TYPE_ERROR
    if (constructor === URIError)       return URI_ERROR
    
    throw new NotSerializable(error)
}

function constructorOfError(tag : number) {
    if (tag === ERROR)           return Error
    if (tag === EVAL_ERROR)      return EvalError
    if (tag === RANGE_ERROR)     return RangeError
    if (tag === REFERENCE_ERROR) return ReferenceError
    if (tag === SYNTAX_ERROR)    return SyntaxError
    if (tag === TYPE_ERROR)      return TypeError
    if (tag === URI_ERROR)       return URIError

    throw new Unreachable
}

function encodeError(error : Error, referrables : Memory) {
    return concatArrayBuffers(
        Uint8Array.of(tagOfError(error)).buffer,
        encodeString(error.message),
        encodeString(error.stack ?? ''),
        encodeImpl((error as unknown as { cause: unknown } ).cause, referrables)!
    )
}

function decodeError(buffer : ArrayBuffer, typeTag : number, cursor : Cursor, referrables : Memory) {
    // ignore the tag for the message, go directly to decoding it as a string
    cursor.offset += 1
    const message = decodeString(buffer, cursor)
    
    // ignore the tag for the stack, go directly to decoding it as a string
    cursor.offset += 1
    const stack = decodeString(buffer, cursor)
    const cause = decodeImpl(buffer, cursor, referrables)
    
    const error : Error =
        cause === undefined
            ? new (constructorOfError(typeTag))(message)
            // @ts-ignore error cause has been supported by every major runtime since 2021
            : new (constructorOfError(typeTag))(message, { cause })
    
    error.stack = stack
    
    return error
}

function encodeArrayBuffer(buffer : ArrayBuffer) {
    return concatArrayBuffers(
        Uint8Array.of(ARRAYBUFFER).buffer,
        encodeVarint(buffer.byteLength).buffer,
        buffer
    )
}

function decodeArrayBuffer(buffer : ArrayBuffer, cursor : Cursor, referrables : Memory) {
    const bufferLength = decodeVarint(buffer, cursor)
    const decodedBuffer = buffer.slice(cursor.offset, cursor.offset + bufferLength)
    cursor.offset += bufferLength
    referrables.push(decodedBuffer)
    return decodedBuffer
}

function tagOfTypedArray(typedArray : TypedArray) {
    const constructor = typedArray.constructor
    
    if (constructor === DataView)          return DATAVIEW
    if (constructor === Int8Array)         return INT8ARRAY
    if (constructor === Uint8Array)        return UINT8ARRAY
    if (constructor === Uint8ClampedArray) return UINT8CLAMPEDARRAY
    if (constructor === Int16Array)        return INT16ARRAY
    if (constructor === Uint16Array)       return UINT16ARRAY
    if (constructor === Int32Array)        return INT32ARRAY
    if (constructor === Uint32Array)       return UINT32ARRAY
    if (constructor === Float32Array)      return FLOAT32ARRAY
    if (constructor === Float64Array)      return FLOAT64ARRAY
    if (constructor === BigInt64Array)     return BIGINT64ARRAY
    if (constructor === BigUint64Array)    return BIGUINT64ARRAY
    
    throw new NotSerializable(typedArray)
}

function constructorOfTypedArray(typeTag : number) {
    if (typeTag === DATAVIEW)          return DataView
    if (typeTag === INT8ARRAY)         return Int8Array
    if (typeTag === UINT8ARRAY)        return Uint8Array
    if (typeTag === UINT8CLAMPEDARRAY) return Uint8ClampedArray
    if (typeTag === INT16ARRAY)        return Int16Array
    if (typeTag === UINT16ARRAY)       return Uint16Array
    if (typeTag === INT32ARRAY)        return Int32Array
    if (typeTag === UINT32ARRAY)       return Uint32Array
    if (typeTag === FLOAT32ARRAY)      return Float32Array
    if (typeTag === FLOAT64ARRAY)      return Float64Array
    if (typeTag === BIGINT64ARRAY)     return BigInt64Array
    if (typeTag === BIGUINT64ARRAY)    return BigUint64Array
    
    throw new Unreachable
}

function encodeTypedArray(typedArray : TypedArray) {
    return concatArrayBuffers(
        Uint8Array.of(tagOfTypedArray(typedArray)).buffer,
        encodeVarint(typedArray.buffer.byteLength).buffer,
        encodeVarint(typedArray.byteOffset).buffer,
        encodeVarint(typedArray instanceof DataView ? typedArray.byteLength : typedArray.length).buffer,
        typedArray.buffer
    )
}

function decodeTypedArray(buffer : ArrayBuffer, typeTag: number, cursor : Cursor, referrables : Memory) {
    const bufferLength = decodeVarint(buffer, cursor)
    const byteOffset   = decodeVarint(buffer, cursor)
    const viewLength   = decodeVarint(buffer, cursor)
    const sourceBuffer = buffer.slice(cursor.offset, cursor.offset + bufferLength)
    cursor.offset     += bufferLength
    const TypedArray   = constructorOfTypedArray(typeTag)
    const decodedView  = new TypedArray(sourceBuffer, byteOffset, viewLength)
    referrables.push(decodedView)
    return decodedView
}

function varIntByteCount(num: number): number {
    
    let byteCount = 1
    while (num >= 0b10000000) {
        num >>>= 7
        byteCount++
    }
    
    return byteCount
}

// benchmarks/varint-encode.ts
function encodeVarint(num: number): Uint8Array {
    
    const byteCount = varIntByteCount(num)
    const arr = new Uint8Array(byteCount)
    
    for (let i = 0; i < byteCount; i++) {
        arr[i] = (num & 0b01111111) | (i === (byteCount - 1) ? 0 : 0b10000000)
        num >>>= 7
    }
    
    return arr
}

function decodeVarint(buffer : ArrayBuffer, cursor : Cursor): number {
    
    const byteArray = new Uint8Array(buffer, cursor.offset)

    let num = 0
    let shift = 0
    for (let i = 0; i < byteArray.length; i++) {
        const varIntPart = byteArray[i]
        cursor.offset += 1
        num |= (varIntPart & 0b01111111) << shift
        if ((varIntPart & 0b10000000) === 0) return num
        shift += 7
    }
    
    throw new Unreachable
}
