package gateway.cache

import com.google.gson.JsonElement
import com.google.gson.JsonParser

/**
 * Content data (GAMEMODE_DATA, packet 210) as tsps sends it to the browser client: struct, enum
 * and DB row overrides. The official client can't take it in-band, so [ContentPatches] serves it
 * in the cache. A value is an int or a string, as the JSON has it.
 */
class ContentData(val structs: List<StructRow>, val enums: List<EnumRow>, val dbRows: List<DbRow>) {
    /** A struct's params: a cache struct's listed params are replaced, the rest kept. */
    class StructRow(val id: Int, val params: Map<Int, Any>)

    /** An enum's entries and default; [valueType] is tsps's type character, for an enum the cache lacks. */
    class EnumRow(val id: Int, val valueType: Char, val default: Any?, val entries: Map<Int, Any>)

    /** A whole row: a column it leaves out takes the table's default. */
    class DbRow(val id: Int, val table: Int, val columns: Map<Int, List<Any>>)

    val isEmpty: Boolean get() = structs.isEmpty() && enums.isEmpty() && dbRows.isEmpty()

    companion object {
        val NONE = ContentData(emptyList(), emptyList(), emptyList())

        /** The datasets of a content data payload, `[{ key, rows }]`; datasets it doesn't serve are left out. */
        fun parse(datasets: Iterable<JsonElement>): ContentData {
            val byKey = datasets.map { it.asJsonObject }.associate { it.get("key").asString to it.getAsJsonArray("rows").map(JsonElement::getAsJsonObject) }
            return ContentData(
                structs = byKey["structOverrides"].orEmpty().map { row ->
                    StructRow(row.get("structId").asInt, row.getAsJsonObject("params").entrySet().associate { (key, value) -> key.toInt() to value(value) })
                },
                enums = byKey["enumOverrides"].orEmpty().map { row ->
                    EnumRow(
                        id = row.get("enumId").asInt,
                        valueType = row.get("valueType").asString.single(),
                        default = row.get("defaultValue")?.takeUnless { it.isJsonNull }?.let(::value),
                        entries = row.getAsJsonArray("entries").associate { entry -> entry.asJsonArray.let { it[0].asInt to value(it[1]) } },
                    )
                },
                dbRows = byKey["dbRowOverrides"].orEmpty().map { row ->
                    DbRow(row.get("rowId").asInt, row.get("tableId").asInt, row.getAsJsonObject("columns").entrySet().associate { (key, values) -> key.toInt() to values.asJsonArray.map(::value) })
                },
            )
        }

        fun parse(json: String): ContentData = parse(JsonParser.parseString(json).asJsonArray)

        private fun value(element: JsonElement): Any {
            val primitive = element.asJsonPrimitive
            return when {
                primitive.isString -> primitive.asString
                primitive.isBoolean -> if (primitive.asBoolean) 1 else 0
                else -> primitive.asInt
            }
        }
    }
}
