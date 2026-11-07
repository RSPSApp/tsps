package gateway.down

import gateway.tsps.TspsPacket

/**
 * Follows tsps's `PLAYER_SYNC` (20) the way the browser client's PlayerUpdateDecoder does, to
 * know where every player tsps shows this session is. tsps sends movement as deltas against the
 * last tick, so the decoder keeps the same per-index state the browser does.
 *
 * Only the bit stream is decoded here; the update blocks that follow it are kept as raw bytes
 * for [updateBlocks].
 */
class PlayerSync {
    class Tile(val x: Int, val z: Int, val level: Int)

    /** One decoded tick. */
    class Frame(
        val localIndex: Int,
        /** Every visible player's tile after this tick, the local player included. */
        val tiles: Map<Int, Tile>,
        /** Players that came into view this tick. */
        val added: Set<Int>,
        /** Players that left view this tick. */
        val removed: Set<Int>,
        /** Players moved further than one run step: a teleport. */
        val teleported: Set<Int>,
        /** Indices with an update block, in block order. */
        val updateIndices: List<Int>,
        /** The update blocks, starting after the bit stream. */
        val updateBlocks: ByteArray,
    )

    private val flags = ByteArray(MAX_PLAYERS)
    private val active = BooleanArray(MAX_PLAYERS)
    private val x = IntArray(MAX_PLAYERS)
    private val z = IntArray(MAX_PLAYERS)
    private val level = IntArray(MAX_PLAYERS)
    private val regions = IntArray(MAX_PLAYERS)
    private var localIndex = -1

    /**
     * A forced movement moved [index] to [x], [z]: tsps counts its next deltas from there, as the
     * browser does once it has read the update block.
     */
    fun moveTo(index: Int, x: Int, z: Int) {
        this.x[index] = x
        this.z[index] = z
    }

    fun decode(packet: TspsPacket): Frame {
        val reader = packet.reader()
        reader.u16() // scene base x
        reader.u16() // scene base y
        val index = reader.u16()
        reader.i32() // loop cycle
        val length = reader.u16()
        val start = reader.offset
        if (localIndex == -1) {
            localIndex = index
            active[index] = true
        }

        val added = HashSet<Int>()
        val removed = HashSet<Int>()
        val teleported = HashSet<Int>()
        val updates = ArrayList<Int>()
        val bits = BitReader(packet.payload, start)
        val players = (1 until MAX_PLAYERS).filter { active[it] }
        val empty = (1 until MAX_PLAYERS).filter { !active[it] }

        var skip = 0
        fun pass(indices: List<Int>, wantBit0: Int, external: Boolean) {
            for (i in indices) {
                if ((flags[i].toInt() and 1) != wantBit0) continue
                if (skip > 0) {
                    skip--
                    flags[i] = (flags[i].toInt() or 2).toByte()
                    continue
                }
                if (bits.read(1) == 0) {
                    skip = readSkip(bits)
                    flags[i] = (flags[i].toInt() or 2).toByte()
                } else if (external) {
                    if (readExternal(bits, i, updates, added)) flags[i] = (flags[i].toInt() or 2).toByte()
                } else {
                    readActive(bits, i, updates, added, removed, teleported)
                }
            }
            check(skip == 0) { "player sync skip count left at $skip" }
        }
        pass(players, 0, external = false)
        bits.alignToByte()
        pass(players, 1, external = false)
        bits.alignToByte()
        pass(empty, 1, external = true)
        bits.alignToByte()
        pass(empty, 0, external = true)
        bits.alignToByte()
        for (i in 1 until MAX_PLAYERS) flags[i] = ((flags[i].toInt() and 0xFF) ushr 1).toByte()

        val blocksStart = bits.byteOffset
        val tiles = (1 until MAX_PLAYERS).filter { active[it] }.associateWith { Tile(x[it], z[it], level[it]) }
        return Frame(
            localIndex,
            tiles,
            added,
            removed,
            teleported,
            updates,
            packet.payload.copyOfRange(blocksStart, start + length),
        )
    }

