package gateway.cache

/**
 * tsps's content data as patches to the cache JS5 serves the official client, applied as the
 * browser client applies it (GamemodeContentStore, DbOps):
 *
 * - an enum gets the data's entries and default. A cache enum keeps its key and value types,
 *   which the client's script `enum` checks; a new one gets int keys and tsps's value type.
 * - a struct gets the data's params over a cache struct's own.
 * - a DB row is replaced whole, its columns typed by its table.
 *
 * A value of the wrong kind for its param, column or enum (a string where the cache declares an
 * int, say) is left out and reported: the client would read it as the declared type. An override
 * that changes nothing isn't a patch, so a world whose data matches the cache gets the cache.
 */
object ContentPatches {
    private const val CONFIG_ARCHIVE = 2
    private val INT_TYPE = EnumDefinition.typeByte('i')
    private val STRING_TYPE = EnumDefinition.typeByte('s')

    class Result(val patches: List<FilePatch>, val skipped: List<String>)

    fun of(cache: Cache, content: ContentData): Result {
        if (content.isEmpty) return Result(emptyList(), emptyList())
        val skipped = ArrayList<String>()
        val files = HashMap<Int, Map<Int, ByteArray>>()
        val group = { id: Int -> files.getOrPut(id) { cache.files(CONFIG_ARCHIVE, id) } }
        val patches = ArrayList<FilePatch>()
        for (row in content.enums.associateBy { it.id }.values) {
            enumFile(row, group(EnumTypes.ENUM_GROUP)[row.id], skipped)?.let { patches += it }
        }
        for (row in content.structs.associateBy { it.id }.values) {
            structFile(row, group(StructTypes.STRUCT_GROUP)[row.id], group(StructTypes.PARAM_GROUP), skipped)?.let { patches += it }
        }
        val tables = HashMap<Int, DbTypes.Table?>()
        for (row in content.dbRows.associateBy { it.id }.values) {
            val table = tables.getOrPut(row.table) { group(DbTypes.TABLE_GROUP)[row.table]?.let(DbTypes::decodeTable) }
            if (table == null) {
                skipped += "db row ${row.id}: no table ${row.table}"
                continue
            }
            rowFile(row, table, group(DbTypes.ROW_GROUP)[row.id], skipped)?.let { patches += it }
        }
        return Result(patches, skipped)
    }

    private fun enumFile(row: ContentData.EnumRow, cached: ByteArray?, skipped: MutableList<String>): FilePatch? {
        val old = cached?.let(EnumDefinition::decode)
        val definition = EnumDefinition(old?.keyType ?: INT_TYPE, old?.valueType ?: EnumDefinition.typeByte(row.valueType), row.default, row.entries)
        val strings = definition.valueType == STRING_TYPE
        if ((row.entries.values + listOfNotNull(row.default)).any { (it is String) != strings }) {
            skipped += "enum ${row.id}: values aren't all ${if (strings) "strings" else "ints"}"
            return null
        }
        if (definition == old) return null
        return file(EnumTypes.ENUM_GROUP, row.id, definition.encode(), cached != null)
    }

    private fun structFile(row: ContentData.StructRow, cached: ByteArray?, params: Map<Int, ByteArray>, skipped: MutableList<String>): FilePatch? {
        val old = cached?.let(StructTypes::decode)
        val merged = LinkedHashMap(old.orEmpty())
        for ((param, value) in row.params) {
            val definition = params[param]
            when {
                definition == null -> skipped += "struct ${row.id}: no param $param"
                (value is String) != StructTypes.isStringParam(definition) -> skipped += "struct ${row.id}: param $param isn't a ${if (value is String) "string" else "int"}"
                else -> merged[param] = value
            }
        }
        if (merged == old || (old == null && merged.isEmpty())) return null
        return file(StructTypes.STRUCT_GROUP, row.id, StructTypes.encode(merged), cached != null)
    }

    private fun rowFile(row: ContentData.DbRow, table: DbTypes.Table, cached: ByteArray?, skipped: MutableList<String>): FilePatch? {
        val columns = LinkedHashMap<Int, DbTypes.Column>()
        for ((column, values) in row.columns) {
            val types = table.types[column]
            when {
                types == null -> skipped += "db row ${row.id}: no column $column in table ${row.table}"
                values.isEmpty() || values.size % types.size != 0 -> skipped += "db row ${row.id}: column $column has ${values.size} values for ${types.size} types"
                values.withIndex().any { (i, value) -> (value is String) != (types[i % types.size] == DbTypes.STRING) } ->
                    skipped += "db row ${row.id}: column $column's values aren't its types"
                else -> columns[column] = DbTypes.Column(types, values)
            }
        }
        val data = DbTypes.encodeRow(DbTypes.Row(row.table, columns), table.columnCount)
        if (cached != null && cached.contentEquals(data)) return null
        return file(DbTypes.ROW_GROUP, row.id, data, cached != null)
    }

    private fun file(group: Int, id: Int, data: ByteArray, cached: Boolean): FilePatch =
        if (cached) FilePatch.of(CONFIG_ARCHIVE, group, id) { data } else FilePatch.added(CONFIG_ARCHIVE, group, id, data)
}
