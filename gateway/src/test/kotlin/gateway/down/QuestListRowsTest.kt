package gateway.down

import net.rsprot.protocol.util.CombinedId
import gateway.cache.EnumTypes
import gateway.cache.VarTypes
import gateway.headless.TestCache
import gateway.session.InterfaceTree
import gateway.session.QuestListRows
import gateway.session.VarpMirror
import gateway.tsps.TspsPacket
import gateway.tsps.TspsReader
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import gateway.up.Upstream
import net.rsprot.protocol.game.incoming.buttons.If3Button
import net.rsprot.protocol.game.outgoing.interfaces.IfSetEventsV2
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class QuestListRowsTest {
    private val sent = ArrayList<OutgoingGameMessage>()
    private val varps = VarpMirror(VarTypes(TestCache.cache))
    private val interfaces = Interfaces(varps, InterfaceTree(EnumTypes(TestCache.cache)), StockMarket { sent += it }, {}, { true }, { sent += it })

    private fun list(rows: List<Pair<Int, Int>>, slots: List<Int> = listOf(15, 62)): ByteArray {
        val writer = TspsWriter().u16(1).string("Quests").u16(slots.size)
        slots.forEach { writer.u16(it).u8(1).string("key$it").string("Quest $it") }
        writer.u16(rows.size)
        rows.forEach { (native, slot) -> writer.u16(native).u16(slot) }
        return writer.body()
    }

    private fun refresh(rows: List<Pair<Int, Int>>, slots: List<Int> = listOf(15, 62)) =
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_QUEST_LIST, list(rows, slots)))

    private fun flags(start: Int, end: Int, value: Int) =
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_FLAGS_RANGE,
            TspsWriter().i32(QuestListRows.COMPONENT).u16(start).u16(end).i32(value).body()))

    @Test
    fun `native buttons select the mapped quest and unrelated widgets keep their slots`() {
        val bytes = ArrayList<ByteArray>()
        val upstream = Upstream(varps, 0, questSlot = interfaces.questRows::serverSlot) { bytes += it }
        upstream.handle(If3Button(CombinedId(QuestListRows.COMPONENT), 16, 65535, 1))
        assertTrue(bytes.isEmpty(), "no mapping before bootstrap")
        refresh(listOf(16 to 15, 55 to 62))
        for ((native, slot) in listOf(16 to 15, 55 to 62)) {
            upstream.handle(If3Button(CombinedId(QuestListRows.COMPONENT), native, 65535, 1))
            assertArrayEquals(TspsWriter().i32(QuestListRows.COMPONENT).u16(slot).u16(65535).u8(1).fixed(91), bytes.last())
        }
        upstream.handle(If3Button(CombinedId(QuestListRows.COMPONENT), 17, 65535, 1))
        assertEquals(2, bytes.size, "unsupported native rows cannot select dense server slots")
        upstream.handle(If3Button(CombinedId((399 shl 16) or 8), 55, 65535, 1))
        assertArrayEquals(TspsWriter().i32((399 shl 16) or 8).u16(55).u16(65535).u8(1).fixed(91), bytes.last())
    }

    @Test
    fun `refresh clears old native flags before changed sorting and filters publish new ones`() {
        refresh(listOf(16 to 15, 55 to 62))
        flags(0, 62, 2)
        assertEquals(listOf(16, 55), sent.filterIsInstance<IfSetEventsV2>().map { it.start })
        sent.clear()
        // Exact QuestRuntime sequence: clear old dense range, replace list, enable new ranges.
        flags(0, 62, 0)
        refresh(listOf(55 to 1), listOf(1))
        flags(1, 1, 2)
        val events = sent.filterIsInstance<IfSetEventsV2>()
        assertEquals(listOf(16, 55, 55), events.map { it.start })
        assertEquals(listOf(0, 0, 1), events.map { it.events2 })
        assertEquals(listOf(0, 0, 0), events.map { it.events1 })
        assertNull(interfaces.questRows.serverSlot(16))
        assertEquals(1, interfaces.questRows.serverSlot(55))
        assertNull(QuestListRows().serverSlot(55), "a new login never inherits row state")
    }

    @Test
    fun `V2 range maps aliases and other components pass through`() {
        refresh(listOf(106 to 15, 174 to 15))
        fun flagsV2(uid: Int) = interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_FLAGS_RANGE_V2,
            TspsWriter().i32(uid).u16(15).u16(15).i32(128).i32(3).body()))
        flagsV2(QuestListRows.COMPONENT)
        assertEquals(listOf(106, 174), sent.filterIsInstance<IfSetEventsV2>().map { it.start })
        assertTrue(sent.filterIsInstance<IfSetEventsV2>().all { it.events1 == 128 && it.events2 == 3 })
        sent.clear()
        flagsV2((399 shl 16) or 8)
        assertEquals(15, (sent.single() as IfSetEventsV2).start)
    }

    @Test
    fun `malformed and legacy refreshes cannot retain or partially publish a mapping`() {
        for (invalid in listOf(
            list(listOf(16 to 15)).dropLast(1).toByteArray(),
            list(listOf(16 to 99)),
            list(listOf(16 to 15, 16 to 62)),
            list(listOf(16 to 15)) + byteArrayOf(0),
        )) {
            refresh(listOf(16 to 15))
            assertThrows(Exception::class.java) { interfaces.questRows.refresh(TspsReader(invalid)) }
            assertNull(interfaces.questRows.serverSlot(16))
        }
        val legacy = list(emptyList()).dropLast(2).toByteArray()
        refresh(listOf(16 to 15))
        interfaces.questRows.refresh(TspsReader(legacy))
        assertNull(interfaces.questRows.serverSlot(16))
    }
}
