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
        return GroupFiles.split(data, entry.files)
    }

    fun file(archive: Int, group: Int, file: Int = 0): ByteArray? = files(archive, group)[file]

    fun file(archive: Int, group: String): ByteArray? {
        val entry = table(archive).group(group) ?: return null
        return file(archive, entry.id, entry.files.first())
    }

    /**
     * Group 255:255: the CRC and version of every archive's index, eight bytes each, in an
     * uncompressed container. Archives without an index (16, 23 in 241) are zeroed. [index]
     * gives each archive's index container, the stored one unless a caller has patched it.
     */
    fun masterIndex(index: (archive: Int) -> ByteArray? = { container(DiskStore.MASTER_ARCHIVE, it) }): ByteArray {
        val count = store.groupCount(DiskStore.MASTER_ARCHIVE)
        val payload = ByteBuffer.allocate(count * 8)
        for (archive in 0 until count) {
            val container = index(archive)
            if (container == null) {
                payload.putInt(0).putInt(0)
                continue
            }
            val crc = CRC32().apply { update(container) }.value.toInt()
            payload.putInt(crc).putInt(table(archive).version)
        }
        val body = payload.array()
        return ByteBuffer.allocate(5 + body.size).put(0).putInt(body.size).put(body).array()
    }

    companion object {
        fun open(directory: Path) = Cache(DiskStore.open(directory))
    }
}
