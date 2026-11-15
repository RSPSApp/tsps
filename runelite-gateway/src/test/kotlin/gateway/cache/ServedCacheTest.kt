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
    fun `a body that can't be read leaves the cache as it was`() {
        var body: String? = payload(null)
        val served = ServedCache(cache) { body }
        assertArrayEquals(plain.masterIndex(), served.refresh().masterIndex(), "the enum with a null value is left out")
        body = payload(10)
        val league = served.refresh()
        val unreadable = listOf(
            "{",
            """{"league":5,"datasets":[{"key":"enumOverrides"}]}""",
            """{"league":5,"datasets":[{"key":"enumOverrides","rows":[{"enumId":$POINTS_ENUM}]}]}""",
        )
        for (next in unreadable) {
            body = next
            assertSame(league, served.refresh(), "for $next")
        }
        body = payload(20)
        assertEquals(mapOf(1 to 20), EnumDefinition.decode(points(served.refresh())).entries, "a readable body after it is served")
    }

    @Test
    fun `a body's league and datasets`() {
        val (league, content) = ServedCache.parse(payload(10))
        assertEquals(5, league)
        assertEquals(listOf(POINTS_ENUM), content.enums.map { it.id })
        assertNull(ServedCache.parse("").first)
    }

    @Test
    fun `a value that isn't an int or a string is left out with its struct param, enum or db column`() {
        val (_, content) = ServedCache.parse(
            """{"league":5,"datasets":[""" +
                """{"key":"structOverrides","rows":[{"structId":1,"params":{"10":5,"11":null,"12":[1]}}]},""" +
                """{"key":"enumOverrides","rows":[{"enumId":$POINTS_ENUM,"valueType":"i","defaultValue":0,"entries":[[1,10],[2,null]]},""" +
                """{"enumId":2,"valueType":"i","defaultValue":{},"entries":[]}]},""" +
                """{"key":"dbRowOverrides","rows":[{"rowId":3,"tableId":118,"columns":{"0":["a"],"1":[1,null],"2":null}}]}]}""",
        )
        assertEquals(mapOf(10 to 5), content.structs.single().params)
        assertEquals(emptyList<Int>(), content.enums.map { it.id })
        assertEquals(mapOf(0 to listOf("a")), content.dbRows.single().columns)
        assertEquals(
            listOf(
                "struct 1: param 11 is null",
                "struct 1: param 12 is [1]",
                "enum $POINTS_ENUM: the value of 2 is null",
                "enum 2: its default is {}",
                "db row 3: column 1 is [1,null]",
                "db row 3: column 2 is null",
            ),
            content.skipped,
        )
    }

    private fun payload(points: Int?) =
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
