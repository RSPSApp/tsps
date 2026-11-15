package gateway.it

import com.google.gson.JsonParser
import gateway.cache.ContentData
import gateway.cache.Container
import gateway.cache.DbTypes
import gateway.cache.DiskStore
import gateway.cache.EnumDefinition
import gateway.cache.GroupFiles
import gateway.cache.ReferenceTable
import gateway.cache.ServedCache
import gateway.cache.StructTypes
import gateway.headless.HeadlessClient
import gateway.headless.TestCache
import gateway.tsps.TspsContent
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.varp.VarpLarge
import net.rsprox.protocol.game.outgoing.model.varp.VarpSmall
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files

/**
 * A league world through the gateway: the content data tsps sends its league characters
 * (/api/league-content) comes out of JS5 in the cache, as the browser client applies it. Needs tsps
 * running a league world whose content the cache lacks (`league:type` 4 or 5); the task test also
 * needs `DEV_USERNAME`, and completes a task on that account.
 */
class LeagueContentTest {
    private val gateway = LiveGateway.gateway
    private val league: Int?
    private val content: ContentData

    init {
        val (league, content) = ServedCache.parse(TspsContent(TestCache.config.leagueContentUrl)() ?: "")
        this.league = league
        this.content = content
    }

    @Test
    fun `js5 serves every enum, struct and db row of the league's content`() {
        assumeTrue(!content.isEmpty, "tsps runs no league with content (league $league)")
        val served = Served(LiveGateway.client())
        val cacheEnums = TestCache.cache.files(CONFIG_ARCHIVE, ENUM_GROUP)
        for (row in content.enums) {
            val enum = EnumDefinition.decode(served.files(ENUM_GROUP).getValue(row.id))
            assertEquals(row.entries, enum.entries, "entries of enum ${row.id}")
            assertEquals(row.default, enum.default, "default of enum ${row.id}")
            cacheEnums[row.id]?.let { assertEquals(EnumDefinition.decode(it).valueType, enum.valueType, "a cache enum keeps its value type: ${row.id}") }
        }
        val cacheStructs = TestCache.cache.files(CONFIG_ARCHIVE, StructTypes.STRUCT_GROUP)
        for (row in content.structs) {
            val params = StructTypes.decode(served.files(StructTypes.STRUCT_GROUP).getValue(row.id))
            for ((param, value) in row.params) assertEquals(value, params[param], "struct ${row.id} param $param")
            // A param that pointed at a cache enum and now points at a new one: the scripts expect the same types.
            val before = cacheStructs[row.id]?.let(StructTypes::decode) ?: continue
            for ((param, value) in row.params) {
                val old = (before[param] as? Int)?.let(cacheEnums::get)?.let(EnumDefinition::decode) ?: continue
                if (value == before[param] || value !is Int || cacheEnums.containsKey(value)) continue
                val new = EnumDefinition.decode(served.files(ENUM_GROUP).getValue(value))
                assertEquals(old.keyType to old.valueType, new.keyType to new.valueType, "enum $value in struct ${row.id} param $param")
            }
        }
        for (row in content.dbRows) {
            val served = DbTypes.decodeRow(served.files(DbTypes.ROW_GROUP).getValue(row.id))
            assertEquals(row.table, served.table)
            assertEquals(row.columns, served.columns.mapValues { it.value.values }, "db row ${row.id}")
        }
    }

    @Test
    fun `a task tsps completes sets the bit of its own row in the list js5 serves`() {
        val tasks = league?.let(::catalog)
        assumeTrue(tasks != null, "tsps runs no league whose task list the cache lacks (league $league)")
        val developer = LiveGateway.developerName
        assumeTrue(developer != null, "DEV_USERNAME isn't set; ::leaguetask is a developer command")
        val served = Served(LiveGateway.client())
        val list = EnumDefinition.decode(served.files(ENUM_GROUP).getValue(TASK_ENUM)).entries
        LiveGateway.login(developer!!).use { game ->
            val varps = HashMap<Int, Int>()
            game.ticks(LOGIN_TICKS, varps)
            val done = { position: Int -> (varps[FIRST_COMPLETION_VARP + position / 32] ?: 0) ushr (position % 32) and 1 == 1 }
            val position = tasks!!.indices.firstOrNull { it < COMPLETION_POSITIONS && !done(it) }
            assumeTrue(position != null, "$developer has every task of the first completion varps")
            val (id, name) = tasks[position!!]
            game.command("leaguetask $id")
            game.ticks(TICKS, varps)
            assertEquals(true, done(position), "the completion bit of $id at $position")
            val row = DbTypes.decodeRow(served.files(DbTypes.ROW_GROUP).getValue(list.getValue(position) as Int))
            assertEquals(listOf(name), row.columns.getValue(NAME_COLUMN).values, "the row the list draws at $position")
        }
    }

    /**
     * The config archive as the gateway's JS5 serves it. Like the client, it asks for the master index
     * first: that request brings the served cache up to date (waiting out the startup read of tsps's
     * content), so the index and the groups after it agree.
     */
    private class Served(private val client: HeadlessClient) {
        private val index =
            client.js5(DiskStore.MASTER_ARCHIVE, DiskStore.MASTER_ARCHIVE).let {
                ReferenceTable.decode(Container.decompress(client.js5(DiskStore.MASTER_ARCHIVE, CONFIG_ARCHIVE)))
            }
        private val groups = HashMap<Int, Map<Int, ByteArray>>()

        fun files(group: Int): Map<Int, ByteArray> =
            groups.getOrPut(group) { GroupFiles.split(Container.decompress(client.js5(CONFIG_ARCHIVE, group)), index.groups.getValue(group).files) }
    }

    /** A league's tasks (id, name) in list order, where its position is its completion bit; null when the cache carries its list. */
    private fun catalog(league: Int): List<Pair<String, String>>? {
        val json = JsonParser.parseString(Files.readString(TestCache.config.root.resolve("server/plugins/modes/data/league-tasks.json"))).asJsonObject
        val catalog = json.getAsJsonObject("leagues").getAsJsonObject(league.toString()) ?: return null
        if (catalog.get("fromCache")?.asBoolean == true) return null
        return catalog.getAsJsonArray("tasks").map { it.asJsonObject.let { task -> task.get("id").asString to task.get("name").asString } }
    }

    /** Reads [count] ticks, keeping the varps they set. */
    private fun HeadlessClient.Game.ticks(count: Int, varps: MutableMap<Int, Int>) {
        var seen = 0
        while (seen < count) {
            when (val message = next() ?: error("stream ended")) {
                is ServerTickEnd -> seen++
                is VarpSmall -> varps[message.id] = message.value
                is VarpLarge -> varps[message.id] = message.value
            }
        }
    }

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val ENUM_GROUP = 8
        const val LOGIN_TICKS = 6
        const val TICKS = 3

        /** league-task-list.json: the task enum, the name column, and varps 2616-2631 for the bits of positions 0-511. */
        const val TASK_ENUM = 5950
        const val NAME_COLUMN = 0
        const val FIRST_COMPLETION_VARP = 2616
        const val COMPLETION_POSITIONS = 512
    }
}
