import { encode, decode } from "../es-codec.js"

export default function (runner, assertEquals) {
    runner("Symbol", () => {
        let value

        value = Symbol.for("stuff")
        assertEquals(value, decode(encode(value)))
        
        value = Symbol.for("asyncIterator")
        assertEquals(value, decode(encode(value)))
    })
}
