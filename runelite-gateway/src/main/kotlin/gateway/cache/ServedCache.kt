package gateway.cache

import com.google.gson.JsonParser

/**
 * The cache JS5 serves the official client: tsps's, with every world's patches
 * ([ClientCachePatches]) and the content data tsps sends its world's league characters
 * ([ContentPatches]), which [source] reads from tsps's /api/league-content: the body, "" when tsps
 * serves none (no LeagueMode), null when tsps can't be reached. [refresh] reads it again and
 * rebuilds when it changed; a JS5 session opens with the master index, so each client start
 * refreshes, and a tsps restart into another league needs no gateway restart. A body the gateway
 * can't read is reported once and leaves the cache as it was: refresh runs on the master index
 * request, and a throw there would close every client that starts loading.
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
        body = next
        try {
            current = build(next)
        } catch (e: Exception) {
            println("JS5: tsps's league content can't be read, so the cache is served as before: ${e.toString().take(MAX_ERROR)}")
        }
        return current
    }

    private fun build(body: String): ClientCache {
        val (league, content) = parse(body)
        val result = ContentPatches.of(cache, content)
        val built = ClientCache(cache, ClientCachePatches.ALL + result.patches)
        if (league == null) {
            println("JS5: tsps runs no league; the cache is served with every world's patches")
        } else {
            println(
                "JS5: league $league's content from tsps (${content.structs.size} structs, ${content.enums.size} enums, " +
                    "${content.dbRows.size} DB rows): ${result.patches.size} files patched",
            )
        }
        for (reason in content.skipped + result.skipped) println("JS5: left out $reason")
        return built
    }

    companion object {
        private const val MAX_ERROR = 300

        /** A /api/league-content body: the league (null on a plain world) and its datasets. */
        fun parse(body: String): Pair<Int?, ContentData> {
            if (body.isBlank()) return null to ContentData.NONE
            val json = JsonParser.parseString(body).asJsonObject
            val league = json.get("league")?.takeUnless { it.isJsonNull }?.asInt
            return league to (json.getAsJsonArray("datasets")?.let(ContentData::parse) ?: ContentData.NONE)
        }
    }
}
