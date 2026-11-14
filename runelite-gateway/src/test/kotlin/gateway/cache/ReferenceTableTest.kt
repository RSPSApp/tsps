package gateway.cache

import gateway.headless.TestCache
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class ReferenceTableTest {
    private val cache = TestCache.cache

    @Test
    fun `every index in the cache writes back to the same bytes`() {
        for (archive in cache.store.archives) {
            val data = index(archive) ?: continue
            assertArrayEquals(data, ReferenceTable.Companion.Encoded.read(data).write(), "index $archive")
        }
    }

    @Test
    fun `a new group joins the index in id order with its crc, lengths and version`() {
        val original = ReferenceTable.decode(requireNotNull(index(SPRITES)))
        val id = original.groups.keys.max() + 1000
        val data = ReferenceTable.withNewGroup(requireNotNull(index(SPRITES)), id, ReferenceTable.djb2("banner"), 0x1234, 7, 100, 400)
        val table = ReferenceTable.decode(data)
        assertEquals(original.version, table.version)
        assertEquals(original.groups.keys + id, table.groups.keys)
        val group = table.groups.getValue(id)
        assertEquals(listOf(0x1234, 7, 100, 400), listOf(group.crc, group.version, group.length, group.uncompressedLength))
        assertEquals(listOf(0), group.files.toList())
        assertEquals(id, table.group("banner")?.id)
        for ((other, entry) in original.groups) assertEquals(entry.crc, table.groups.getValue(other).crc, "crc of $other")
    }

    @Test
    fun `a group the index already has can't be added`() {
        val data = requireNotNull(index(SPRITES))
        val existing = ReferenceTable.decode(data).groups.keys.first()
        assertThrows<IllegalArgumentException> { ReferenceTable.withNewGroup(data, existing, 0, 0, 0, 0, 0) }
    }

    private fun index(archive: Int): ByteArray? = cache.container(DiskStore.MASTER_ARCHIVE, archive)?.let(Container::decompress)

    private companion object {
        const val SPRITES = 8
    }
}
