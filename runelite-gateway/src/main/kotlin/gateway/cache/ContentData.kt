package gateway.cache

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser

/**
 * Content data (GAMEMODE_DATA, packet 210) as tsps sends it to the browser client: struct, enum
 * and DB row overrides. The official client can't take it in-band, so [ContentPatches] serves it
 * in the cache. A value is an int or a string, as the JSON has it. One that is neither (a null) is
 * left out with what holds it, as [ContentPatches] leaves out a value of the wrong kind: its struct
 * param, its whole enum or its DB column. [skipped] says what was left out.
 */
class ContentData(
    val structs: List<StructRow>,
    val enums: List<EnumRow>,
    val dbRows: List<DbRow>,
    val skipped: List<String> = emptyList(),
) {
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
            val skipped = ArrayList<String>()
            return ContentData(
                structs = byKey["structOverrides"].orEmpty().map { structRow(it, skipped) },
                enums = byKey["enumOverrides"].orEmpty().mapNotNull { enumRow(it, skipped) },
                dbRows = byKey["dbRowOverrides"].orEmpty().map { dbRow(it, skipped) },
                skipped = skipped,
            )
        }

        fun parse(json: String): ContentData = parse(JsonParser.parseString(json).asJsonArray)

        private fun structRow(row: JsonObject, skipped: MutableList<String>): StructRow {
            val id = row.get("structId").asInt
            val params = LinkedHashMap<Int, Any>()
            for ((key, element) in row.getAsJsonObject("params").entrySet()) {
                val value = value(element)
                if (value == null) skipped += "struct $id: param $key is $element" else params[key.toInt()] = value
            }
            return StructRow(id, params)
        }

        private fun enumRow(row: JsonObject, skipped: MutableList<String>): EnumRow? {
            val id = row.get("enumId").asInt
            val default = row.get("defaultValue")?.takeUnless { it.isJsonNull }
            if (default != null && value(default) == null) {
                skipped += "enum $id: its default is $default"
                return null
            }
            val entries = LinkedHashMap<Int, Any>()
            for (entry in row.getAsJsonArray("entries")) {
                val (key, element) = entry.asJsonArray.let { it[0].asInt to it[1] }
                val value = value(element)
                if (value == null) {
                    skipped += "enum $id: the value of $key is $element"
                    return null
                }
                entries[key] = value
            }
            return EnumRow(id, row.get("valueType").asString.single(), default?.let(::value), entries)
        }

        private fun dbRow(row: JsonObject, skipped: MutableList<String>): DbRow {
            val id = row.get("rowId").asInt
            val columns = LinkedHashMap<Int, List<Any>>()
            for ((key, element) in row.getAsJsonObject("columns").entrySet()) {
                val values = (element as? JsonArray)?.map(::value)
                if (values == null || null in values) skipped += "db row $id: column $key is $element" else columns[key.toInt()] = values.filterNotNull()
            }
            return DbRow(id, row.get("tableId").asInt, columns)
        }

        /** An int or a string (a boolean is 1 or 0); null for anything else, which no param, enum or column holds. */
        private fun value(element: JsonElement): Any? {
            if (!element.isJsonPrimitive) return null
            val primitive = element.asJsonPrimitive
            return when {
                primitive.isString -> primitive.asString
                primitive.isBoolean -> if (primitive.asBoolean) 1 else 0
                else -> primitive.asInt
            }
        }
    }
}
