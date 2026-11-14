package gateway.cache

import java.nio.ByteBuffer

/** Varbit definitions and the varp count, from the config archive. */
class VarTypes(cache: Cache) {
    class Varbit(val varp: Int, val lsb: Int, val msb: Int) {
        val mask: Int get() = if (msb - lsb >= 31) -1 else (1 shl (msb - lsb + 1)) - 1
    }

    /** Varps the client has room for; tsps uses ids past it for its own state. */
    val varpCount: Int = cache.table(CONFIG_ARCHIVE).groups[VARP_GROUP]?.files?.let { it.last() + 1 } ?: 0

    private val varbits: Map<Int, Varbit> =
        cache.files(CONFIG_ARCHIVE, VARBIT_GROUP).mapValues { (_, data) ->
            val buffer = ByteBuffer.wrap(data)
            var varbit = Varbit(-1, 0, 0)
            while (true) {
                when (buffer.get().toInt() and 0xFF) {
                    0 -> break
                    1 -> varbit = Varbit(buffer.short.toInt() and 0xFFFF, buffer.get().toInt() and 0xFF, buffer.get().toInt() and 0xFF)
                    else -> break
                }
            }
            varbit
        }

    fun varbit(id: Int): Varbit? = varbits[id]?.takeIf { it.varp >= 0 }

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val VARP_GROUP = 16
        const val VARBIT_GROUP = 14
    }
}

/** Integer-valued enums (key → int) from the config archive. */
class EnumTypes(private val cache: Cache) {
    private val files: Map<Int, ByteArray> by lazy { cache.files(CONFIG_ARCHIVE, ENUM_GROUP) }
    private val decoded = HashMap<Int, Map<Int, Int>>()

    @Synchronized
    operator fun get(id: Int): Map<Int, Int> = decoded.getOrPut(id) { decode(files[id] ?: return@getOrPut emptyMap()) }

    companion object {
        const val CONFIG_ARCHIVE = 2
        const val ENUM_GROUP = 8

        /** An enum file's int values (opcode 6), keyed by key. */
        fun decode(data: ByteArray): Map<Int, Int> {
            val buffer = ByteBuffer.wrap(data)
            val values = LinkedHashMap<Int, Int>()
            forEachIntValue(buffer) { key, at -> values[key] = buffer.getInt(at) }
            return values
        }

        /** An enum file with every int value set to [value]; its keys, default and the rest stay. */
        fun withIntValues(data: ByteArray, value: Int): ByteArray {
            val buffer = ByteBuffer.wrap(data.copyOf())
            forEachIntValue(buffer) { _, at -> buffer.putInt(at, value) }
            return buffer.array()
        }

        /** Walks an enum file, calling [entry] with each int value's key and position. */
        private fun forEachIntValue(buffer: ByteBuffer, entry: (key: Int, at: Int) -> Unit) {
            while (true) {
                when (val opcode = buffer.get().toInt() and 0xFF) {
                    0 -> return
                    1, 2 -> buffer.get()
                    3 -> while (buffer.get() != 0.toByte()) continue
                    4 -> buffer.int
                    5 -> repeat(buffer.short.toInt() and 0xFFFF) {
                        buffer.int
                        while (buffer.get() != 0.toByte()) continue
                    }
                    6 -> repeat(buffer.short.toInt() and 0xFFFF) {
                        entry(buffer.int, buffer.position())
                        buffer.int
                    }
                    else -> error("enum opcode $opcode")
                }
            }
        }
    }
}
