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
import net.rsprot.protocol.game.outgoing.interfaces.IfCloseSub
import net.rsprot.protocol.game.outgoing.interfaces.IfMoveSub
import net.rsprot.protocol.game.outgoing.interfaces.IfOpenSub
import net.rsprot.protocol.game.outgoing.interfaces.IfOpenTop
import net.rsprot.protocol.game.outgoing.misc.player.RunClientScript
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
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

    @Test
    fun `a modal from WIDGET_OPEN moves with the layout and still closes`() {
        root(RESIZABLE)
        open(BANK)
        val opened = sent.filterIsInstance<IfOpenSub>().single()
        assertEquals(MAIN_MODAL, opened.destinationCombinedId)
        sent.clear()

        // The client keeps the modal open on the old root's component when the root changes.
        root(FIXED)
        val onFixed = InterfaceTree(enums).apply { setRoot(FIXED) }.remap(MAIN_MODAL)
        val move = sent.filterIsInstance<IfMoveSub>().single()
        assertEquals(MAIN_MODAL to onFixed, move.sourceCombinedId to move.destinationCombinedId)
        sent.clear()

        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_CLOSE, TspsWriter().u16(BANK).body()))
        assertEquals(onFixed, (sent.single() as IfCloseSub).combinedId)
        // Closed, it stays behind on the next layout change.
        sent.clear()
        root(RESIZABLE)
        assertTrue(sent.none { it is IfMoveSub })
    }

    @Test
    fun `a modal replaced by another moves once`() {
        root(RESIZABLE)
        open(BANK)
        open(SHOP)
        sent.clear()
        root(FIXED)
        assertEquals(1, sent.filterIsInstance<IfMoveSub>().size)
        // The bank went when the shop took its place; only the shop closes.
        sent.clear()
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_CLOSE, TspsWriter().u16(BANK).body()))
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `the welcome screen is up from its root until the gameframe's`() {
        assertFalse(interfaces.welcomeShown)
        root(WELCOME_SCREEN)
        assertTrue(interfaces.welcomeShown)
        root(RESIZABLE)
        assertFalse(interfaces.welcomeShown)
    }

    private fun open(group: Int) = interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_OPEN, TspsWriter().u16(group).u8(1).body()))

    private fun root(group: Int) = interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_ROOT, TspsWriter().u16(group).body()))

    private companion object {
        const val RESIZABLE = 161
        const val FIXED = 548
        const val MODERN = 164
        const val CHATBOX = 162
        const val BANK = 12
        const val SHOP = 300
        const val WELCOME_SCREEN = 378

        /** Where tsps's WIDGET_OPEN puts a modal on the resizable root. */
        const val MAIN_MODAL = (161 shl 16) or 16
        /** Where tsps mounts the chatbox on the resizable root. */
        const val CHATBOX_SLOT = (161 shl 16) or 96
    }
}
