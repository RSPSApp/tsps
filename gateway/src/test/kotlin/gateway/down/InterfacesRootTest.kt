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
import net.rsprot.protocol.game.outgoing.misc.player.RunClientScript
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
        // The client's window goes fixed first (script 3998, layout 0), then the root opens.
        val windowMode = sent[0] as RunClientScript
        assertEquals(3998 to listOf<Any>(0), windowMode.id to windowMode.values)
        assertEquals(FIXED, (sent[1] as IfOpenTop).interfaceId)
        val move = sent.filterIsInstance<IfMoveSub>().single()
        assertEquals(CHATBOX_SLOT to onFixed, move.sourceCombinedId to move.destinationCombinedId)
        sent.clear()

        root(MODERN)
        assertEquals(listOf<Any>(2), sent.filterIsInstance<RunClientScript>().single().values, "resizable modern is layout 2")
        sent.clear()
        root(RESIZABLE)
        assertEquals(listOf<Any>(1), sent.filterIsInstance<RunClientScript>().single().values, "resizable classic is layout 1")
        val back = sent.filterIsInstance<IfMoveSub>().single()
        assertEquals(InterfaceTree(enums).apply { setRoot(MODERN) }.remap(CHATBOX_SLOT) to CHATBOX_SLOT, back.sourceCombinedId to back.destinationCombinedId)
    }

    @Test
    fun `the same root again moves nothing`() {
        root(RESIZABLE)
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_OPEN_SUB, TspsWriter().i32(CHATBOX_SLOT).u16(CHATBOX).u8(1).body()))
        sent.clear()
        root(RESIZABLE)
        assertEquals(listOf(RunClientScript::class, IfOpenTop::class), sent.map { it::class })
    }

    private fun root(group: Int) = interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_ROOT, TspsWriter().u16(group).body()))

    private companion object {
        const val RESIZABLE = 161
        const val FIXED = 548
        const val MODERN = 164
        const val CHATBOX = 162
        /** Where tsps mounts the chatbox on the resizable root. */
        const val CHATBOX_SLOT = (161 shl 16) or 96
    }
}
