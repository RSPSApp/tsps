package gateway.cache

import gateway.headless.TestCache
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.zip.CRC32

/** Content data as the cache JS5 serves, with the ids Raging Echoes' payload uses. */
class ContentPatchesTest {
    private val cache = TestCache.cache

    @Test
    fun `a cache enum takes the data's entries and default but keeps its types`() {
        val content = ContentData(emptyList(), listOf(ContentData.EnumRow(TASK_ENUM, 'J', -1, mapOf(0 to 350000, 1 to 350001))), emptyList())
        val served = EnumDefinition.decode(served(content).getValue(ENUM_GROUP).getValue(TASK_ENUM))
        val cached = EnumDefinition.decode(cache.file(CONFIG_ARCHIVE, ENUM_GROUP, TASK_ENUM)!!)
        assertEquals(EnumDefinition(cached.keyType, cached.valueType, -1, mapOf(0 to 350000, 1 to 350001)), served)
        assertEquals(DBROW_TYPE, served.valueType, "the cache's dbrow type, not tsps's J")
    }

    @Test
    fun `a new enum gets int keys and tsps's value type, strings in opcode 5`() {
        val content = ContentData(
            emptyList(),
            listOf(
                ContentData.EnumRow(NEW_ENUM, 'J', -1, mapOf(0 to NEW_STRUCT)),
                ContentData.EnumRow(NEW_ENUM + 1, 's', "", mapOf(0 to "Welcome to Leagues IV", 1 to "Page two")),
            ),
            emptyList(),
        )
        val enums = served(content).getValue(ENUM_GROUP)
        assertEquals(EnumDefinition(INT, EnumDefinition.typeByte('J'), -1, mapOf(0 to NEW_STRUCT)), EnumDefinition.decode(enums.getValue(NEW_ENUM)))
        val strings = enums.getValue(NEW_ENUM + 1)
        assertEquals(EnumDefinition(INT, EnumDefinition.typeByte('s'), "", mapOf(0 to "Welcome to Leagues IV", 1 to "Page two")), EnumDefinition.decode(strings))
        assertTrue(strings.contains(5.toByte()) && !strings.contains(6.toByte()), "string entries are opcode 5")
    }

    @Test
    fun `a cache struct takes the data's params over its own`() {
        val content = ContentData(listOf(ContentData.StructRow(LEAGUE_STRUCT, mapOf(TIERS_PARAM to NEW_ENUM))), emptyList(), emptyList())
        val cached = StructTypes.decode(cache.file(CONFIG_ARCHIVE, StructTypes.STRUCT_GROUP, LEAGUE_STRUCT)!!)
        val served = StructTypes.decode(served(content).getValue(StructTypes.STRUCT_GROUP).getValue(LEAGUE_STRUCT))
        assertTrue(cached.size > 1, "the league struct has other params: $cached")
        assertEquals(cached + (TIERS_PARAM to NEW_ENUM), served)
    }

    @Test
    fun `a new struct gets the data's params, strings as strings`() {
        val params = mapOf(RELIC_NAME_PARAM to "Power Miner", RELIC_TIER_PARAM to 0)
        val content = ContentData(listOf(ContentData.StructRow(NEW_STRUCT, params)), emptyList(), emptyList())
        assertEquals(params, StructTypes.decode(served(content).getValue(StructTypes.STRUCT_GROUP).getValue(NEW_STRUCT)))
    }

    @Test
    fun `a value of the wrong kind is left out and reported`() {
        val content =
            ContentData(
                listOf(ContentData.StructRow(NEW_STRUCT, mapOf(RELIC_NAME_PARAM to 5, RELIC_TIER_PARAM to "zero", NO_PARAM to 1))),
                listOf(ContentData.EnumRow(POINTS_ENUM, 'i', 0, mapOf(1 to "ten"))),
                listOf(ContentData.DbRow(NEW_ROW, TASK_TABLE, mapOf(NAME_COLUMN to listOf(1), 99 to listOf(1)))),
            )
        val result = ContentPatches.of(cache, content)
        assertEquals(4, result.skipped.count { it.startsWith("struct") || it.startsWith("enum") }, result.skipped.toString())
        assertEquals(2, result.skipped.count { it.startsWith("db row") }, result.skipped.toString())
        assertFalse(result.patches.any { it.group == StructTypes.STRUCT_GROUP || it.group == ENUM_GROUP }, "nothing left to serve for the struct and enum")
        val row = DbTypes.decodeRow(ClientCache(cache, result.patches).let { servedFiles(it, DbTypes.ROW_GROUP) }.getValue(NEW_ROW))
        assertEquals(TASK_TABLE, row.table)
        assertTrue(row.columns.isEmpty(), "the row has neither bad column")
    }