    private fun readActive(
        bits: BitReader,
        index: Int,
        updates: MutableList<Int>,
        added: MutableSet<Int>,
        removed: MutableSet<Int>,
        teleported: MutableSet<Int>,
    ) {
        val needsUpdate = bits.read(1) == 1
        if (needsUpdate) updates += index
        when (bits.read(2)) {
            0 -> {
                if (needsUpdate || index == localIndex) return
                regions[index] = (level[index] shl 28) or (((x[index] ushr 13) and 0xFF) shl 14) or ((z[index] ushr 13) and 0xFF)
                active[index] = false
                removed += index
                if (bits.read(1) == 1) readExternal(bits, index, updates, added)
            }
            1 -> {
                val direction = bits.read(3)
                x[index] += WALK_DX[direction]
                z[index] += WALK_DZ[direction]
            }
            2 -> {
                val code = bits.read(4)
                x[index] += RUN_DX[code]
                z[index] += RUN_DZ[code]
            }
            else -> {
                if (bits.read(1) == 0) {
                    val packed = bits.read(12)
                    x[index] += signed5((packed ushr 5) and 0x1F)
                    z[index] += signed5(packed and 0x1F)
                    level[index] = (level[index] + ((packed ushr 10) and 3)) and 3
                } else {
                    val packed = bits.read(30)
                    x[index] = (x[index] + ((packed ushr 14) and 0x3FFF)) and 0x3FFF
                    z[index] = (z[index] + (packed and 0x3FFF)) and 0x3FFF
                    level[index] = (level[index] + ((packed ushr 28) and 3)) and 3
                }
                teleported += index
            }
        }
    }

    private fun readExternal(bits: BitReader, index: Int, updates: MutableList<Int>, added: MutableSet<Int>): Boolean {
        val packed0 = regions[index]
        val level0 = (packed0 ushr 28) and 3
        val regionX0 = (packed0 ushr 14) and 0xFF
        val regionZ0 = packed0 and 0xFF
        when (bits.read(2)) {
            0 -> {
                if (bits.read(1) == 1) readExternal(bits, index, updates, added)
                val packed = regions[index]
                val localX = bits.read(13)
                val localZ = bits.read(13)
                if (bits.read(1) == 1) bits.read(16) // world view
                if (bits.read(1) == 1) updates += index
                x[index] = (((packed ushr 14) and 0xFF) shl 13) or localX
                z[index] = ((packed and 0xFF) shl 13) or localZ
                level[index] = (packed ushr 28) and 3
                active[index] = true
                added += index
                return true
            }
            1 -> {
                val newLevel = (level0 + bits.read(2)) and 3
                regions[index] = (newLevel shl 28) or (packed0 and 0x0FFFFFFF)
            }
            2 -> {
                val packed = bits.read(5)
                val direction = packed and 7
                val newLevel = (level0 + ((packed ushr 3) and 3)) and 3
                val regionX = (regionX0 + REGION_DX[direction]) and 0xFF
                val regionZ = (regionZ0 + REGION_DZ[direction]) and 0xFF
                regions[index] = (newLevel shl 28) or (regionX shl 14) or regionZ
            }
            else -> {
                val packed = bits.read(18)
                val newLevel = (level0 + ((packed ushr 16) and 3)) and 3
                val regionX = (regionX0 + ((packed ushr 8) and 0xFF)) and 0xFF
                val regionZ = (regionZ0 + (packed and 0xFF)) and 0xFF
                regions[index] = (newLevel shl 28) or (regionX shl 14) or regionZ
            }
        }
        return false
    }

    private fun readSkip(bits: BitReader): Int =
        when (bits.read(2)) {
            0 -> 0
            1 -> bits.read(5)
            2 -> bits.read(8)
            else -> bits.read(11)
        }

    private fun signed5(value: Int) = if (value > 15) value - 32 else value

    private companion object {
        const val MAX_PLAYERS = 2048

        // tsps's walk directions: 0 = south-west, then west to east along each row, north last.
        val WALK_DX = intArrayOf(-1, 0, 1, -1, 1, -1, 0, 1)
        val WALK_DZ = intArrayOf(-1, -1, -1, 0, 0, 1, 1, 1)

        // RUN_DIRECTIONS in ClientProtocol.ts.
        val RUN_DX = intArrayOf(-2, -1, 0, 1, 2, -2, 2, -2, 2, -2, 2, -2, -1, 0, 1, 2)
        val RUN_DZ = intArrayOf(-2, -2, -2, -2, -2, -1, -1, 0, 0, 1, 1, 2, 2, 2, 2, 2)

        val REGION_DX = intArrayOf(-1, 0, 1, -1, 1, -1, 0, 1)
        val REGION_DZ = intArrayOf(-1, -1, -1, 0, 0, 1, 1, 1)
    }
}
