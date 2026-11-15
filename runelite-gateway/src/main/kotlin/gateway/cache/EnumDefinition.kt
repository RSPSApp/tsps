package gateway.cache

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.Charset

/**
 * An enum file in full (config group 8): its key and value types as the cache's type bytes (the
 * client's script `enum` checks both), its default, and its entries, whose values are all ints or
 * all cp1252 strings.
 */
data class EnumDefinition(val keyType: Int, val valueType: Int, val default: Any?, val entries: Map<Int, Any>) {
    fun encode(): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(1)
        out.write(keyType)
        out.write(2)
        out.write(valueType)
        if (default is String) {
            out.write(3)
            out.writeString(default)
        } else if (default != null) {
            out.write(4)
            out.writeInt((default as Number).toInt())
        }
        if (entries.isNotEmpty()) {
            require(entries.size <= 0xFFFF) { "${entries.size} enum entries" }
            val strings = entries.values.first() is String
            require(entries.values.all { (it is String) == strings }) { "enum entries mix strings and ints" }
            out.write(if (strings) 5 else 6)
            out.write(entries.size ushr 8)
            out.write(entries.size and 0xFF)
            for ((key, value) in entries) {
                out.writeInt(key)
                if (strings) out.writeString(value as String) else out.writeInt((value as Number).toInt())
            }
        }
        out.write(0)
        return out.toByteArray()
    }

    companion object {
        private val CP1252: Charset = Charset.forName("windows-1252")

        /** A type character as the cache stores it (cp1252, e.g. 'i', 'J', 's'). */
        fun typeByte(type: Char): Int = type.toString().toByteArray(CP1252).single().toInt() and 0xFF

        fun decode(data: ByteArray): EnumDefinition {
            val buffer = ByteBuffer.wrap(data)
            var keyType = 0
            var valueType = 0
            var default: Any? = null
            val entries = LinkedHashMap<Int, Any>()
            while (true) {
                when (val opcode = buffer.get().toInt() and 0xFF) {
                    0 -> return EnumDefinition(keyType, valueType, default, entries)
                    1 -> keyType = buffer.get().toInt() and 0xFF
                    2 -> valueType = buffer.get().toInt() and 0xFF
                    3 -> default = buffer.string()
                    4 -> default = buffer.int
                    5 -> repeat(buffer.short.toInt() and 0xFFFF) { entries[buffer.int] = buffer.string() }
                    6 -> repeat(buffer.short.toInt() and 0xFFFF) { entries[buffer.int] = buffer.int }
                    else -> error("enum opcode $opcode")
                }
            }
        }

        private fun ByteBuffer.string(): String {
            val start = position()
            while (get() != 0.toByte()) continue
            return String(array(), start, position() - start - 1, CP1252)
        }

        private fun ByteArrayOutputStream.writeInt(value: Int) = write(ByteBuffer.allocate(4).putInt(value).array())

        private fun ByteArrayOutputStream.writeString(value: String) {
            write(value.toByteArray(CP1252))
            write(0)
        }
    }
}
