package gateway.cache

import gateway.config.GatewayConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.ByteBuffer
import java.util.zip.CRC32

class CacheTest {
    private val cache = Cache.open(GatewayConfig.load().cacheDirectory)

    @Test
    fun `every stored group matches the crc in its archive's index`() {
        var checked = 0
        for (archive in cache.store.archives) {
            for (group in cache.table(archive).groups.values) {
                val container = requireNotNull(cache.container(archive, group.id)) { "missing $archive:${group.id}" }
                val crc = CRC32().apply { update(container) }.value.toInt()
                assertEquals(group.crc, crc, "crc of $archive:${group.id}")
                checked++
            }
        }
        assertTrue(checked > 100_000, "only $checked groups checked")
    }

    @Test
    fun `master index lists each archive's index crc and version`() {
        val master = Container.decompress(cache.masterIndex())
        val buffer = ByteBuffer.wrap(master)
        assertEquals(cache.store.groupCount(DiskStore.MASTER_ARCHIVE) * 8, master.size)
        for (archive in 0 until master.size / 8) {
            val crc = buffer.getInt()
            val version = buffer.getInt()
            val raw = cache.store.read(DiskStore.MASTER_ARCHIVE, archive) ?: continue
            assertEquals(CRC32().apply { update(Container.stripVersion(raw)) }.value.toInt(), crc)
            assertEquals(cache.table(archive).version, version)
        }
    }

    @Test
    fun `huffman table is in the binary archive`() {
        val huffman = requireNotNull(cache.file(BINARY_ARCHIVE, "huffman"))
        assertEquals(256, huffman.size)
    }

    @Test
    fun `multi-file groups split into their files`() {
        // Config archive, varbit group: one file per varbit.
        val varbits = cache.files(CONFIG_ARCHIVE, VARBIT_GROUP)
        assertTrue(varbits.size > 10_000, "${varbits.size} varbits")
    }

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val VARBIT_GROUP = 14
        const val BINARY_ARCHIVE = 10
    }
}
