package gateway.cache

import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer

/**
 * The cache's sprite group format (archive 8), one frame: palette indices, row by row, then the
 * palette and the frame sizes at the end of the file. Index 0 is transparent and the palette has
 * at most 255 colours, so an image with more is reduced to 255 by median cut.
 */
object Sprites {
    private const val MAX_COLOURS = 255
    private const val OPAQUE_ALPHA = 0x80

    /** [image] as a one-frame sprite group file. Pixels under half opacity are transparent. */
    fun encode(image: BufferedImage): ByteArray {
        val width = image.width
        val height = image.height
        val argb = image.getRGB(0, 0, width, height, null, 0, width)
        val palette = Palette.of(argb.filter { opaque(it) }.map { it and 0xFFFFFF })
        val bytes = ByteArrayOutputStream()
        val out = DataOutputStream(bytes)
        out.writeByte(0) // row by row, no alpha channel
        for (pixel in argb) out.writeByte(if (opaque(pixel)) palette.index(pixel and 0xFFFFFF) else 0)
        // Black is the client's transparent colour, so the darkest palette entry it can draw is 1.
        for (colour in palette.colours) {
            val rgb = if (colour == 0) 1 else colour
            out.writeByte(rgb ushr 16)
            out.writeByte(rgb ushr 8)
            out.writeByte(rgb)
        }
        out.writeShort(width)
        out.writeShort(height)
        out.writeByte(palette.colours.size)
        out.writeShort(0) // x offset
        out.writeShort(0) // y offset
        out.writeShort(width)
        out.writeShort(height)
        out.writeShort(1) // frames
        return bytes.toByteArray()
    }

    /** The first frame of a sprite group file: width, height and ARGB pixels, transparent as 0. */
    fun decode(data: ByteArray): Triple<Int, Int, IntArray> {
        val buffer = ByteBuffer.wrap(data)
        val frames = buffer.getShort(data.size - 2).toInt() and 0xFFFF
        val header = data.size - 7 - frames * 8
        val colours = (data[header + 4].toInt() and 0xFF)
        val width = buffer.getShort(header + 5 + frames * 4).toInt() and 0xFFFF
        val height = buffer.getShort(header + 5 + frames * 6).toInt() and 0xFFFF
        val palette = IntArray(colours + 1)
        val paletteStart = header - colours * 3
        for (i in 1..colours) {
            val at = paletteStart + (i - 1) * 3
            palette[i] = ((data[at].toInt() and 0xFF) shl 16) or ((data[at + 1].toInt() and 0xFF) shl 8) or (data[at + 2].toInt() and 0xFF)
        }
        val flags = data[0].toInt()
        val size = width * height
        // Pixels are row by row, or column by column with FLAG_VERTICAL; FLAG_ALPHA adds an alpha per pixel.
        val order = IntArray(size) { if (flags and FLAG_VERTICAL == 0) it else (it % height) * width + it / height }
        val pixels = IntArray(size)
        for (i in 0 until size) {
            val index = data[1 + i].toInt() and 0xFF
            if (index != 0) pixels[order[i]] = 0xFF000000.toInt() or palette[index]
        }
        if (flags and FLAG_ALPHA != 0) {
            for (i in 0 until size) pixels[order[i]] = (pixels[order[i]] and 0xFFFFFF) or ((data[1 + size + i].toInt() and 0xFF) shl 24)
        }
        return Triple(width, height, pixels)
    }

    private const val FLAG_VERTICAL = 0x1
    private const val FLAG_ALPHA = 0x2

    private fun opaque(argb: Int) = (argb ushr 24) >= OPAQUE_ALPHA

    /** Up to [MAX_COLOURS] colours for a set of RGB pixels, and the nearest one for each. */
    private class Palette(val colours: List<Int>) {
        private val nearest = HashMap<Int, Int>()

        /** The palette index (1-based: 0 is transparent) closest to [rgb]. */
        fun index(rgb: Int): Int =
            nearest.getOrPut(rgb) { 1 + colours.indices.minBy { distance(colours[it], rgb) } }

        companion object {
            fun of(pixels: List<Int>): Palette {
                val counts = pixels.groupingBy { it }.eachCount()
                if (counts.size <= MAX_COLOURS) return Palette(counts.keys.toList())
                val boxes = mutableListOf(Box(counts.entries.map { it.key to it.value }))
                while (boxes.size < MAX_COLOURS) {
                    val widest = boxes.filter { it.colours.size > 1 }.maxByOrNull { it.range() * it.count } ?: break
                    boxes.remove(widest)
                    boxes.addAll(widest.split())
                }
                return Palette(boxes.map { it.average() })
            }

            private fun distance(a: Int, b: Int): Int {
                val r = channel(a, 16) - channel(b, 16)
                val g = channel(a, 8) - channel(b, 8)
                val bl = channel(a, 0) - channel(b, 0)
                return r * r + g * g + bl * bl
            }

            private fun channel(rgb: Int, shift: Int) = (rgb ushr shift) and 0xFF
        }

        /** Median cut: colours with their pixel counts, split across the channel that varies most. */
        private class Box(val colours: List<Pair<Int, Int>>) {
            val count = colours.sumOf { it.second }.toLong()

            private fun spread(shift: Int): Int = colours.maxOf { channel(it.first, shift) } - colours.minOf { channel(it.first, shift) }

            private fun widestShift(): Int = listOf(16, 8, 0).maxBy(::spread)

            fun range(): Int = spread(widestShift())

            fun split(): List<Box> {
                val shift = widestShift()
                val sorted = colours.sortedBy { channel(it.first, shift) }
                var seen = 0L
                val median = sorted.indexOfFirst { seen += it.second; seen * 2 >= count }.coerceIn(0, sorted.size - 2)
                return listOf(Box(sorted.subList(0, median + 1)), Box(sorted.subList(median + 1, sorted.size)))
            }

            fun average(): Int {
                var r = 0L
                var g = 0L
                var b = 0L
                for ((rgb, n) in colours) {
                    r += channel(rgb, 16).toLong() * n
                    g += channel(rgb, 8).toLong() * n
                    b += channel(rgb, 0).toLong() * n
                }
                return ((r / count).toInt() shl 16) or ((g / count).toInt() shl 8) or (b / count).toInt()
            }
        }
    }
}
