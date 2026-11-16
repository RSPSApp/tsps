package gateway.cache

import java.io.ByteArrayOutputStream
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
        /** The container's length and its data's, when the index lists lengths. */
        val length: Int? = null,
        val uncompressedLength: Int? = null,
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
            val (protocol, version, flags, ids) = buffer.header()
            val count = ids.size
            val names = if (flags and FLAG_NAMES != 0) IntArray(count) { buffer.getInt() } else null
            val crcs = IntArray(count) { buffer.getInt() }
            if (flags and FLAG_UNCOMPRESSED_CRCS != 0) repeat(count) { buffer.getInt() }
            if (flags and FLAG_DIGESTS != 0) repeat(count) { buffer.position(buffer.position() + 64) }
            val lengths = if (flags and FLAG_LENGTHS != 0) Array(count) { intArrayOf(buffer.getInt(), buffer.getInt()) } else null
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
                groups[ids[i]] = Group(ids[i], names?.get(i), crcs[i], versions[i], files[i], lengths?.get(i)?.get(0), lengths?.get(i)?.get(1))
            }
            return ReferenceTable(version, groups)
        }

        /**
         * A decoded index with [group]'s CRC and lengths replaced, and its file ids when [files] is
         * given, everything else as it was. Indexes that also list uncompressed CRCs or digests are
         * refused: those would go stale. So are new file ids in an index with names, which would
         * need a name hash each.
         */
        fun withGroup(data: ByteArray, group: Int, crc: Int, length: Int, uncompressedLength: Int, files: IntArray? = null): ByteArray {
            val buffer = ByteBuffer.wrap(data.copyOf())
            val (protocol, _, flags, ids) = buffer.header()
            require(flags and (FLAG_UNCOMPRESSED_CRCS or FLAG_DIGESTS) == 0) { "can't patch an index with flags $flags" }
            val index = ids.indexOf(group)
            require(index >= 0) { "no group $group in the index" }
            if (flags and FLAG_NAMES != 0) buffer.position(buffer.position() + ids.size * 4)
            val crcs = buffer.position()
            buffer.putInt(crcs + index * 4, crc)
            if (flags and FLAG_LENGTHS != 0) {
                val lengths = crcs + ids.size * 4 + index * 8
                buffer.putInt(lengths, length).putInt(lengths + 4, uncompressedLength)
            }
            if (files == null) return buffer.array()
            require(flags and FLAG_NAMES == 0) { "can't change the files of an index with names" }
            require(files.isNotEmpty() && (1 until files.size).all { files[it - 1] < files[it] }) { "file ids must ascend" }
            // Past the CRCs, lengths and versions: every group's file count, then every group's file ids.
            buffer.position(crcs + ids.size * (if (flags and FLAG_LENGTHS != 0) 16 else 8))
            val counts = IntArray(ids.size)
            var count = IntRange.EMPTY
            for (i in ids.indices) {
                val start = buffer.position()
                counts[i] = buffer.smart(protocol)
                if (i == index) count = start until buffer.position()
            }
            var run = IntRange.EMPTY
            for (i in ids.indices) {
                val start = buffer.position()
                repeat(counts[i]) { buffer.smart(protocol) }
                if (i == index) run = start until buffer.position()
            }
            val patched = buffer.array()
            val out = ByteArrayOutputStream(patched.size + files.size * 4)
            out.write(patched, 0, count.first)
            out.write(smartBytes(protocol, files.size))
            out.write(patched, count.last + 1, run.first - count.last - 1)
            var previous = 0
            for (file in files) {
                out.write(smartBytes(protocol, file - previous))
                previous = file
            }
            out.write(patched, run.last + 1, patched.size - run.last - 1)
            return out.toByteArray()
        }

        /** [value] as [smart] reads it back: two bytes, or from protocol 7 four with the top bit set. */
        private fun smartBytes(protocol: Int, value: Int): ByteArray =
            when {
                value < 0 -> error("negative smart $value")
                value < 0x8000 || (protocol < 7 && value <= 0xFFFF) -> ByteBuffer.allocate(2).putShort(value.toShort()).array()
                protocol >= 7 -> ByteBuffer.allocate(4).putInt(value or Int.MIN_VALUE).array()
                else -> error("$value needs reference table protocol 7")
            }

        private data class Header(val protocol: Int, val version: Int, val flags: Int, val ids: IntArray)

        /** Protocol, version, flags and group ids: everything before the name hashes. */
        private fun ByteBuffer.header(): Header {
            val protocol = u8()
            require(protocol in 5..7) { "unsupported reference table protocol $protocol" }
            val version = if (protocol >= 6) getInt() else 0
            val flags = u8()
            val ids = IntArray(smart(protocol))
            var id = 0
            for (i in ids.indices) {
                id += smart(protocol)
                ids[i] = id
            }
            return Header(protocol, version, flags, ids)
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
