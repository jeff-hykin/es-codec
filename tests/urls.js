import { encode, decode } from "../es-codec.js"

export default function (runner, assertEquals) {
    runner("URL", () => {
        let value

        value = new URL("https://discord.com/channels/684898665143206084/1127060234540699678")
        assertEquals(value, decode(encode(value)))
        
        value = new URL("ftp://somewhere.io")
        assertEquals(value, decode(encode(value)))
    })
}
