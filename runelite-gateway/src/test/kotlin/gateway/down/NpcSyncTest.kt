package gateway.down

import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class NpcSyncTest {
    @Test
    fun `an npc on a boat's deck is placed from the deck's corner, on level 0`() {
        val sync = NpcSync { index -> if (index == BOAT) DECK_X to DECK_Z else null }
        val added = sync.decode(TspsPacket(TspsServerPacket.NPC_INFO, frame(worldView = BOAT, dx = 3, dz = 2))).changes.single() as NpcSync.Change.Added
        assertEquals(Triple(DECK_X + 3, DECK_Z + 2, true), Triple(added.npc.x, added.npc.z, added.npc.onDeck))

        val main = NpcSync().decode(TspsPacket(TspsServerPacket.NPC_INFO, frame(worldView = null, dx = 3, dz = 2))).changes.single() as NpcSync.Change.Added
        assertEquals(Triple(ROOT_X + 3, ROOT_Z + 2, false), Triple(main.npc.x, main.npc.z, main.npc.onDeck))
    }

    @Test
    fun `a spawn direction is renumbered from tsps's south-west origin to the game's north-west one`() {
        // tsps 1 (south) is the game's 6: Lumbridge's bankers faced the wall in RuneLite (#1826).
        val faced = (0..7).map { tsps ->
            (NpcSync().decode(TspsPacket(TspsServerPacket.NPC_INFO, frame(worldView = null, dx = 0, dz = 0, direction = tsps))).changes.single() as NpcSync.Change.Added).direction
        }
        assertEquals(listOf(5, 6, 7, 3, 4, 0, 1, 2), faced)
    }

    @Test
    fun `cross-floor npc spawns carry their plane`() {
        val packet = frame(worldView = null, dx = 3, dz = 2, plane = 2)
        val added = NpcSync().decode(TspsPacket(TspsServerPacket.NPC_INFO, packet)).changes.single() as NpcSync.Change.Added
        assertEquals(2, added.npc.level)
    }

    /** tsps's NPC_INFO with no NPCs yet and one added: no block, small deltas. */
    private fun frame(worldView: Int?, dx: Int, dz: Int, direction: Int = 0, plane: Int? = null): ByteArray {
        val bits = StringBuilder()
        fun write(width: Int, value: Int) = bits.append(Integer.toBinaryString(value).padStart(32, '0').takeLast(width))
        write(8, 0)
        write(16, NPC)
        write(1, 0)
        write(1, if (worldView != null) 1 else 0)
        if (worldView != null) write(32, worldView)
        write(1, 0)
        write(5, dz)
        write(5, dx)
        write(3, direction)
        write(16, TYPE)
        if (plane != null) write(2, plane)
        write(16, 0xFFFF)
        while (bits.length % 8 != 0) bits.append('0')
        val body = ByteArray(bits.length / 8) { bits.substring(it * 8, it * 8 + 8).toInt(2).toByte() }
        return TspsWriter().i32(0).u8(if (plane != null) 2 else 0).u16(ROOT_X).u16(ROOT_Z).u16(body.size).bytes(body).body()
    }

    private companion object {
        const val BOAT = 3000
        const val NPC = 7
        const val TYPE = 3010
        const val DECK_X = 9600
        const val DECK_Z = 9600
        const val ROOT_X = 3069
        const val ROOT_Z = 2987
    }
}
