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
import net.rsprot.protocol.game.outgoing.interfaces.IfMoveSub
import net.rsprot.protocol.game.outgoing.interfaces.IfOpenTop
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** A root change (a game client layout chosen in the settings) moves tsps's mounts, as live does. */
class InterfacesRootTest {
    private val cache = Cache.open(GatewayConfig.load().cacheDirectory)
    private val enums = EnumTypes(cache)
    private val sent = ArrayList<OutgoingGameMessage>()
    private val interfaces =
        Interfaces(VarpMirror(VarTypes(cache)), InterfaceTree(enums), StockMarket { sent += it }, {}, { true }, { sent += it })

    @Test
    fun `switching layout moves the gameframe onto the new root and back`() {
        root(RESIZABLE)
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_OPEN_SUB, TspsWriter().i32(CHATBOX_SLOT).u16(CHATBOX).u8(1).body()))
        sent.clear()

        root(FIXED)
        val onFixed = InterfaceTree(enums).apply { setRoot(FIXED) }.remap(CHATBOX_SLOT)
        assertEquals(FIXED, (sent[0] as IfOpenTop).interfaceId)
        val move = sent.filterIsInstance<IfMoveSub>().single()
        assertEquals(CHATBOX_SLOT to onFixed, move.sourceCombinedId to move.destinationCombinedId)
        sent.clear()

        root(RESIZABLE)
        val back = sent.filterIsInstance<IfMoveSub>().single()
        assertEquals(onFixed to CHATBOX_SLOT, back.sourceCombinedId to back.destinationCombinedId)
    }

    @Test
    fun `the same root again moves nothing`() {
        root(RESIZABLE)
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_OPEN_SUB, TspsWriter().i32(CHATBOX_SLOT).u16(CHATBOX).u8(1).body()))
        sent.clear()
        root(RESIZABLE)
        assertEquals(listOf(IfOpenTop::class), sent.map { it::class })
    }

    private fun root(group: Int) = interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_ROOT, TspsWriter().u16(group).body()))

    private companion object {
        const val RESIZABLE = 161
        const val FIXED = 548
        const val CHATBOX = 162
        /** Where tsps mounts the chatbox on the resizable root. */
        const val CHATBOX_SLOT = (161 shl 16) or 96
    }
}
