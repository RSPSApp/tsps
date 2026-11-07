package gateway.cache

import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

/**
 * The parts of the cache's obj types the gateway needs: an item's worn slot and the slots it
 * hides (a platebody hides the arms), which tsps's appearance block doesn't carry.
 *
 * The opcode table follows tsps's ObjType decoder for revision 241; every opcode is consumed
 * so the fields after it decode correctly.
 */
class ObjTypes(private val cache: Cache) {
    class ObjType(val wearpos: Int, val wearpos2: Int, val wearpos3: Int, val weight: Int)

    private val types = ConcurrentHashMap<Int, ObjType>()

    /** Every obj's config, split out of its group once. */
    private val files: Map<Int, ByteArray> by lazy { cache.files(CONFIG_ARCHIVE, OBJ_GROUP) }

    operator fun get(id: Int): ObjType = types.computeIfAbsent(id, ::load)

    private fun load(id: Int): ObjType {
        val data = files[id] ?: return NONE
        return try {
            decode(ByteBuffer.wrap(data))
        } catch (e: RuntimeException) {
            log.warning("obj $id: ${e.message}")
            NONE
        }
    }

    private fun decode(buffer: ByteBuffer): ObjType {
        var wearpos = -1
        var wearpos2 = -1
        var wearpos3 = -1
        var weight = 0
        while (true) {
            when (val opcode = buffer.u8()) {
                0 -> return ObjType(wearpos, wearpos2, wearpos3, weight)
                13 -> wearpos = buffer.u8()
                14 -> wearpos2 = buffer.u8()
                27 -> wearpos3 = buffer.u8()
                75 -> weight = buffer.short.toInt()
                11, 15, 16, 65, 160, 251 -> Unit
                2, 3, 9, in 30..39 -> buffer.string()
                1, 4, 5, 6, 7, 8, 10, 24, 26, 66, 67, 68, 70, 71, 72, 76, 77, 78, 79, in 80..87, in 90..95, 97, 98, 99,
                in 110..112, in 116..119, 121, 122, 139, 140, in 142..146, 148, 149, in 150..154,
                -> buffer.skip(2)
                23, 25 -> buffer.skip(3)
                12, 44, 46, 47, in 49..54 -> buffer.skip(4)
                45, 48 -> buffer.skip(5)
                42, 69, 74, 88, 96, 113, 114, 115 -> buffer.skip(1)
                125, 126 -> buffer.skip(3)
                in 127..130 -> buffer.skip(3)
                40, 41 -> buffer.skip(buffer.u8() * 4)
                43 -> {
                    buffer.u8()
                    while (buffer.u8() != 0) buffer.string()
                }
                in 100..109 -> buffer.skip(4)
                132 -> buffer.skip(buffer.u8() * 2)
                161 -> buffer.skip(buffer.u16() * 2)
                200 -> {
                    buffer.skip(2)
                    buffer.string()
                }
                201 -> {
                    buffer.skip(1 + 2 + 2 + 4 + 4)
                    buffer.string()
                }
                202 -> {
                    buffer.skip(1 + 2 + 2 + 2 + 4 + 4)
                    buffer.string()
                }
                249 -> repeat(buffer.u8()) {
                    val isString = buffer.u8() == 1
                    buffer.skip(3)
                    if (isString) buffer.string() else buffer.skip(4)
                }
                else -> error("unknown opcode $opcode")
            }
        }
    }

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val OBJ_GROUP = 10
        val NONE = ObjType(-1, -1, -1, 0)
        val log: Logger = Logger.getLogger(ObjTypes::class.java.name)

        fun ByteBuffer.u8() = get().toInt() and 0xFF

        fun ByteBuffer.u16() = short.toInt() and 0xFFFF

        fun ByteBuffer.skip(count: Int) {
            position(position() + count)
        }

        fun ByteBuffer.string() {
            while (get() != 0.toByte()) continue
        }
    }
}
