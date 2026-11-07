package gateway.cache

import java.nio.ByteBuffer

/** An archive's index (group 255:archive): group ids, name hashes, CRCs, versions and file ids. */
class ReferenceTable(
    val version: Int,
    val groups: Map<Int, Group>,
) {
    class Group(
        val id: Int,
        val nameHash: Int?,
        val crc: Int,
        val version: Int,
        val files: IntArray,
    )

    private val byName: Map<Int, Group> by lazy { groups.values.filter { it.nameHash != null }.associateBy { it.nameHash!! } }

    fun group(name: String): Group? = byName[djb2(name)]

    companion object {
        private const val FLAG_NAMES = 0x1
        private const val FLAG_DIGESTS = 0x2
        private const val FLAG_LENGTHS = 0x4
        private const val FLAG_UNCOMPRESSED_CRCS = 0x8

        fun decode(data: ByteArray): ReferenceTable {
            val buffer = ByteBuffer.wrap(data)
            val protocol = buffer.u8()
            require(protocol in 5..7) { "unsupported reference table protocol $protocol" }
            val version = if (protocol >= 6) buffer.getInt() else 0
            val flags = buffer.u8()
            val count = buffer.smart(protocol)
            val ids = IntArray(count)
            var id = 0
            for (i in 0 until count) {
                id += buffer.smart(protocol)
                ids[i] = id
            }
            val names = if (flags and FLAG_NAMES != 0) IntArray(count) { buffer.getInt() } else null
            val crcs = IntArray(count) { buffer.getInt() }
            if (flags and FLAG_UNCOMPRESSED_CRCS != 0) repeat(count) { buffer.getInt() }
            if (flags and FLAG_DIGESTS != 0) repeat(count) { buffer.position(buffer.position() + 64) }
            if (flags and FLAG_LENGTHS != 0) repeat(count) { buffer.getInt(); buffer.getInt() }
            val versions = IntArray(count) { buffer.getInt() }
            val fileCounts = IntArray(count) { buffer.smart(protocol) }
            val files =
                Array(count) { i ->
                    var file = 0
                    IntArray(fileCounts[i]) {
                        file += buffer.smart(protocol)
                        file
                    }
                }
            if (names != null) {
                for (i in 0 until count) repeat(fileCounts[i]) { buffer.getInt() }
            }
            val groups = LinkedHashMap<Int, Group>(count)
            for (i in 0 until count) {
                groups[ids[i]] = Group(ids[i], names?.get(i), crcs[i], versions[i], files[i])
            }
            return ReferenceTable(version, groups)
        }

        fun djb2(name: String): Int = name.lowercase().fold(0) { hash, c -> 31 * hash + c.code }

        private fun ByteBuffer.u8() = get().toInt() and 0xFF

        private fun ByteBuffer.smart(protocol: Int): Int =
            if (protocol >= 7) {
                if (get(position()) < 0) getInt() and 0x7FFFFFFF else getShort().toInt() and 0xFFFF
            } else {
                getShort().toInt() and 0xFFFF
            }
    }
}
