package gateway.cache

import gateway.headless.TestCache
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.awt.image.BufferedImage

class SpritesTest {
    @Test
    fun `an image with few colours keeps every pixel, and clear pixels become transparent`() {
        val image = BufferedImage(3, 2, BufferedImage.TYPE_INT_ARGB)
        val pixels = intArrayOf(0xFFFF0000.toInt(), 0xFF00FF00.toInt(), 0x00000000, 0xFF0000FF.toInt(), 0x40FFFFFF, 0xFFFF0000.toInt())
        image.setRGB(0, 0, 3, 2, pixels, 0, 3)
        val (width, height, decoded) = Sprites.decode(Sprites.encode(image))
        assertEquals(3 to 2, width to height)
        assertArrayEquals(intArrayOf(0xFFFF0000.toInt(), 0xFF00FF00.toInt(), 0, 0xFF0000FF.toInt(), 0, 0xFFFF0000.toInt()), decoded)
    }

    @Test
    fun `black stays visible instead of turning transparent`() {
        val image = BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, 0xFF000000.toInt()) }
        val (_, _, decoded) = Sprites.decode(Sprites.encode(image))
        assertEquals(0xFF000001.toInt(), decoded.single())
    }

    @Test
    fun `an image with more than 255 colours gets the 255 closest`() {
        val image = BufferedImage(64, 64, BufferedImage.TYPE_INT_RGB)
        for (x in 0 until 64) for (y in 0 until 64) image.setRGB(x, y, (x * 4 shl 16) or (y * 4 shl 8) or ((x + y) * 2))
        val data = Sprites.encode(image)
        val (_, _, decoded) = Sprites.decode(data)
        assertTrue(decoded.toSet().size <= 255, "${decoded.toSet().size} colours")
        var worst = 0
        for (x in 0 until 64) for (y in 0 until 64) {
            val a = image.getRGB(x, y)
            val b = decoded[y * 64 + x]
            worst = maxOf(worst, listOf(16, 8, 0).maxOf { Math.abs(((a ushr it) and 0xFF) - ((b ushr it) and 0xFF)) })
        }
        assertTrue(worst <= 24, "worst channel error $worst")
    }

    @Test
    fun `cache sprites read back through the same decoder`() {
        val (width, height, pixels) = Sprites.decode(requireNotNull(TestCache.cache.file(CustomSprites.ARCHIVE, TITLE_SCROLL)))
        assertEquals(width * height, pixels.size)
        assertTrue(pixels.any { it != 0 })
    }

    private companion object {
        /** titlescroll, the welcome screen's title scroll (378:59). */
        const val TITLE_SCROLL = 436
    }
}
