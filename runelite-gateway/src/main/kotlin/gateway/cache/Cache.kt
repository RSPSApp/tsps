package gateway.cache

import java.nio.ByteBuffer
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.CRC32

/** Decoded access to the cache tsps runs on, plus the raw containers JS5 serves. */
class Cache(val store: DiskStore) {
    private val tables = ConcurrentHashMap<Int, ReferenceTable>()

    fun table(archive: Int): ReferenceTable =
        tables.computeIfAbsent(archive) {
            val raw = requireNotNull(store.read(DiskStore.MASTER_ARCHIVE, archive)) { "no index for archive $archive" }
            ReferenceTable.decode(Container.decompress(raw))
        }

    /** The container JS5 sends for [archive]:[group], version trailer removed. */
    fun container(archive: Int, group: Int): ByteArray? = store.read(archive, group)?.let(Container::stripVersion)

    /** Every file of a group, keyed by file id. */
    fun files(archive: Int, group: Int): Map<Int, ByteArray> {
        val entry = requireNotNull(table(archive).groups[group]) { "no group $archive:$group" }
        val data = Container.decompress(requireNotNull(container(archive, group)) { "missing group $archive:$group" })
        return split(data, entry.files)
    }

    fun file(archive: Int, group: Int, file: Int = 0): ByteArray? = files(archive, group)[file]

    fun file(archive: Int, group: String): ByteArray? {
        val entry = table(archive).group(group) ?: return null
        return file(archive, entry.id, entry.files.first())
    }

    /**
     * Group 255:255: the CRC and version of every archive's index, eight bytes each, in an
     * uncompressed container. Archives without an index (16, 23 in 241) are zeroed.
     */
    fun masterIndex(): ByteArray {
        val count = store.groupCount(DiskStore.MASTER_ARCHIVE)
        val payload = ByteBuffer.allocate(count * 8)
        for (archive in 0 until count) {
            val raw = store.read(DiskStore.MASTER_ARCHIVE, archive)
            if (raw == null) {
                payload.putInt(0).putInt(0)
                continue
            }
            val crc = CRC32().apply { update(Container.stripVersion(raw)) }.value.toInt()
            payload.putInt(crc).putInt(table(archive).version)
        }
        val body = payload.array()
        return ByteBuffer.allocate(5 + body.size).put(0).putInt(body.size).put(body).array()
    }

    companion object {
        fun open(directory: Path) = Cache(DiskStore.open(directory))

        private fun split(data: ByteArray, fileIds: IntArray): Map<Int, ByteArray> {
            if (fileIds.size == 1) return mapOf(fileIds[0] to data)
            val count = fileIds.size
            val stripes = data.last().toInt() and 0xFF
            val trailer = ByteBuffer.wrap(data, data.size - 1 - stripes * count * 4, stripes * count * 4)
            val sizes = IntArray(count)
            val lengths = Array(stripes) { IntArray(count) }
            for (stripe in 0 until stripes) {
                var size = 0
                for (file in 0 until count) {
                    size += trailer.getInt()
                    lengths[stripe][file] = size
                    sizes[file] += size
                }
            }
            val out = Array(count) { ByteArray(sizes[it]) }
            val written = IntArray(count)
            var offset = 0
            for (stripe in 0 until stripes) {
                for (file in 0 until count) {
                    val length = lengths[stripe][file]
                    System.arraycopy(data, offset, out[file], written[file], length)
                    written[file] += length
                    offset += length
                }
            }
            return fileIds.indices.associate { fileIds[it] to out[it] }
        }
    }
}
