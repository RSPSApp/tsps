package gateway.cache

import com.google.gson.JsonParser

/**
 * The cache JS5 serves the official client: tsps's, with every world's patches
 * ([ClientCachePatches]) and the content data tsps sends its world's league characters
 * ([ContentPatches]), which [source] reads from tsps's /api/league-content: the body, "" when tsps
 * serves none (no LeagueMode), null when tsps can't be reached. [refresh] reads it again and
 * rebuilds when it changed; a JS5 session opens with the master index, so each client start
 * refreshes, and a tsps restart into another league needs no gateway restart.
 */
class ServedCache(private val cache: Cache, private val source: () -> String?) {
    @Volatile
    var current: ClientCache = ClientCache(cache)
        private set

    private var body: String = ""

    @Synchronized
    fun refresh(): ClientCache {
        val next = source() ?: return current
        if (next == body) return current
        val (league, content) = parse(next)
        val result = ContentPatches.of(cache, content)
        current = ClientCache(cache, ClientCachePatches.ALL + result.patches)
        body = next
        if (league == null) {
            println("JS5: tsps runs no league; the cache is served with every world's patches")
        } else {
            println(
                "JS5: league $league's content from tsps (${content.structs.size} structs, ${content.enums.size} enums, " +
                    "${content.dbRows.size} DB rows): ${result.patches.size} files patched",
            )
        }
        for (reason in result.skipped) println("JS5: left out $reason")
        return current
    }

    companion object {
        /** A /api/league-content body: the league (null on a plain world) and its datasets. */
        fun parse(body: String): Pair<Int?, ContentData> {
            if (body.isBlank()) return null to ContentData.NONE
            val json = JsonParser.parseString(body).asJsonObject
            val league = json.get("league")?.takeUnless { it.isJsonNull }?.asInt
            return league to (json.getAsJsonArray("datasets")?.let(ContentData::parse) ?: ContentData.NONE)
        }
    }
}
