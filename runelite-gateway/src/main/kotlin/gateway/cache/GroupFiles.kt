package gateway.cache

import java.nio.ByteBuffer

/**
 * A multi-file group's decompressed data: the files cut into stripes, then a trailer with each
 * stripe's file lengths (each relative to the previous file's in that stripe) and a u8 stripe count.
 */
object GroupFiles {
    fun split(data: ByteArray, fileIds: IntArray): Map<Int, ByteArray> {
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

    /** [files], in file id order, as one stripe: what [split] reads back. */
    fun join(files: List<ByteArray>): ByteArray {
        if (files.size == 1) return files[0]
        val out = ByteBuffer.allocate(files.sumOf { it.size } + files.size * 4 + 1)
        files.forEach(out::put)
        var previous = 0
        for (file in files) {
            out.putInt(file.size - previous)
            previous = file.size
        }
        return out.put(1).array()
    }
}