    @Test
    fun `a db row is replaced whole, typed by its table`() {
        val cached = DbTypes.decodeRow(cache.file(CONFIG_ARCHIVE, DbTypes.ROW_GROUP, CACHE_TASK_ROW)!!)
        assertTrue(cached.columns.size > 2)
        val columns = mapOf(NAME_COLUMN to listOf<Any>("Achieve Your First Level 5"), TIER_COLUMN to listOf<Any>(1))
        val content = ContentData(emptyList(), emptyList(), listOf(ContentData.DbRow(CACHE_TASK_ROW, TASK_TABLE, columns), ContentData.DbRow(NEW_ROW, TASK_TABLE, columns)))
        val rows = served(content).getValue(DbTypes.ROW_GROUP)
        for (id in listOf(CACHE_TASK_ROW, NEW_ROW)) {
            val row = DbTypes.decodeRow(rows.getValue(id))
            assertEquals(TASK_TABLE, row.table)
            assertEquals(columns, row.columns.mapValues { it.value.values })
        }
    }

    @Test
    fun `an override that changes nothing is no patch`() {
        val cached = StructTypes.decode(cache.file(CONFIG_ARCHIVE, StructTypes.STRUCT_GROUP, AREA_SLOT_STRUCT)!!)
        val enum = EnumDefinition.decode(cache.file(CONFIG_ARCHIVE, ENUM_GROUP, POINTS_ENUM)!!)
        val content =
            ContentData(
                listOf(ContentData.StructRow(AREA_SLOT_STRUCT, mapOf(AREA_TASKS_PARAM to cached.getValue(AREA_TASKS_PARAM)))),
                listOf(ContentData.EnumRow(POINTS_ENUM, 'i', enum.default, enum.entries)),
                emptyList(),
            )
        val result = ContentPatches.of(cache, content)
        assertTrue(result.patches.isEmpty() && result.skipped.isEmpty(), "${result.patches.size} patches, ${result.skipped}")
    }

    @Test
    fun `the served index lists the new files with their groups' crcs and lengths`() {
        val content =
            ContentData(
                listOf(ContentData.StructRow(NEW_STRUCT, mapOf(RELIC_TIER_PARAM to 0))),
                listOf(ContentData.EnumRow(NEW_ENUM, 'J', -1, mapOf(0 to NEW_STRUCT))),
                listOf(ContentData.DbRow(NEW_ROW, TASK_TABLE, mapOf(TIER_COLUMN to listOf(1)))),
            )
        val client = ClientCache(cache, ContentPatches.of(cache, content).patches)
        val original = cache.table(CONFIG_ARCHIVE)
        val served = servedTable(client)
        for ((group, id) in listOf(ENUM_GROUP to NEW_ENUM, StructTypes.STRUCT_GROUP to NEW_STRUCT, DbTypes.ROW_GROUP to NEW_ROW)) {
            val entry = served.groups.getValue(group)
            assertEquals(original.groups.getValue(group).files.toList() + id, entry.files.toList(), "files of 2:$group")
            val container = client.container(CONFIG_ARCHIVE, group)!!
            assertEquals(crc(container), entry.crc, "crc of 2:$group")
            assertEquals(container.size, entry.length)
            assertEquals(Container.decompress(container).size, entry.uncompressedLength)
            for ((file, data) in cache.files(CONFIG_ARCHIVE, group)) assertArrayEquals(data, servedFiles(client, group)[file], "2:$group:$file")
        }
    }

