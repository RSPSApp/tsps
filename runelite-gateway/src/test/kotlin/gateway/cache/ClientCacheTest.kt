package gateway.cache

import gateway.headless.TestCache
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.awt.image.BufferedImage
import java.nio.ByteBuffer
import java.util.zip.CRC32

class ClientCacheTest {
    private val cache = TestCache.cache
    private val client = TestCache.clientCache

    @Test
    fun `the grouping tab suggests no world to switch to for any activity`() {
        val original = EnumTypes.decode(cache.files(CONFIG_ARCHIVE, ENUM_GROUP).getValue(GROUPING_WORLDS_ENUM))
        assertTrue(original.values.any { it > 0 }, "the cache suggests worlds: $original")
        val served = EnumTypes.decode(servedFiles(CONFIG_ARCHIVE, ENUM_GROUP).getValue(GROUPING_WORLDS_ENUM))
        assertEquals(original.keys, served.keys)
        assertEquals(setOf(NO_WORLD), served.values.toSet())
    }

    @Test
    fun `every other enum is served as the cache has it`() {
        val original = cache.files(CONFIG_ARCHIVE, ENUM_GROUP)
        val served = servedFiles(CONFIG_ARCHIVE, ENUM_GROUP)
        assertEquals(original.keys, served.keys)
        for ((id, data) in original) if (id != GROUPING_WORLDS_ENUM) assertArrayEquals(data, served[id], "enum $id")
    }

    @Test
    fun `each served config group matches the crc and lengths its served index lists`() {
        val original = cache.table(CONFIG_ARCHIVE)
        val served = servedTable(CONFIG_ARCHIVE)
        assertEquals(original.version, served.version)
        assertEquals(original.groups.keys, served.groups.keys)
        for (group in served.groups.values) {
            val container = requireNotNull(client.container(CONFIG_ARCHIVE, group.id)) { "missing 2:${group.id}" }
            assertEquals(crc(container), group.crc, "crc of 2:${group.id}")
            assertEquals(container.size, group.length, "length of 2:${group.id}")
            assertEquals(Container.decompress(container).size, group.uncompressedLength, "uncompressed length of 2:${group.id}")
            assertEquals(original.groups.getValue(group.id).version, group.version, "version of 2:${group.id}")
        }
    }

    @Test
    fun `the master index lists each served index's crc and version`() {
        val master = Container.decompress(client.masterIndex())
        assertEquals(cache.store.groupCount(DiskStore.MASTER_ARCHIVE) * 8, master.size)
        val buffer = ByteBuffer.wrap(master)
        for (archive in 0 until master.size / 8) {
            val crc = buffer.getInt()
            val version = buffer.getInt()
            val index = client.container(DiskStore.MASTER_ARCHIVE, archive) ?: continue
            assertEquals(crc(index), crc, "crc of index $archive")
            assertEquals(cache.table(archive).version, version, "version of index $archive")
        }
    }

    @Test
    fun `groups and indexes without a patch are served as stored`() {
        assertArrayEquals(cache.container(CONFIG_ARCHIVE, VARBIT_GROUP), client.container(CONFIG_ARCHIVE, VARBIT_GROUP))
        assertArrayEquals(
            cache.container(DiskStore.MASTER_ARCHIVE, INTERFACES_ARCHIVE),
            client.container(DiskStore.MASTER_ARCHIVE, INTERFACES_ARCHIVE),
        )
    }

    @Test
    fun `an added sprite is served under its id, listed in the sprite index and the master index`() {
        val sprite = Sprites.encode(BufferedImage(4, 2, BufferedImage.TYPE_INT_RGB).apply { setRGB(1, 1, 0x3366CC) })
        val withSprite = ClientCache(cache, additions = listOf(NewGroup(SPRITES_ARCHIVE, ADDED_SPRITE, "test-banner", sprite)))
        val container = requireNotNull(withSprite.container(SPRITES_ARCHIVE, ADDED_SPRITE))
        assertArrayEquals(sprite, Container.decompress(container))
        val table = ReferenceTable.decode(Container.decompress(requireNotNull(withSprite.container(DiskStore.MASTER_ARCHIVE, SPRITES_ARCHIVE))))
        val group = table.groups.getValue(ADDED_SPRITE)
        assertEquals(listOf(crc(container), container.size, sprite.size), listOf(group.crc, group.length, group.uncompressedLength))
        assertEquals(cache.table(SPRITES_ARCHIVE).groups.keys + ADDED_SPRITE, table.groups.keys)
        val master = ByteBuffer.wrap(Container.decompress(withSprite.masterIndex()))
        val index = requireNotNull(withSprite.container(DiskStore.MASTER_ARCHIVE, SPRITES_ARCHIVE))
        assertEquals(crc(index), master.getInt(SPRITES_ARCHIVE * 8))
        assertEquals(cache.table(SPRITES_ARCHIVE).version, master.getInt(SPRITES_ARCHIVE * 8 + 4))
        // The cache's own sprites and the other patches are as before.
        assertArrayEquals(cache.container(SPRITES_ARCHIVE, 0), withSprite.container(SPRITES_ARCHIVE, 0))
        assertArrayEquals(client.container(CONFIG_ARCHIVE, ENUM_GROUP), withSprite.container(CONFIG_ARCHIVE, ENUM_GROUP))
    }

    private fun servedTable(archive: Int): ReferenceTable =
        ReferenceTable.decode(Container.decompress(requireNotNull(client.container(DiskStore.MASTER_ARCHIVE, archive))))

    private fun servedFiles(archive: Int, group: Int): Map<Int, ByteArray> {
        val container = requireNotNull(client.container(archive, group)) { "missing $archive:$group" }
        return GroupFiles.split(Container.decompress(container), servedTable(archive).groups.getValue(group).files)
    }

    private fun crc(data: ByteArray): Int = CRC32().apply { update(data) }.value.toInt()

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val INTERFACES_ARCHIVE = 3
        const val ENUM_GROUP = 8
        const val VARBIT_GROUP = 14
        const val GROUPING_WORLDS_ENUM = 850
        const val NO_WORLD = -1
        const val SPRITES_ARCHIVE = 8
        const val ADDED_SPRITE = 30_999
    }
}
