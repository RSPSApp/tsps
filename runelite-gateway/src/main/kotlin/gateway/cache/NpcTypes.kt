package gateway.cache

import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

/**
 * An NPC type's body models, for model customisation: tsps sends per-slot overrides and the
 * OSRS block carries the whole list.
 *
 * The opcode table follows the browser client's NpcType decoder for old school revision 241;
 * every opcode is consumed, since the models (opcode 1, or 61 with int ids) can come anywhere.
 */
class NpcTypes(private val cache: Cache) {
    private val models = ConcurrentHashMap<Int, List<Int>>()

    /** Every NPC's config, split out of its group once. */
    private val files: Map<Int, ByteArray> by lazy { cache.files(CONFIG_ARCHIVE, NPC_GROUP) }

    /** The ids that have a config. */
    val ids: Set<Int> get() = files.keys

    /** The type's body models; empty when it has none or its config can't be read. */
    fun models(id: Int): List<Int> = models.computeIfAbsent(id, ::load)

    private fun load(id: Int): List<Int> {
        val data = files[id] ?: return emptyList()
        return try {
            decode(ByteBuffer.wrap(data))
        } catch (e: RuntimeException) {
            log.warning("npc $id: ${e.message}")
            emptyList()
        }
    }

    /** [id]'s models, throwing when its config doesn't decode to its last byte. */
    internal fun decodeStrict(id: Int): List<Int> = decode(ByteBuffer.wrap(files.getValue(id)))

    /** Reads the whole config, so a bad table shows up as an error rather than wrong models. */
    private fun decode(buffer: ByteBuffer): List<Int> {
        var models = emptyList<Int>()
        while (true) {
            when (val opcode = buffer.u8()) {
                0 -> {
                    check(!buffer.hasRemaining()) { "${buffer.remaining()} bytes after the end" }
                    return models
                }
                1 -> models = List(buffer.u8()) { buffer.u16() }
                61 -> models = List(buffer.u8()) { buffer.int }
                2, 3 -> buffer.string()
                12, 128, 140, 163, 165, 168 -> buffer.skip(1)
                13, 14, 15, 16, 18, 42, 44, 45, 74, 75, 76, 77, 78, 79, 95, 97, 98, 103, 114, 116, 124, 126, 127, 137,
                138, 139, 142, 144, 146,
                -> buffer.skip(2)
                in 170..175 -> buffer.skip(2)
                17, 115, 117, 134 -> buffer.skip(8)
                in 30..34, in 150..154 -> buffer.string()
                40, 41 -> buffer.skip(buffer.u8() * 4)
                60 -> buffer.skip(buffer.u8() * 2)
                62 -> buffer.skip(buffer.u8() * 4)
                93, 99, 107, 109, 111, 112, 122, 123, 130, 141, 143, 145, 147, 158, 159, 161, 162 -> Unit
                100, 101, 119, 125 -> buffer.skip(1)
                102 -> {
                    var mask = buffer.u8()
                    while (mask != 0) {
                        if (mask and 1 != 0) {
                            buffer.bigSmart()
                            buffer.smartMin1()
                        }
                        mask = mask ushr 1
                    }
                }
                106, 118 -> {
                    buffer.skip(if (opcode == 118) 6 else 4)
                    buffer.skip((buffer.u8() + 1) * 2)
                }
                113 -> buffer.skip(4)
                121 -> buffer.skip(buffer.u8() * 4)
                135, 136 -> buffer.skip(3)
                155 -> buffer.skip(4)
                160 -> buffer.skip(buffer.u8() * 2)
                164 -> buffer.skip(4)
                249 ->
                    repeat(buffer.u8()) {
                        val isString = buffer.u8() == 1
                        buffer.skip(3)
                        if (isString) buffer.string() else buffer.skip(4)
                    }
                251 -> {
                    buffer.skip(2)
                    buffer.string()
                }
                252 -> {
                    buffer.skip(1 + 2 + 2 + 4 + 4)
                    buffer.string()
                }
                253 -> {
                    buffer.skip(1 + 2 + 2 + 2 + 4 + 4)
                    buffer.string()
                }
                else -> error("unknown opcode $opcode")
            }
        }
    }

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val NPC_GROUP = 9
        val log: Logger = Logger.getLogger(NpcTypes::class.java.name)

        fun ByteBuffer.u8() = get().toInt() and 0xFF

        fun ByteBuffer.u16() = short.toInt() and 0xFFFF

        fun ByteBuffer.skip(count: Int) {
            position(position() + count)
        }

        fun ByteBuffer.string() {
            while (get().toInt() != 0) continue
        }

        fun ByteBuffer.bigSmart(): Int = if (get(position()) < 0) int and Int.MAX_VALUE else u16()

        fun ByteBuffer.smartMin1(): Int = if ((get(position()).toInt() and 0xFF) < 128) u8() - 1 else u16() - 0x8001
    }
}
