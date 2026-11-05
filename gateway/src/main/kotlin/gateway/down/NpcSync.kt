package gateway.down

import gateway.tsps.TspsPacket

/**
 * Follows tsps's `NPC_INFO` (21) (`encodeNpcSync` in ClientProtocol.ts): which NPCs this
 * session sees, where, and their update blocks.
 */
class NpcSync(
    /** The south-west tile of a boat's deck, by its world entity index. */
    private val deckBase: (Int) -> Pair<Int, Int>? = { null },
) {
    /** [onDeck]: it stands on a boat's deck (level 0 there), not in the main world. */
    class Npc(val index: Int, var type: Int, var x: Int, var z: Int, var level: Int, val onDeck: Boolean = false)

    sealed class Change(val index: Int) {
        /**
         * Came into view (or was re-added after a jump or type change), facing [direction] in
         * the game's numbering (0 north-west, 1 north, ... 6 south, 7 south-east), as rsprot takes it.
         */
        class Added(index: Int, val npc: Npc, val direction: Int, val jump: Boolean) : Change(index)

        class Removed(index: Int) : Change(index)

        /** Moved one step ([run] = two), or crawled. */
        class Moved(index: Int, val steps: List<Pair<Int, Int>>, val crawl: Boolean) : Change(index)
    }

    class Frame(val changes: List<Change>, val blocks: Map<Int, ActorBlock>)

    private var indices = ArrayList<Int>()
    val npcs = HashMap<Int, Npc>()

    fun decode(packet: TspsPacket): Frame {
        val reader = packet.reader()
        reader.i32() // loop cycle
        val flags = reader.u8()
        val large = flags and 1 != 0
        val crossFloor = flags and 2 != 0
        val rootX = reader.u16()
        val rootZ = reader.u16()
        reader.u16() // length
        val bits = BitReader(packet.payload, reader.offset)
        val changes = ArrayList<Change>()
        val updates = ArrayList<Int>()
        val next = ArrayList<Int>()

        val count = bits.read(8)
        for (index in indices.take(count)) {
            if (bits.read(1) == 0) {
                next += index
                continue
            }
            val npc = npcs.getValue(index)
            when (bits.read(2)) {
                0 -> {
                    next += index
                    updates += index
                }
                1 -> {
                    val direction = bits.read(3)
                    step(npc, direction)
                    changes += Change.Moved(index, listOf(DX[direction] to DZ[direction]), crawl = false)
                    if (bits.read(1) == 1) updates += index
                    next += index
                }
                2 -> {
                    val run = bits.read(1) == 1
                    val first = bits.read(3)
                    step(npc, first)
                    val steps = mutableListOf(DX[first] to DZ[first])
                    if (run) {
                        val second = bits.read(3)
                        step(npc, second)
                        steps += DX[second] to DZ[second]
                    }
                    changes += Change.Moved(index, steps, crawl = !run)
                    if (bits.read(1) == 1) updates += index
                    next += index
                }
                else -> {
                    npcs.remove(index)
                    changes += Change.Removed(index)
                }
            }
        }

        while (true) {
            val index = bits.read(16)
            if (index == END) break
            if (bits.read(1) == 1) updates += index
            // An NPC on a boat's deck is placed from the deck's corner, not the player's tile.
            val deck = if (bits.read(1) == 1) deckBase(bits.read(32) and 0xFFFF) else null
            val jump = bits.read(1) == 1
            val dz = signed(bits.read(if (large) 8 else 5), if (large) 8 else 5)
            val dx = signed(bits.read(if (large) 8 else 5), if (large) 8 else 5)
            val direction = bits.read(3)
            val type = bits.read(16)
            val level = if (crossFloor) bits.read(2) else -1
            val (baseX, baseZ) = deck ?: (rootX to rootZ)
            val npc = Npc(index, type, baseX + dx, baseZ + dz, level, onDeck = deck != null)
            npcs[index] = npc
            next += index
            changes += Change.Added(index, npc, GAME_DIRECTION[direction], jump)
        }
        bits.alignToByte()
        indices = next

        val blockReader = BlockReader(packet.payload, bits.byteOffset)
        val blocks = LinkedHashMap<Int, ActorBlock>()
        for (index in updates) blocks[index] = ActorBlocks.npc(blockReader)
        return Frame(changes, blocks)
    }

    private fun step(npc: Npc, direction: Int) {
        npc.x += DX[direction]
        npc.z += DZ[direction]
    }

    private fun signed(value: Int, bits: Int) = if (value >= 1 shl (bits - 1)) value - (1 shl bits) else value

    private companion object {
        const val END = 0xFFFF
        val DX = intArrayOf(-1, 0, 1, -1, 1, -1, 0, 1)
        val DZ = intArrayOf(-1, -1, -1, 0, 0, 1, 1, 1)

        /**
         * tsps numbers directions from south-west ([DX], [DZ]); the game from north-west (its
         * NPC_TURN_ANGLES are 768, 1024, 1280, 512, 1536, 256, 0, 1792). Passed through as is,
         * every NPC spawned facing south faced north in RuneLite (#1826's Lumbridge bankers).
         */
        val GAME_DIRECTION = intArrayOf(5, 6, 7, 3, 4, 0, 1, 2)
    }
}
