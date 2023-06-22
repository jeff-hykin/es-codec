/***** TYPE TAGS *****/

const NULL        = 0b00000001
const UNDEFINED   = 0b00000010
const TRUE        = 0b00000011
const FALSE       = 0b00000100
const REFERENCE   = 0b00000101
const NUMBER      = 0b00000110
const DATE        = 0b00000111
const STRING      = 0b00001000
const BIGINTN     = 0b00001001
const BIGINTP     = 0b00001010
const ARRAY       = 0b00001011
const OBJECT      = 0b00001100
const SET         = 0b00001101
const MAP         = 0b00001110

const ERROR          = 0b00010000
const EVALERROR      = 0b00010001
const RANGEERROR     = 0b00010010
const REFERENCEERROR = 0b00010011
const SYNTAXERROR    = 0b00010100
const TYPEERROR      = 0b00010101
const URIERROR       = 0b00010110

const ARRAYBUFFER       = 0b00100000
const DATAVIEW          = 0b00100001
const INT8ARRAY         = 0b00100010
const UINT8ARRAY        = 0b00100011
const UINT8CLAMPEDARRAY = 0b00100100
const INT16ARRAY        = 0b00100101
const UINT16ARRAY       = 0b00100110
const INT32ARRAY        = 0b00100111
const UINT32ARRAY       = 0b00101000
const FLOAT32ARRAY      = 0b00101001
const FLOAT64ARRAY      = 0b00101010
const BIGINT64ARRAY     = 0b00101011
const BIGUINT64ARRAY    = 0b00101100

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

class NotSerializable extends Error {
    constructor(readonly value) {
        super()
    }
}

class Unreachable extends Error {}

export function encode(x : unknown, memory : Memory = []) : ArrayBuffer {
    
    /* unique types */
    if (x === null)      return Uint8Array.of(NULL).buffer
    if (x === undefined) return Uint8Array.of(UNDEFINED).buffer
    if (x === true)      return Uint8Array.of(TRUE).buffer
    if (x === false)     return Uint8Array.of(FALSE).buffer
    
    /* simple types */
    if (x.constructor === Number) return encodeNumber(x)
    if (x.constructor === Date)   return encodeDate(x)
    
    /* lengthy types */
    if (x.constructor === BigInt) return encodeBigInt(x)
    if (x.constructor === String) return encodeString(x)
    
    /* container types */
    if (x.constructor === Object) return maybeEncodeReference(x as Record<string, unknown>, memory, encodeObject)
    if (x.constructor === Set)    return maybeEncodeReference(x, memory, encodeSet)
    
    /* error types */
    if (x instanceof Error) return maybeEncodeReference(x, memory, encodeError)
    
    /* low-level types */
    if (x.constructor === ArrayBuffer) return maybeEncodeReference(x, memory, encodeArrayBuffer)
    if (ArrayBuffer.isView(x))         return maybeEncodeReference(x as TypedArray, memory, encodeTypedArray)
    
    throw new NotSerializable(x)
}

export function decode(buffer : ArrayBuffer, cursor = { offset: 0 }, memory : Memory = []) {
    const view    = new DataView(buffer, cursor.offset)
    
    const typeTag = view.getUint8(0)
    cursor.offset += 1
    
    if (typeTag === NULL)        return null
    if (typeTag === UNDEFINED)   return undefined
    if (typeTag === TRUE)        return true
    if (typeTag === FALSE)       return false
    if (typeTag === REFERENCE)   return decodeReference(buffer, cursor, memory)
    if (typeTag === NUMBER)      return decodeNumber(buffer, cursor)
    if (typeTag === DATE)        return decodeDate(buffer, cursor)
    if (typeTag === BIGINTP)     return decodeBigInt(buffer, cursor)
    if (typeTag === BIGINTN)     return -decodeBigInt(buffer, cursor)
    if (typeTag === STRING)      return decodeString(buffer, cursor)
    if (typeTag === OBJECT)      return decodeObject(buffer, cursor, memory)
    if (typeTag === SET)         return decodeSet(buffer, cursor, memory)
    if (typeTag & ERROR)         return decodeError(buffer, typeTag, cursor, memory)
    if (typeTag === ARRAYBUFFER) return decodeArrayBuffer(buffer, cursor, memory)
    if (typeTag & ARRAYBUFFER)   return decodeTypedArray(buffer, typeTag, cursor, memory)

    throw new Unreachable
}

export function concatArrayBuffers(...buffers : ArrayBuffer[]){
    
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
    memory : Memory,
    encoder : (x : T, memory : Memory) => ArrayBuffer
) {
    const alreadyEncoded = memory.indexOf(value)
    
    if (alreadyEncoded === -1) {
        memory.push(value)
        return encoder(value, memory)
    }
    
    else return encodeReference(alreadyEncoded)
}

function encodeReference(reference : number) {
    return concatArrayBuffers(Uint8Array.of(REFERENCE), encodeVarint(reference).buffer)
}

