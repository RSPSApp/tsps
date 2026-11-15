package gateway.cache

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.Charset

/**
 * DB tables (config group 39) and rows (group 38): each column's var types and values. A value
 * is a cp1252 string for the string type and an int for every other type this cache's tables use.
 */
object DbTypes {
    const val ROW_GROUP = 38
    const val TABLE_GROUP = 39
    const val STRING = 36

    private val CP1252: Charset = Charset.forName("windows-1252")
    private const val END_COLUMNS = 255

    /** A column of a row (or a table's default): [values] holds one value per type for each field, in order. */
    data class Column(val types: List<Int>, val values: List<Any>)

    /** A table: how many columns its rows size for, and each column's types and default, if any. */
    class Table(val columnCount: Int, val types: Map<Int, List<Int>>, val defaults: Map<Int, Column>)

    class Row(val table: Int, val columns: Map<Int, Column>)

    fun decodeTable(data: ByteArray): Table {
        val buffer = ByteBuffer.wrap(data)
        var columnCount = 0
        val types = LinkedHashMap<Int, List<Int>>()
        val defaults = LinkedHashMap<Int, Column>()
        while (true) {
            when (val opcode = buffer.u8()) {
                0 -> return Table(columnCount, types, defaults)
                1 -> {
                    columnCount = buffer.u8()
                    while (true) {
                        val setting = buffer.u8()
                        if (setting == END_COLUMNS) break
                        val column = setting and 0x7F
                        val columnTypes = List(buffer.u8()) { buffer.ushortSmart() }
                        types[column] = columnTypes
                        if (setting and 0x80 != 0) defaults[column] = Column(columnTypes, buffer.fields(columnTypes))
                    }
                }
                else -> error("db table opcode $opcode")
            }
        }
    }

    fun decodeRow(data: ByteArray): Row {
        val buffer = ByteBuffer.wrap(data)
        var table = -1
        val columns = LinkedHashMap<Int, Column>()
        while (true) {
            when (val opcode = buffer.u8()) {
                0 -> return Row(table, columns)
                3 -> {
                    buffer.u8()
                    while (true) {
                        val column = buffer.u8()
                        if (column == END_COLUMNS) break
                        val columnTypes = List(buffer.u8()) { buffer.ushortSmart() }
                        columns[column] = Column(columnTypes, buffer.fields(columnTypes))
                    }
                }
                4 -> table = buffer.varInt()
                else -> error("db row opcode $opcode")
            }
        }
    }

    /** A row file as the cache writes them: its table, then its columns in id order. */
    fun encodeRow(row: Row, columnCount: Int): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(4)
        var table = row.table
        while (table > 0x7F) {
            out.write(table and 0x7F or 0x80)
            table = table ushr 7
        }
        out.write(table)
        out.write(3)
        out.write(columnCount)
        for ((id, column) in row.columns.toSortedMap()) {
            require(id < columnCount && column.types.isNotEmpty() && column.values.size % column.types.size == 0) { "column $id of table ${row.table}" }
            out.write(id)
            out.write(column.types.size)
            column.types.forEach { out.writeUshortSmart(it) }
            out.writeUshortSmart(column.values.size / column.types.size)
            column.values.forEachIndexed { i, value ->
                if (column.types[i % column.types.size] == STRING) {
                    out.write((value as String).toByteArray(CP1252))
                    out.write(0)
                } else {
                    out.write(ByteBuffer.allocate(4).putInt((value as Number).toInt()).array())
                }
            }
        }
        out.write(END_COLUMNS)
        out.write(0)
        return out.toByteArray()
    }

    private fun ByteBuffer.fields(types: List<Int>): List<Any> =
        List(ushortSmart() * types.size) { i -> if (types[i % types.size] == STRING) string() else int }

    private fun ByteBuffer.u8(): Int = get().toInt() and 0xFF

    private fun ByteBuffer.ushortSmart(): Int = if (get(position()) >= 0) u8() else (short.toInt() and 0xFFFF) - 0x8000

    private fun ByteBuffer.varInt(): Int {
        var value = 0
        var shift = 0
        while (true) {
            val byte = u8()
            value = value or ((byte and 0x7F) shl shift)
            if (byte < 0x80) return value
            shift += 7
        }
    }

    private fun ByteBuffer.string(): String {
        val start = position()
        while (get() != 0.toByte()) continue
        return String(array(), start, position() - start - 1, CP1252)
    }

    private fun ByteArrayOutputStream.writeUshortSmart(value: Int) {
        require(value in 0 until 0x8000) { "smart $value" }
        if (value < 0x80) write(value) else write(ByteBuffer.allocate(2).putShort((value + 0x8000).toShort()).array())
    }
}
