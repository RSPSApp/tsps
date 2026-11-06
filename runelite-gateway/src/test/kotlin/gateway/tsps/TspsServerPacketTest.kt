package gateway.tsps

import gateway.headless.TestCache
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.nio.file.Files

/** The gateway's copy of tsps's server opcode table must match ServerPackets.ts. */
class TspsServerPacketTest {
    @Test
    fun `lengths match ServerPackets ts`() {
        val source = Files.readString(TestCache.config.root.resolve("server/src/main/typescript/elvarg/net/protocol/ServerPackets.ts"))
        val (enumPart, lengthPart) = source.split("SERVER_PACKET_LENGTHS", limit = 2)
        val ids =
            Regex("""^\s+([A-Z0-9_]+)\s*=\s*(\d+),""", RegexOption.MULTILINE)
                .findAll(enumPart)
                .associate { it.groupValues[1] to it.groupValues[2].toInt() }
        val lengths =
            Regex("""\[ServerPacketId\.([A-Z0-9_]+)]:\s*(-?\d+)""")
                .findAll(lengthPart)
                .associate { ids.getValue(it.groupValues[1]) to it.groupValues[2].toInt() }
        assertEquals(lengths, TspsServerPacket.LENGTHS)
    }
}