function decodeReference(buffer : ArrayBuffer, cursor : Cursor, memory : Memory) {
    const reference = decodeVarint(buffer, cursor)
    return memory[reference]
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

// benchmarks/bigint-encode.ts
export function encodeBigInt(bigint : bigint) {
    
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

function encodeObject(object : Record<string, unknown>, memory : Memory) : ArrayBuffer {
    const keys = Object.keys(object)
    return concatArrayBuffers(
        Uint8Array.of(OBJECT).buffer,
        encodeVarint(keys.length).buffer,
        ...keys.map(key =>
            concatArrayBuffers(
                encodeString(key),
                encode(object[key], memory)!
            )
        )
    )
}

function decodeObject(buffer : ArrayBuffer, cursor : Cursor, memory : Memory) {
    const objectLength = decodeVarint(buffer, cursor)
    
    const result : Record<string, unknown> = {}
    memory.push(result)

    for (let i = 0; i < objectLength; i++) {
        // ignore the tag for the key, go directly to decoding it as a string
        cursor.offset += 1
        const key = decodeString(buffer, cursor)
        result[key] = decode(buffer, cursor, memory)
    }

    return result
}

function encodeSet(set : Set<unknown>, memory : Memory) {
    return concatArrayBuffers(
        Uint8Array.of(SET).buffer,
        encodeVarint(set.size).buffer,
        ...[...set].map(value => encode(value, memory)!)
    )
}

function decodeSet(buffer : ArrayBuffer, cursor : Cursor, memory : Memory) {
    const setLength = decodeVarint(buffer, cursor)
    const result = new Set
    memory.push(result)

    for (let i = 0; i < setLength; i++) {
        const element = decode(buffer, cursor, memory)
        result.add(element)
    }
    
    return result
}

function encodeMap(map : Map<unknown, unknown>, memory : Memory) {
    return concatArrayBuffers(
        Uint8Array.of(MAP).buffer,
        encodeVarint(map.size).buffer,
        ...[...map].map(([key, value]) =>
            concatArrayBuffers(
                encode(key, memory)!,
                encode(value, memory)!
            )
        )
    )
}

function decodeMap(buffer : ArrayBuffer, cursor : Cursor, memory : Memory) {
    const mapLength = decodeVarint(buffer, cursor)
    const result = new Map
    memory.push(result)

    for (let i = 0; i < mapLength; i++) {
        const key = decode(buffer, cursor, memory)
        const value = decode(buffer, cursor, memory)
        result.set(key, value)
    }

    return result
}

function tagOfError(error : Error) {
    if (error.constructor === Error)          return ERROR
    if (error.constructor === EvalError)      return EVALERROR
    if (error.constructor === RangeError)     return RANGEERROR
    if (error.constructor === ReferenceError) return REFERENCEERROR
    if (error.constructor === SyntaxError)    return SYNTAXERROR
    if (error.constructor === TypeError)      return TYPEERROR
    if (error.constructor === URIError)       return URIERROR

    throw new NotSerializable(error)
}

function constructorOfError(tag : number) {
    if (tag === ERROR)          return Error
    if (tag === EVALERROR)      return EvalError
    if (tag === RANGEERROR)     return RangeError
    if (tag === REFERENCEERROR) return ReferenceError
    if (tag === SYNTAXERROR)    return SyntaxError
    if (tag === TYPEERROR)      return TypeError
    if (tag === URIERROR)       return URIError

    throw new Unreachable
}

function encodeError(error : Error, memory : Memory) {
    return concatArrayBuffers(
        Uint8Array.of(tagOfError(error)).buffer,
        encodeString(error.message),
        encodeString(error.stack ?? ''),
        encode((error as unknown as { cause: unknown } ).cause, memory)!
    )
}

function decodeError(buffer : ArrayBuffer, typeTag : number, cursor : Cursor, memory : Memory) {
    // ignore the tag for the message, go directly to decoding it as a string
    cursor.offset += 1
    const message = decodeString(buffer, cursor)
    
    // ignore the tag for the stack, go directly to decoding it as a string
    cursor.offset += 1
    const stack = decodeString(buffer, cursor)
    const cause = decode(buffer, cursor, memory)
    
    const error =
        cause === undefined
            ? new (constructorOfError(typeTag))(message)
            // @ts-ignore
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

function decodeArrayBuffer(buffer : ArrayBuffer, cursor : Cursor, memory : Memory) {
    const bufferLength = decodeVarint(buffer, cursor)
    const decodedBuffer = buffer.slice(cursor.offset, cursor.offset + bufferLength)
    cursor.offset += bufferLength
    memory.push(decodedBuffer)
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

function decodeTypedArray(buffer : ArrayBuffer, typeTag: number, cursor : Cursor, memory : Memory) {
    const bufferLength = decodeVarint(buffer, cursor)
    const byteOffset   = decodeVarint(buffer, cursor)
    const viewLength   = decodeVarint(buffer, cursor)
    const sourceBuffer = buffer.slice(cursor.offset, cursor.offset + bufferLength)
    cursor.offset     += bufferLength
    const TypedArray   = constructorOfTypedArray(typeTag)
    const decodedView  = new TypedArray(sourceBuffer, byteOffset, viewLength)
    memory.push(decodedView)
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
export function encodeVarint(num: number): Uint8Array {
    
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
