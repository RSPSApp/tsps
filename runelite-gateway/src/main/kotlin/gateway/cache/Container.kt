package gateway.cache

import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.ByteArrayInputStream
import java.io.SequenceInputStream
import java.nio.ByteBuffer
import java.util.zip.GZIPInputStream

/** JS5 container: `u8 compression, i32 length, [i32 uncompressed length], payload`. */
object Container {
    private const val NONE = 0
    private const val BZIP2 = 1
    private const val GZIP = 2
    private val BZIP2_MAGIC = "BZh1".toByteArray()

    /** Length of the container itself, without any version trailer the disk store adds. */
    fun length(container: ByteArray): Int {
        val buffer = ByteBuffer.wrap(container)
        val compression = buffer.get().toInt() and 0xFF
        val length = buffer.getInt()
        return 5 + length + if (compression == NONE) 0 else 4
    }

    /** The container with the disk store's version trailer removed, as JS5 serves it. */
    fun stripVersion(group: ByteArray): ByteArray {
        val length = length(group)
        return if (length == group.size) group else group.copyOf(length)
    }

    /** The version trailer of a stored group, or -1 if it has none. */
    fun version(group: ByteArray): Int {
        val length = length(group)
        if (group.size < length + 2) return -1
        return ((group[length].toInt() and 0xFF) shl 8) or (group[length + 1].toInt() and 0xFF)
    }

    fun decompress(container: ByteArray): ByteArray {
        val buffer = ByteBuffer.wrap(container)
        val compression = buffer.get().toInt() and 0xFF
        val length = buffer.getInt()
        if (compression == NONE) return container.copyOfRange(5, 5 + length)
        val uncompressed = buffer.getInt()
        val payload = ByteArrayInputStream(container, 9, length)
        val stream =
            when (compression) {
                // Jagex strips the bzip2 header; put it back.
                BZIP2 -> BZip2CompressorInputStream(SequenceInputStream(ByteArrayInputStream(BZIP2_MAGIC), payload))
                GZIP -> GZIPInputStream(payload)
                else -> error("unknown container compression $compression")
            }
        val out = stream.use { it.readNBytes(uncompressed) }
        check(out.size == uncompressed) { "container decompressed to ${out.size}, expected $uncompressed" }
        return out
    }
}
