package gateway.cache

import gateway.headless.TestCache
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.awt.image.BufferedImage
import java.nio.file.Files
import java.nio.file.Path
import javax.imageio.ImageIO

class CustomSpritesTest {
    private val cache = TestCache.cache

    @Test
    fun `the welcome screen banner fills the banner's art canvas`() {
        val sprites = CustomSprites.load(TestCache.config.root.resolve(CustomSprites.DIRECTORY), cache)
        val banner = sprites.single { it.group == WELCOME_BANNER }
        assertEquals(CustomSprites.ARCHIVE, banner.archive)
        val (width, height, pixels) = Sprites.decode(banner.data)
        // welcome_screen:banner_artcanvas (378:79) is banner (707x199) less 8 each way.
        assertEquals(699 to 191, width to height)
        assertTrue(pixels.none { it == 0 }, "the banner is opaque")
    }

    @Test
    fun `ids the cache uses and other files are skipped`(@TempDir directory: Path) {
        val image = BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB)
        ImageIO.write(image, "png", directory.resolve("31000-new.png").toFile())
        ImageIO.write(image, "png", directory.resolve("0-taken.png").toFile())
        ImageIO.write(image, "png", directory.resolve("banner.png").toFile())
        Files.writeString(directory.resolve("31001.png"), "not a png")
        val warnings = ArrayList<String>()
        val sprites = CustomSprites.load(directory, cache, warnings::add)
        assertEquals(listOf(31000), sprites.map { it.group })
        assertEquals("new", sprites.single().name)
        assertEquals(2, warnings.size, warnings.toString())
    }

    private companion object {
        const val WELCOME_BANNER = 30_000
    }
}
