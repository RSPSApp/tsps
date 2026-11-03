package gateway.down

import gateway.cache.Cache
import gateway.cache.EnumTypes
import gateway.cache.VarTypes
import gateway.config.GatewayConfig
import gateway.session.InterfaceTree
import gateway.session.VarpMirror
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import net.rsprot.protocol.game.outgoing.interfaces.IfSetEventsV2
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** The inventory gets live's target events (Use and spells onto it, bits 11-16 and 21) in every flags form tsps sends. */
class InterfacesEventsTest {
    private val cache = Cache.open(GatewayConfig.load().cacheDirectory)
    private val sent = ArrayList<OutgoingGameMessage>()
    private val interfaces =
        Interfaces(VarpMirror(VarTypes(cache)), InterfaceTree(EnumTypes(cache)), StockMarket { sent += it }, {}, { true }, { sent += it })

    @Test
    fun `old-format ranges get them`() {
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_FLAGS_RANGE, TspsWriter().i32(INVENTORY).u16(0).u16(27).i32(DRAG).body()))
        assertEquals(DRAG or TARGET_EVENTS, (sent.single() as IfSetEventsV2).events1)
    }

    @Test
    fun `V2 ranges get them too`() {
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_FLAGS_RANGE_V2, TspsWriter().i32(INVENTORY).u16(0).u16(27).i32(DRAG).i32(OPS).body()))
        val events = sent.single() as IfSetEventsV2
        assertEquals(DRAG or TARGET_EVENTS to OPS, events.events1 to events.events2)
    }

    @Test
    fun `other components' V2 events pass through`() {
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_FLAGS_RANGE_V2, TspsWriter().i32(BANK_ITEMS).u16(0).u16(815).i32(DRAG).i32(OPS).body()))
        assertEquals(DRAG, (sent.single() as IfSetEventsV2).events1)
    }

    private companion object {
        const val INVENTORY = 149 shl 16
        const val BANK_ITEMS = (12 shl 16) or 13
        const val DRAG = 1 shl 17
        const val OPS = 0x3FF
        const val TARGET_EVENTS = (0x3F shl 11) or (1 shl 21)
    }
}
