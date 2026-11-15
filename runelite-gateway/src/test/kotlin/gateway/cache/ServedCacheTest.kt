package gateway.cache

import gateway.headless.TestCache
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotSame
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

/** The served cache follows what tsps's /api/league-content says, read again at each refresh. */
class ServedCacheTest {
    private val cache = TestCache.cache
    private val plain = ClientCache(cache)

    @Test
    fun `tsps unreachable, without LeagueMode or on a plain world serves every world's patches`() {
        for (body in listOf(null, "", """{"league":null,"datasets":[]}""")) {
            val served = ServedCache(cache) { body }
            assertArrayEquals(plain.masterIndex(), served.refresh().masterIndex(), "for $body")
        }
    }

    @Test
    fun `a league's payload is served, and rebuilt only when it changes`() {
        var body: String? = payload(10)
        val served = ServedCache(cache) { body }
        val first = served.refresh()
        assertEquals(mapOf(1 to 10), EnumDefinition.decode(points(first)).entries)
        assertSame(first, served.refresh(), "the same payload keeps the built cache")
        body = payload(20)
        val second = served.refresh()
        assertNotSame(first, second)
        assertEquals(mapOf(1 to 20), EnumDefinition.decode(points(second)).entries)
        body = null
        assertSame(second, served.refresh(), "tsps gone: what was served stays")
    }

    @Test
    fun `a body's league and datasets`() {
        val (league, content) = ServedCache.parse(payload(10))
        assertEquals(5, league)
        assertEquals(listOf(POINTS_ENUM), content.enums.map { it.id })
        assertNull(ServedCache.parse("").first)
    }

    private fun payload(points: Int) =
        """{"league":5,"datasets":[{"key":"structOverrides","rows":[]},""" +
            """{"key":"enumOverrides","rows":[{"enumId":$POINTS_ENUM,"valueType":"i","defaultValue":0,"entries":[[1,$points]]}]},""" +
            """{"key":"dbRowOverrides","rows":[]}]}"""

    private fun points(client: ClientCache): ByteArray {
        val index = ReferenceTable.decode(Container.decompress(client.container(DiskStore.MASTER_ARCHIVE, CONFIG_ARCHIVE)!!))
        return GroupFiles.split(Container.decompress(client.container(CONFIG_ARCHIVE, ENUM_GROUP)!!), index.groups.getValue(ENUM_GROUP).files).getValue(POINTS_ENUM)
    }

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val ENUM_GROUP = 8
        const val POINTS_ENUM = 2671
    }
}
