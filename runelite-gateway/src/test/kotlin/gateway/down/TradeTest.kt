package gateway.down

import gateway.tsps.TspsPacket
import gateway.tsps.TspsReader
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import net.rsprot.protocol.game.outgoing.misc.player.RunClientScript
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The quantity behind each op index of the two trade sides, as revision 241's cache scripts
 * lay them out: the offer grid (336:0, script 3620) puts the player's default quantity on op 1
 * and has no Offer-10; the own offer (335:25, script 763) is 1/5/10/All/X.
 */
class TradeTest {
    private data class Move(val action: Int, val slot: Int, val quantity: Int, val item: Int)

    private val messages = ArrayList<OutgoingGameMessage>()
    private val packets = ArrayList<TspsPacket>()
    private var quantityMode = 0

    private val trade =
        Trade(
            send = { messages += it },
            sendTsps = { packet ->
                val reader = TspsReader(packet, 1) // skip the opcode
                val length = reader.u8()
                packets += TspsPacket(packet[0].toInt() and 0xFF, reader.bytes(length))
            },
            carried = { if (it == CARRIED_ITEM) 1000 else 0 },
            offerQuantityMode = { quantityMode },
        )

    /** The last TRADE_ACTION, after replying to an open count dialog when one was asked for. */
    private fun lastMove(count: Int? = null): Move {
        if (count != null) assertTrue(trade.count(count), "the dialog asked for an amount")
        val packet = packets.lastOrNull()
        assertEquals(TRADE_ACTION, packet?.opcode, "a trade action was sent")
        val reader = packet!!.reader()
        val action = reader.u8()
        val slot = reader.u16()
        val quantity = reader.i32()
        val item = reader.u16()
        return Move(action, slot, quantity, item)
    }

    private fun openedTrade(own: List<Triple<Int, Int, Int>> = emptyList()) {
        trade.handle(TspsPacket(TspsServerPacket.TRADE_OPEN, tradeOpen(own)))
        packets.clear()
        messages.clear()
    }

    private fun offerOp(op: Int, item: Int = CARRIED_ITEM, slot: Int = 3) =
        assertTrue(trade.button(INVENTORY_SIDE, slot, item, op), "the inventory side takes op $op")

    private fun removeOp(op: Int, item: Int = CARRIED_ITEM, slot: Int = 0) =
        assertTrue(trade.button(OWN_OFFER, slot, item, op), "the own offer takes op $op")

    private fun dialogOpen(): Boolean = messages.lastOrNull() is RunClientScript

    @Test
    fun `the inventory side offers the quantity its label names`() {
        openedTrade()
        // Op 1 is the default click; with the grid's default on "one" it offers one.
        quantityMode = 0
        offerOp(1)
        assertEquals(Move(OFFER_ACTION, 3, 1, CARRIED_ITEM), lastMove())

        offerOp(2)
        assertEquals(Move(OFFER_ACTION, 3, 1, CARRIED_ITEM), lastMove(), "Offer-1")

        offerOp(3)
        assertEquals(Move(OFFER_ACTION, 3, 5, CARRIED_ITEM), lastMove(), "Offer-5")

        offerOp(5)
        assertEquals(Move(OFFER_ACTION, 3, 1000, CARRIED_ITEM), lastMove(), "Offer-All")
    }

    @Test
    fun `Offer-X on the inventory side opens the count dialog and offers what was typed`() {
        openedTrade()
        offerOp(4)
        assertTrue(dialogOpen(), "Offer-X asks the server for the amount")
        assertNull(packets.lastOrNull(), "and does not offer anything yet")
        assertEquals(Move(OFFER_ACTION, 3, 7, CARRIED_ITEM), lastMove(count = 7))
        assertFalse(trade.count(9), "a second reply to the same dialog is not consumed")
    }

    @Test
    fun `the inventory side follows the grid's default quantity on op 1`() {
        openedTrade()
        quantityMode = 1
        offerOp(1)
        assertEquals(Move(OFFER_ACTION, 3, 5, CARRIED_ITEM), lastMove(), "default five")

        quantityMode = 2
        offerOp(1)
        assertEquals(Move(OFFER_ACTION, 3, 1000, CARRIED_ITEM), lastMove(), "default all")

        quantityMode = 3
        offerOp(1)
        assertTrue(dialogOpen(), "default X")
        assertEquals(Move(OFFER_ACTION, 3, 4, CARRIED_ITEM), lastMove(count = 4))
    }

    @Test
    fun `the own offer removes the quantity its label names`() {
        val offers =
            listOf(
                Triple(0, CARRIED_ITEM, 3),
                Triple(5, CARRIED_ITEM, 4),
                Triple(6, CARRIED_ITEM + 1, 9),
            )
        openedTrade(offers)

        removeOp(1)
        assertEquals(Move(REMOVE_ACTION, 0, 1, CARRIED_ITEM), lastMove(), "Remove")

        removeOp(2)
        assertEquals(Move(REMOVE_ACTION, 0, 5, CARRIED_ITEM), lastMove(), "Remove-5")

        removeOp(3)
        assertEquals(Move(REMOVE_ACTION, 0, 10, CARRIED_ITEM), lastMove(), "Remove-10")

        removeOp(4)
        assertEquals(Move(REMOVE_ACTION, 0, 7, CARRIED_ITEM), lastMove(), "Remove-All, every slot")

        removeOp(4, item = CARRIED_ITEM + 1)
        assertEquals(Move(REMOVE_ACTION, 0, 9, CARRIED_ITEM + 1), lastMove(), "the other item")
    }

    @Test
    fun `Remove-X on the own offer opens the count dialog`() {
        openedTrade(listOf(Triple(0, CARRIED_ITEM, 6)))
        removeOp(5)
        assertTrue(dialogOpen())
        assertEquals(Move(REMOVE_ACTION, 0, 2, CARRIED_ITEM), lastMove(count = 2))
    }

    @Test
    fun `closing the trade forgets an unanswered X`() {
        openedTrade()
        offerOp(4)
        trade.handle(TspsPacket(TspsServerPacket.TRADE_CLOSE, TspsWriter().string("").body()))
        assertFalse(trade.count(5), "the next dialog belongs to someone else")
    }

    @Test
    fun `buttons that aren't a trade move are left to the client packet dispatch`() {
        assertTrue(trade.button(INVENTORY_SIDE, 0, CARRIED_ITEM, 9), "an op the grid has no label for")
        assertNull(packets.lastOrNull(), "offers nothing")
        assertFalse(trade.button(OTHER_INTERFACE, 0, CARRIED_ITEM, 1))
    }

    /** `encodeTradeParty`: s16 player, name, u8 accepted, u8 confirmed, u8 n, n × (u16 slot, u16 item, i32 qty). */
    private fun tradeOpen(own: List<Triple<Int, Int, Int>>): ByteArray =
        TspsWriter()
            .string("session")
            .u8(0)
            .string("")
            .party(own)
            .party(emptyList())
            .body()

    private fun TspsWriter.party(offers: List<Triple<Int, Int, Int>>): TspsWriter {
        u16(1).string("partner").u8(0).u8(0).u8(offers.size)
        for ((slot, item, quantity) in offers) u16(slot).u16(item).i32(quantity)
        return this
    }

    private companion object {
        const val CARRIED_ITEM = 100
        const val INVENTORY_SIDE = 336 shl 16
        const val OWN_OFFER = (335 shl 16) or 25
        const val OTHER_INTERFACE = (335 shl 16) or 26
        const val TRADE_ACTION = 180
        const val OFFER_ACTION = 0
        const val REMOVE_ACTION = 1
    }
}
