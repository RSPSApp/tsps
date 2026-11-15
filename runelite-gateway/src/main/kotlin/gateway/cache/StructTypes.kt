package gateway.cache

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.Charset

/** Structs (config group 34): a map of param id to an int or a cp1252 string; and whether a param (group 11) holds strings. */
object StructTypes {
    const val STRUCT_GROUP = 34
    const val PARAM_GROUP = 11

    private val CP1252: Charset = Charset.forName("windows-1252")
    private const val PARAMS = 249
    private const val STRING_TYPE = 's'.code
    private const val STRING_TYPE_ID = 36

    fun decode(data: ByteArray): Map<Int, Any> {
        val buffer = ByteBuffer.wrap(data)
        val params = LinkedHashMap<Int, Any>()
        while (true) {
            when (val opcode = buffer.get().toInt() and 0xFF) {
                0 -> return params
                PARAMS -> repeat(buffer.get().toInt() and 0xFF) {
                    val string = buffer.get().toInt() == 1
                    val key = ((buffer.get().toInt() and 0xFF) shl 16) or (buffer.short.toInt() and 0xFFFF)
                    params[key] = if (string) buffer.string() else buffer.int
                }
                else -> error("struct opcode $opcode")
            }
        }
    }

    fun encode(params: Map<Int, Any>): ByteArray {
        val out = ByteArrayOutputStream()
        if (params.isNotEmpty()) {
            require(params.size <= 0xFF) { "${params.size} struct params" }
            out.write(PARAMS)
            out.write(params.size)
            for ((key, value) in params) {
                require(key in 0..0xFFFFFF) { "param $key" }
                out.write(if (value is String) 1 else 0)
                out.write(byteArrayOf((key ushr 16).toByte(), (key ushr 8).toByte(), key.toByte()))
                if (value is String) {
                    out.write(value.toByteArray(CP1252))
                    out.write(0)
                } else {
                    out.write(ByteBuffer.allocate(4).putInt((value as Number).toInt()).array())
                }
            }
        }
        out.write(0)
        return out.toByteArray()
    }

    /** Whether a param definition's type is string: opcode 1's type character, or opcode 8's type id. */
    fun isStringParam(data: ByteArray): Boolean {
        val buffer = ByteBuffer.wrap(data)
        var string = false
        while (true) {
            when (val opcode = buffer.get().toInt() and 0xFF) {
                0 -> return string
                1 -> string = (buffer.get().toInt() and 0xFF) == STRING_TYPE
                2 -> buffer.int
                4 -> Unit
                5 -> while (buffer.get() != 0.toByte()) continue
                7 -> buffer.long
                8 -> string = (buffer.get().toInt() and 0xFF) == STRING_TYPE_ID
                else -> error("param opcode $opcode")
            }
        }
    }

    private fun ByteBuffer.string(): String {
        val start = position()
        while (get() != 0.toByte()) continue
        return String(array(), start, position() - start - 1, CP1252)
    }
}
