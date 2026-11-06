package gateway.down

/** MSB-first bit reader over tsps sync bit streams. */
class BitReader(private val data: ByteArray, byteOffset: Int) {
    private var position = byteOffset * 8

    fun read(count: Int): Int {
        var value = 0
        repeat(count) {
            val bit = (data[position ushr 3].toInt() ushr (7 - (position and 7))) and 1
            value = (value shl 1) or bit
            position++
        }
        return value
    }

    fun alignToByte() {
        position = (position + 7) and 7.inv()
    }

    val byteOffset: Int get() = (position + 7) ushr 3
}
