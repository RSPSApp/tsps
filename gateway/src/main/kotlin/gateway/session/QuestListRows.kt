package gateway.session

import gateway.tsps.TspsReader

/** Per-login correspondence between stock-cache child identities and browser quest slots. */
class QuestListRows {
    private var rows: Map<Int, Int> = emptyMap()

    fun serverSlot(nativeSlot: Int): Int? = rows[nativeSlot]

    fun nativeSlots(start: Int, end: Int): List<Int> =
        rows.filterValues { it in start..end }.keys.sorted()

    /** Parse completely before publishing a refresh; malformed or legacy lists cannot reuse old identities. */
    fun refresh(reader: TspsReader) {
        rows = emptyMap()
        val slots = HashSet<Int>()
        repeat(reader.u16()) {
            reader.string()
            repeat(reader.u16()) {
                require(slots.add(reader.u16())) { "duplicate quest slot" }
                reader.u8()
                reader.string()
                reader.string()
            }
        }
        if (reader.remaining == 0) return // Older servers have no native mapping.
        val count = reader.u16()
        require(reader.remaining == count * 4) { "invalid quest row mapping length" }
        val next = LinkedHashMap<Int, Int>()
        repeat(count) {
            val nativeSlot = reader.u16()
            val slot = reader.u16()
            require(slot in slots && next.put(nativeSlot, slot) == null) { "invalid quest row mapping" }
        }
        rows = next
    }

    companion object {
        const val COMPONENT = (399 shl 16) or 7
    }
}