    @Test
    fun `no content serves every world's patches only`() {
        assertTrue(ContentPatches.of(cache, ContentData.NONE).patches.isEmpty())
    }

    @Test
    fun `every enum and struct in the cache decodes and encodes back`() {
        for ((id, data) in cache.files(CONFIG_ARCHIVE, ENUM_GROUP)) {
            val definition = EnumDefinition.decode(data)
            assertEquals(definition, EnumDefinition.decode(definition.encode()), "enum $id")
        }
        for ((id, data) in cache.files(CONFIG_ARCHIVE, StructTypes.STRUCT_GROUP)) assertArrayEquals(data, StructTypes.encode(StructTypes.decode(data)), "struct $id")
        val params = cache.files(CONFIG_ARCHIVE, StructTypes.PARAM_GROUP)
        assertTrue(StructTypes.isStringParam(params.getValue(RELIC_NAME_PARAM)))
        assertFalse(StructTypes.isStringParam(params.getValue(RELIC_TIER_PARAM)))
        params.values.forEach(StructTypes::isStringParam)
    }

    @Test
    fun `every task row encodes as the cache writes it`() {
        val table = DbTypes.decodeTable(cache.file(CONFIG_ARCHIVE, DbTypes.TABLE_GROUP, TASK_TABLE)!!)
        val rows = cache.files(CONFIG_ARCHIVE, DbTypes.ROW_GROUP).filterValues { DbTypes.decodeRow(it).table == TASK_TABLE }
        assertTrue(rows.size > 1000, "${rows.size} task rows")
        for ((id, data) in rows) assertArrayEquals(data, DbTypes.encodeRow(DbTypes.decodeRow(data), table.columnCount), "row $id")
    }

    private fun served(content: ContentData): Map<Int, Map<Int, ByteArray>> {
        val result = ContentPatches.of(cache, content)
        assertTrue(result.skipped.isEmpty(), result.skipped.toString())
        val client = ClientCache(cache, result.patches)
        return result.patches.map { it.group }.toSet().associateWith { servedFiles(client, it) }
    }

    private fun servedTable(client: ClientCache): ReferenceTable =
        ReferenceTable.decode(Container.decompress(requireNotNull(client.container(DiskStore.MASTER_ARCHIVE, CONFIG_ARCHIVE))))

    private fun servedFiles(client: ClientCache, group: Int): Map<Int, ByteArray> =
        GroupFiles.split(Container.decompress(client.container(CONFIG_ARCHIVE, group)!!), servedTable(client).groups.getValue(group).files)

    private fun crc(data: ByteArray): Int = CRC32().apply { update(data) }.value.toInt()

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val ENUM_GROUP = 8
        val INT = EnumDefinition.typeByte('i')
        val DBROW_TYPE = EnumDefinition.typeByte('Ð')

        /** league-task-list.json: the list's task enum, tier points enum, table and its name and difficulty columns. */
        const val TASK_ENUM = 5950
        const val POINTS_ENUM = 2671
        const val TASK_TABLE = 118
        const val NAME_COLUMN = 0
        const val TIER_COLUMN = 32

        /** A Demonic Pacts task row ("Achieve Your First Level 10"). */
        const val CACHE_TASK_ROW = 14729

        /** Raging Echoes' league struct (enum 2670) and its relic tier enum param. */
        const val LEAGUE_STRUCT = 6211
        const val TIERS_PARAM = 870

        /** Relic struct params: name (a string) and tier (an int). */
        const val RELIC_NAME_PARAM = 879
        const val RELIC_TIER_PARAM = 885

        /** league-areas.json: an area unlock slot's struct and its tasks-needed param. */
        const val AREA_SLOT_STRUCT = 5975
        const val AREA_TASKS_PARAM = 1010

        /** Ids tsps gives a league's own rows (virtual, past the cache's). */
        const val NEW_ENUM = 205000
        const val NEW_STRUCT = 205100
        const val NEW_ROW = 350000
        const val NO_PARAM = 0xFFFFFF
    }
}
