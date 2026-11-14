package gateway.cache

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
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
         * A decoded index with [group]'s CRC and lengths replaced, everything else as it was.
         * Indexes that also list uncompressed CRCs or digests are refused: those would go stale.
         */
        fun withGroup(data: ByteArray, group: Int, crc: Int, length: Int, uncompressedLength: Int): ByteArray {
            val buffer = ByteBuffer.wrap(data.copyOf())
            val (_, _, flags, ids) = buffer.header()
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
            return buffer.array()
        }

        /**
         * A decoded index with a new one-file group [id] added in id order, everything else as it
         * was. When the index lists names the group is [nameHash] and its file 0. Indexes that list
         * uncompressed CRCs or digests are refused, as in [withGroup].
         */
        fun withNewGroup(data: ByteArray, id: Int, nameHash: Int, crc: Int, version: Int, length: Int, uncompressedLength: Int): ByteArray {
            val index = Encoded.read(data)
            require(index.flags and (FLAG_UNCOMPRESSED_CRCS or FLAG_DIGESTS) == 0) { "can't add to an index with flags ${index.flags}" }
            require(id !in index.ids) { "group $id is already in the index" }
            val at = index.ids.count { it < id }
            index.ids.add(at, id)
            index.names?.add(at, nameHash)
            index.crcs.add(at, crc)
            index.lengths?.add(at, intArrayOf(length, uncompressedLength))
            index.versions.add(at, version)
            index.files.add(at, intArrayOf(0))
            index.fileNames?.add(at, intArrayOf(0))
            return index.write()
        }

        /** An index as stored, every field kept, so [write] gives back the same bytes [read] got. */
        internal class Encoded(
            val protocol: Int,
            val version: Int,
            val flags: Int,
            val ids: MutableList<Int>,
            val names: MutableList<Int>?,
            val crcs: MutableList<Int>,
            val uncompressedCrcs: MutableList<Int>?,
            val digests: MutableList<ByteArray>?,
            val lengths: MutableList<IntArray>?,
            val versions: MutableList<Int>,
            val files: MutableList<IntArray>,
            val fileNames: MutableList<IntArray>?,
        ) {
            fun write(): ByteArray {
                val bytes = ByteArrayOutputStream()
                val out = DataOutputStream(bytes)
                out.writeByte(protocol)
                if (protocol >= 6) out.writeInt(version)
                out.writeByte(flags)
                out.smart(ids.size)
                ids.forEachIndexed { i, id -> out.smart(id - (if (i == 0) 0 else ids[i - 1])) }
                names?.forEach(out::writeInt)
                crcs.forEach(out::writeInt)
                uncompressedCrcs?.forEach(out::writeInt)
                digests?.forEach(out::write)
                lengths?.forEach { out.writeInt(it[0]); out.writeInt(it[1]) }
                versions.forEach(out::writeInt)
                files.forEach { out.smart(it.size) }
                for (groupFiles in files) groupFiles.forEachIndexed { i, file -> out.smart(file - (if (i == 0) 0 else groupFiles[i - 1])) }
                fileNames?.forEach { it.forEach(out::writeInt) }
                return bytes.toByteArray()
            }

            private fun DataOutputStream.smart(value: Int) {
                if (protocol >= 7 && value >= 0x8000) writeInt(value or Int.MIN_VALUE) else writeShort(value)
            }

            companion object {
                fun read(data: ByteArray): Encoded {
                    val buffer = ByteBuffer.wrap(data)
                    val (protocol, version, flags, ids) = buffer.header()
                    val count = ids.size
                    fun ints() = MutableList(count) { buffer.getInt() }
                    val names = if (flags and FLAG_NAMES != 0) ints() else null
                    val crcs = ints()
                    val uncompressedCrcs = if (flags and FLAG_UNCOMPRESSED_CRCS != 0) ints() else null
                    val digests = if (flags and FLAG_DIGESTS != 0) MutableList(count) { ByteArray(DIGEST_SIZE).also(buffer::get) } else null
                    val lengths = if (flags and FLAG_LENGTHS != 0) MutableList(count) { intArrayOf(buffer.getInt(), buffer.getInt()) } else null
                    val versions = ints()
                    val fileCounts = IntArray(count) { buffer.smart(protocol) }
                    val files =
                        MutableList(count) { i ->
                            var file = 0
                            IntArray(fileCounts[i]) {
                                file += buffer.smart(protocol)
                                file
                            }
                        }
                    val fileNames = if (names != null) MutableList(count) { i -> IntArray(fileCounts[i]) { buffer.getInt() } } else null
                    require(!buffer.hasRemaining()) { "${buffer.remaining()} bytes after the index" }
                    return Encoded(protocol, version, flags, ids.toMutableList(), names, crcs, uncompressedCrcs, digests, lengths, versions, files, fileNames)
                }
            }
        }

        private const val DIGEST_SIZE = 64

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
