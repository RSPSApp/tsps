package gateway.cache

import java.nio.file.Files
import java.nio.file.Path
import javax.imageio.ImageIO
import kotlin.io.path.isRegularFile
import kotlin.io.path.name

/**
 * tsps's own sprites, `server/data/sprites/<id>[-name].png` (the welcome screen's rsps.app banner,
 * 30000), added to the sprite archive the official client downloads. The browser client gets the
 * same files from tsps's `/api/sprites`. An id the cache already uses is skipped: its sprite wins.
 */
object CustomSprites {
    const val ARCHIVE = 8
    const val DIRECTORY = "server/data/sprites"
    private val FILE_NAME = Regex("""^(\d+)(?:-([a-z0-9-]+))?\.png$""")

    fun load(directory: Path, cache: Cache, warn: (String) -> Unit = ::println): List<NewGroup> {
        if (!Files.isDirectory(directory)) return emptyList()
        val used = cache.table(ARCHIVE).groups.keys
        return Files.list(directory).use { files -> files.filter { it.isRegularFile() }.sorted().toList() }.mapNotNull { file ->
            val match = FILE_NAME.matchEntire(file.name) ?: return@mapNotNull null
            val id = match.groupValues[1].toInt()
            if (id in used) {
                warn("custom sprite ${file.name}: the cache already has sprite $id; skipped")
                return@mapNotNull null
            }
            val image = ImageIO.read(file.toFile())
            if (image == null) {
                warn("custom sprite ${file.name}: not a readable PNG; skipped")
                return@mapNotNull null
            }
            NewGroup(ARCHIVE, id, match.groupValues[2], Sprites.encode(image))
        }
    }
}
