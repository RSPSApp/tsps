package gateway.cache

import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption.READ

/**
 * Read-only view of a Jagex `main_file_cache.dat2` + `.idxN` disk store.
 *
 * Groups come back exactly as stored: a JS5 container, followed by the 2-byte version trailer
 * for every archive except 255.
 */
class DiskStore private constructor(
    private val data: MappedByteBuffer,
    private val indexes: Map<Int, ByteBuffer>,
) : Closeable {
    /** Archive ids that have an index file, in ascending order. */
    val archives: List<Int> = indexes.keys.filter { it != MASTER_ARCHIVE }.sorted()

    fun groupCount(archive: Int): Int = (indexes[archive]?.capacity() ?: 0) / INDEX_ENTRY_SIZE

    fun read(archive: Int, group: Int): ByteArray? {
        val index = indexes[archive] ?: return null
        val entry = group * INDEX_ENTRY_SIZE
        if (group < 0 || entry + INDEX_ENTRY_SIZE > index.capacity()) return null
        val size = index.u24(entry)
        var sector = index.u24(entry + 3)
        if (size == 0 || sector == 0) return null

        val extended = group > 0xFFFF
        val header = if (extended) 10 else 8
        val chunkSize = SECTOR_SIZE - header
        val out = ByteArray(size)
        var written = 0
        var chunk = 0
        while (written < size) {
            val position = sector.toLong() * SECTOR_SIZE
            val length = minOf(chunkSize, size - written)
            // The last sector of the file isn't padded to a full 520 bytes.
            require(position + header + length <= data.capacity()) { "sector $sector out of range for $archive:$group" }
            val base = position.toInt()
            val sectorGroup = if (extended) data.getInt(base) else data.u16(base)
            val offset = if (extended) 4 else 2
            val sectorChunk = data.u16(base + offset)
            val next = data.u24(base + offset + 2)
            val sectorArchive = data.get(base + offset + 5).toInt() and 0xFF
            require(sectorGroup == group && sectorChunk == chunk && sectorArchive == archive) {
                "corrupt sector chain for $archive:$group at chunk $chunk"
            }
            data.get(base + header, out, written, length)
            written += length
            sector = next
            chunk++
        }
        return out
    }

    override fun close() = Unit

    companion object {
        const val MASTER_ARCHIVE = 255
        private const val INDEX_ENTRY_SIZE = 6
        private const val SECTOR_SIZE = 520

        fun open(directory: Path): DiskStore {
            val data = map(directory.resolve("main_file_cache.dat2"))
            val indexes = sortedMapOf<Int, ByteBuffer>()
            for (archive in 0..MASTER_ARCHIVE) {
                val file = directory.resolve("main_file_cache.idx$archive")
                if (Files.exists(file)) indexes[archive] = map(file)
            }
            require(MASTER_ARCHIVE in indexes) { "no main_file_cache.idx255 in $directory" }
            return DiskStore(data, indexes)
        }

        private fun map(file: Path): MappedByteBuffer =
            FileChannel.open(file, READ).use { it.map(FileChannel.MapMode.READ_ONLY, 0, it.size()) }

        private fun ByteBuffer.u16(at: Int) = ((get(at).toInt() and 0xFF) shl 8) or (get(at + 1).toInt() and 0xFF)

        private fun ByteBuffer.u24(at: Int) = ((get(at).toInt() and 0xFF) shl 16) or u16(at + 1)
    }
}
